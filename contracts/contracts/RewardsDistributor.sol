// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RewardsDistributor
 * @notice Pays $FONS holders their share of collected fees, in whatever
 *         asset those fees arrived in -- ETH, or a tokenized equity such as
 *         AAPL or NVDA.
 *
 * @dev Why Merkle rounds rather than accrual inside the token.
 *
 * Fons launches tokens paired against stocks, so the creator fees it earns
 * arrive as many different ERC-20s. Accruing all of them inside the token
 * would mean touching one storage slot per reward asset on every single
 * transfer, making every $FONS transfer more expensive for everyone, forever,
 * and growing with each asset added. Here the token stays an ordinary ERC-20
 * and each payout round is published as a Merkle root instead: transfers stay
 * cheap, any number of assets is free, and holders pay their own claim gas.
 *
 * What is guaranteed on chain, regardless of who computed the round:
 *  - a round cannot pay out more than was deposited into it;
 *  - nobody can claim the same entry twice;
 *  - nobody can claim on someone else's behalf into their own pocket;
 *  - the owner cannot take back funds while a round is still claimable.
 *
 * What is not: whether the split itself is fair. That is computed off chain
 * from a stated snapshot block, and the root plus that block number are both
 * published so anyone can recompute it and compare.
 */
contract RewardsDistributor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev Sentinel for native ETH, which is not an ERC-20.
    address public constant NATIVE = address(0);

    struct Round {
        address asset;
        bytes32 merkleRoot;
        uint256 total;
        uint256 claimed;
        /// @notice Block the holder snapshot was taken at, so it can be rechecked.
        uint256 snapshotBlock;
        /// @notice After this, unclaimed funds may be swept. Zero means never.
        uint64 expiresAt;
        bool cancelled;
    }

    Round[] private _rounds;

    /// @dev roundId => packed bitmap of claimed indices.
    mapping(uint256 => mapping(uint256 => uint256)) private _claimedBitmap;

    event RoundCreated(
        uint256 indexed roundId,
        address indexed asset,
        bytes32 merkleRoot,
        uint256 total,
        uint256 snapshotBlock,
        uint64 expiresAt
    );
    event Claimed(uint256 indexed roundId, uint256 index, address indexed account, uint256 amount);
    event RoundCancelled(uint256 indexed roundId, uint256 refunded);
    event Swept(uint256 indexed roundId, uint256 amount);

    error InvalidProof();
    error AlreadyClaimed();
    error RoundUnknown();
    error RoundIsCancelled();
    error RoundExpired();
    error NotYetExpired();
    error AmountMismatch();
    error NothingToSweep();
    error ExceedsRoundTotal();
    error TransferFailed();

    constructor(address owner_) Ownable(owner_) {}

    // ---------------------------------------------------------------
    // Creating a round
    // ---------------------------------------------------------------

    /**
     * @notice Publish a payout round and fund it in the same transaction.
     * @param asset       NATIVE for ETH, otherwise the ERC-20 being paid out.
     * @param merkleRoot  Root over leaves of keccak256(index, account, amount).
     * @param total       Exactly what this round can pay out in full.
     * @param snapshotBlock Block the holder balances were read at.
     * @param expiresAt   Unix time after which unclaimed funds may be swept;
     *                    zero leaves the round claimable indefinitely.
     *
     * @dev Funding happens here rather than later so a round can never be
     *      advertised without the money behind it actually being present.
     */
    function createRound(
        address asset,
        bytes32 merkleRoot,
        uint256 total,
        uint256 snapshotBlock,
        uint64 expiresAt
    ) external payable onlyOwner returns (uint256 roundId) {
        if (total == 0) revert AmountMismatch();

        if (asset == NATIVE) {
            if (msg.value != total) revert AmountMismatch();
        } else {
            if (msg.value != 0) revert AmountMismatch();
            /*
              Measure what actually arrived rather than trusting `total`: a
              fee-on-transfer asset would otherwise leave the round promising
              more than it holds, and the last claimants would find it empty.
            */
            uint256 before = IERC20(asset).balanceOf(address(this));
            IERC20(asset).safeTransferFrom(msg.sender, address(this), total);
            if (IERC20(asset).balanceOf(address(this)) - before != total) revert AmountMismatch();
        }

        _rounds.push(
            Round({
                asset: asset,
                merkleRoot: merkleRoot,
                total: total,
                claimed: 0,
                snapshotBlock: snapshotBlock,
                expiresAt: expiresAt,
                cancelled: false
            })
        );
        roundId = _rounds.length - 1;
        emit RoundCreated(roundId, asset, merkleRoot, total, snapshotBlock, expiresAt);
    }

    // ---------------------------------------------------------------
    // Claiming
    // ---------------------------------------------------------------

    /**
     * @notice Claim one entry from a round.
     * @dev Anyone may submit the proof, but the funds always go to `account`.
     *      That lets a third party pay the gas for a holder without being
     *      able to redirect the payment.
     */
    function claim(
        uint256 roundId,
        uint256 index,
        address account,
        uint256 amount,
        bytes32[] calldata proof
    ) external nonReentrant {
        if (roundId >= _rounds.length) revert RoundUnknown();
        Round storage round = _rounds[roundId];
        if (round.cancelled) revert RoundIsCancelled();
        if (round.expiresAt != 0 && block.timestamp > round.expiresAt) revert RoundExpired();
        if (isClaimed(roundId, index)) revert AlreadyClaimed();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
        if (!MerkleProof.verify(proof, round.merkleRoot, leaf)) revert InvalidProof();

        /*
          The on-chain backstop against a bad root: even if the tree were
          computed wrongly, a round can never pay out more than was put in.
        */
        if (round.claimed + amount > round.total) revert ExceedsRoundTotal();

        _setClaimed(roundId, index);
        round.claimed += amount;

        emit Claimed(roundId, index, account, amount);
        _payout(round.asset, account, amount);
    }

    function _payout(address asset, address to, uint256 amount) internal {
        if (asset == NATIVE) {
            (bool ok, ) = payable(to).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
    }

    // ---------------------------------------------------------------
    // Claim bookkeeping
    // ---------------------------------------------------------------

    function isClaimed(uint256 roundId, uint256 index) public view returns (bool) {
        uint256 word = index / 256;
        uint256 bit = index % 256;
        return (_claimedBitmap[roundId][word] >> bit) & 1 == 1;
    }

    function _setClaimed(uint256 roundId, uint256 index) internal {
        _claimedBitmap[roundId][index / 256] |= (1 << (index % 256));
    }

    // ---------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------

    function roundCount() external view returns (uint256) {
        return _rounds.length;
    }

    function rounds(uint256 roundId) external view returns (Round memory) {
        if (roundId >= _rounds.length) revert RoundUnknown();
        return _rounds[roundId];
    }

    function remaining(uint256 roundId) external view returns (uint256) {
        if (roundId >= _rounds.length) revert RoundUnknown();
        Round storage round = _rounds[roundId];
        return round.total - round.claimed;
    }

    // ---------------------------------------------------------------
    // Owner controls
    // ---------------------------------------------------------------

    /**
     * @notice Cancel a round that has not been claimed against at all, and
     *         take the funds back.
     * @dev Only while `claimed == 0`. Once anyone has been paid, the round is
     *      committed: the owner must not be able to pull the floor out from
     *      under holders who have not gotten round to claiming yet.
     */
    function cancelRound(uint256 roundId) external onlyOwner nonReentrant {
        if (roundId >= _rounds.length) revert RoundUnknown();
        Round storage round = _rounds[roundId];
        if (round.cancelled) revert RoundIsCancelled();
        if (round.claimed != 0) revert AlreadyClaimed();

        round.cancelled = true;
        uint256 refund = round.total;
        emit RoundCancelled(roundId, refund);
        _payout(round.asset, owner(), refund);
    }

    /**
     * @notice Recover what is left of an expired round.
     * @dev Only after the stated expiry, which is published when the round is
     *      created, so nobody is surprised by it.
     */
    function sweepExpired(uint256 roundId) external onlyOwner nonReentrant {
        if (roundId >= _rounds.length) revert RoundUnknown();
        Round storage round = _rounds[roundId];
        if (round.cancelled) revert RoundIsCancelled();
        if (round.expiresAt == 0 || block.timestamp <= round.expiresAt) revert NotYetExpired();

        uint256 left = round.total - round.claimed;
        if (left == 0) revert NothingToSweep();

        // Marked fully claimed so the same funds cannot be swept twice.
        round.claimed = round.total;
        emit Swept(roundId, left);
        _payout(round.asset, owner(), left);
    }
}
