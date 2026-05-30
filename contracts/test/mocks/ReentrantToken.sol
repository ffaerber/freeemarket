// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A malicious 6-decimal ERC20 that re-enters a target contract during
///         its `transfer`/`transferFrom` hook. Used to prove Marketplace's
///         `nonReentrant` guard blocks nested calls. When armed, it bubbles up
///         the revert reason from the re-entrant call so tests can assert on it.
contract ReentrantToken is ERC20 {
    address public attackTarget;
    bytes public attackCalldata;
    bool public armed;

    constructor() ERC20("Reentrant", "EVIL") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @param target  contract to re-enter (the Marketplace)
    /// @param data    encoded call to attempt during the next token transfer
    function arm(address target, bytes calldata data) external {
        attackTarget = target;
        attackCalldata = data;
        armed = true;
    }

    function _maybeAttack() internal {
        if (!armed) return;
        armed = false; // disarm so the (reverting) re-entrant call can't recurse
        (bool ok, bytes memory ret) = attackTarget.call(attackCalldata);
        if (!ok) {
            // bubble the original revert reason (e.g. ReentrancyGuardReentrantCall)
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _maybeAttack();
        return super.transfer(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount)
        public
        override
        returns (bool)
    {
        _maybeAttack();
        return super.transferFrom(from, to, amount);
    }
}
