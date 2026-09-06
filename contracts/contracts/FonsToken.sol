// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FonsToken
 * @notice A fixed-supply ERC-20 that pays its holders a share of every
 *         deposit of ETH it receives.
 *
 * @dev Why it is built this way.
 *
 * You cannot loop over holders on chain -- there is no such list, and gas
 * would run out if there were. So instead of pushing money to people, this
 * keeps one running number, `magnifiedRewardPerShare`, that only ever grows.
 * Every deposit raises it by (amount / rewardBearingSupply). A holder's
 * lifetime entitlement is then just their balance multiplied by that number,
 * and what they can withdraw is that minus what they have already taken.
 *
 * The tricky part is transfers: someone who sells should keep what accrued
 * while they held, and the buyer must not inherit it. `corrections` handles
 * that. On a move of `value` tokens the sender's correction goes up by
 * `magnifiedRewardPerShare * value` and the receiver's goes down by the same,
 * which cancels out the change in their balances exactly. No loops, no
 * snapshots, and nothing to trust off chain.
 *
 * Exclusions exist because a liquidity pool holds a large balance and is not
 * a person. Left in, most of every distribution would accrue to the pool and
 * sit there unclaimable. Excluded balances are kept out of
 * `rewardBearingSupply`, so the split is across real holders only.
 *
 * Deliberately absent: mint, burn-from-anyone, pause, blacklist, fee-on-
 * transfer, and any owner path to move a holder's tokens or their unclaimed
 * rewards. The owner can flag exclusions and nothing else, and can renounce
 * even that. Rewards are pull-only: the contract never sends on its own, so
 * a hostile recipient cannot block anyone else's claim.
 */
