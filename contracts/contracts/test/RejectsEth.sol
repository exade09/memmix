// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev A holder that refuses ETH, used to prove one bad recipient cannot
///      block anyone else's claim.
contract RejectsEth {
    receive() external payable {
        revert("no thanks");
    }

    function claimFrom(address token) external {
        (bool ok, ) = token.call(abi.encodeWithSignature("claim()"));
        require(ok, "claim failed");
    }
}