contract FonsToken is ERC20, Ownable, ReentrancyGuard {
    /// @dev Fixed-point scale for the accumulator. 2**128 keeps the rounding
    ///      error below one wei per holder even at extreme supply and deposit
    ///      sizes, and cannot overflow a uint256 alongside realistic balances.
    uint256 internal constant MAGNITUDE = 2 ** 128;

    uint256 public magnifiedRewardPerShare;

    /// @dev Signed because a receiver's correction must be able to go negative.
    mapping(address => int256) public magnifiedCorrections;
    mapping(address => uint256) public withdrawnRewards;

    /// @notice Balance that actually earns: total supply minus excluded holders.
    uint256 public rewardBearingSupply;
    mapping(address => bool) public isExcludedFromRewards;

    /**
     * @dev What an account had accrued at the moment it was excluded.
     *
     * Needed because the running formula multiplies a live balance by an
     * accumulator that keeps growing. An excluded account must stop earning
     * without losing what it already earned, and no arithmetic on the
     * correction alone can express "stop here" against a number that has not
     * happened yet. So the figure is frozen, and restored into a correction
     * if the account is ever put back in.
     */
    mapping(address => uint256) private _frozenAccumulative;

    /// @notice Total ETH ever received for distribution.
    uint256 public totalRewardsDistributed;

    event RewardsDeposited(address indexed from, uint256 amount);
    event RewardClaimed(address indexed holder, uint256 amount);
    event ExclusionSet(address indexed account, bool excluded);
    /// @dev Emitted when a deposit arrives with nothing eligible to receive it.
    event RewardsUndistributable(address indexed from, uint256 amount);

    error NothingToClaim();
    error TransferFailed();
    error ZeroAddress();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        _mint(owner_, totalSupply_);
        // _update ran during the mint and has already counted this into
        // rewardBearingSupply, so nothing is set here.
    }

    // ---------------------------------------------------------------
    // Receiving rewards
    // ---------------------------------------------------------------

    receive() external payable {
        _distribute(msg.value);
    }

    /// @notice Explicit entry point, for callers that prefer a named function.
    function depositRewards() external payable {
        _distribute(msg.value);
    }

    function _distribute(uint256 amount) internal {
        if (amount == 0) return;
        uint256 eligible = rewardBearingSupply;
        if (eligible == 0) {
            /*
              Nothing can be credited yet, so the ETH stays in the contract
              rather than being silently written off. The next deposit made
              once there are eligible holders distributes it along with
              itself, because the accumulator is driven by the balance, not
              by this single call.
            */
            emit RewardsUndistributable(msg.sender, amount);
            return;
        }
        magnifiedRewardPerShare += (amount * MAGNITUDE) / eligible;
        totalRewardsDistributed += amount;
        emit RewardsDeposited(msg.sender, amount);
    }

    // ---------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------

    /// @notice Everything this account has ever been entitled to.
    function accumulativeRewardOf(address account) public view returns (uint256) {
        // An excluded account is held at the figure it reached, which stays
        // claimable: excluding stops future accrual, it does not confiscate.
        if (isExcludedFromRewards[account]) return _frozenAccumulative[account];
        int256 magnified = int256(magnifiedRewardPerShare * balanceOf(account)) +
            magnifiedCorrections[account];
        if (magnified < 0) return 0;
        return uint256(magnified) / MAGNITUDE;
    }

    /// @notice What this account can claim right now.
    function withdrawableRewardOf(address account) public view returns (uint256) {
        uint256 total = accumulativeRewardOf(account);
        uint256 taken = withdrawnRewards[account];
        return total > taken ? total - taken : 0;
    }

    // ---------------------------------------------------------------
    // Claiming
    // ---------------------------------------------------------------

    /// @notice Withdraw your accrued rewards. Pull-only, and reentrancy-safe.
    function claim() external nonReentrant returns (uint256) {
        return _claimFor(msg.sender);
    }

    /**
     * @notice Claim on someone else's behalf, paying them, not yourself.
     * @dev Lets a distribution be nudged along for holders who never claim,
     *      without ever letting the caller redirect the funds.
     */
    function claimFor(address holder) external nonReentrant returns (uint256) {
        return _claimFor(holder);
    }

    function _claimFor(address holder) internal returns (uint256) {
        uint256 amount = withdrawableRewardOf(holder);
        if (amount == 0) revert NothingToClaim();
        // Recorded before the transfer, so a reentrant call sees the new
        // figure and cannot be paid twice even if the guard were absent.
        withdrawnRewards[holder] += amount;
        emit RewardClaimed(holder, amount);
        (bool ok, ) = payable(holder).call{value: amount}("");
        if (!ok) revert TransferFailed();
        return amount;
    }

    // ---------------------------------------------------------------
    // Exclusions
    // ---------------------------------------------------------------

    /**
     * @notice Keep an address out of the reward split (pools, the vault, dead
     *         addresses), or put it back in.
     * @dev Anything already accrued to the account stays claimable; excluding
     *      stops future accrual rather than confiscating the past.
     */
    function setExcludedFromRewards(address account, bool excluded) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (isExcludedFromRewards[account] == excluded) return;

        uint256 balance = balanceOf(account);

        if (excluded) {
            // Snapshot before flipping the flag, while the formula still applies.
            _frozenAccumulative[account] = accumulativeRewardOf(account);
            isExcludedFromRewards[account] = true;
            rewardBearingSupply -= balance;
        } else {
            uint256 frozen = _frozenAccumulative[account];
            isExcludedFromRewards[account] = false;
            rewardBearingSupply += balance;
            /*
              Re-enter the running formula exactly where the account left off:
              pick the correction that makes accumulativeRewardOf() equal the
              frozen figure right now. Anything deposited while it was
              excluded is therefore not backdated to it.
            */
            magnifiedCorrections[account] =
                int256(frozen * MAGNITUDE) -
                int256(magnifiedRewardPerShare * balance);
            _frozenAccumulative[account] = 0;
        }
        emit ExclusionSet(account, excluded);
    }

    // ---------------------------------------------------------------
    // Transfer accounting
    // ---------------------------------------------------------------

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (value == 0) return;

        bool fromExcluded = from == address(0) ? true : isExcludedFromRewards[from];
        bool toExcluded = to == address(0) ? true : isExcludedFromRewards[to];

        // Mint (from == 0) and burn (to == 0) move the eligible supply too.
        if (from == address(0)) {
            if (!toExcluded) rewardBearingSupply += value;
        } else if (to == address(0)) {
            if (!fromExcluded) rewardBearingSupply -= value;
        } else if (!fromExcluded && toExcluded) {
            rewardBearingSupply -= value;
        } else if (fromExcluded && !toExcluded) {
            rewardBearingSupply += value;
        }

        int256 delta = int256(magnifiedRewardPerShare * value);
        // The sender keeps what accrued while they held; the receiver starts
        // from zero on the tokens they just got.
        if (from != address(0) && !fromExcluded) magnifiedCorrections[from] += delta;
        if (to != address(0) && !toExcluded) magnifiedCorrections[to] -= delta;
    }
}
