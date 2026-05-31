// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A deflationary / "skimming" ERC-20: every transfer burns 1% of the
///         amount, so the recipient receives only 99%. Used to prove the
///         Marketplace escrows the ACTUALLY-received amount (balance delta), not
///         the listed price (CLAUDE.md step #8, hardening 2).
contract FeeOnTransferToken is ERC20 {
    uint256 public constant FEE_BPS = 100; // 1% burned on every transfer

    constructor() ERC20("Fee On Transfer", "FOT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Burn 1% of every (non-mint, non-burn) transfer so the recipient
    ///      receives 99%. Overriding `_update` covers transfer/transferFrom.
    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || value == 0) {
            // mint / burn: move the full amount, no skim.
            super._update(from, to, value);
            return;
        }
        uint256 burned = (value * FEE_BPS) / 10_000;
        uint256 sent = value - burned;
        super._update(from, to, sent);
        if (burned > 0) {
            super._update(from, address(0), burned); // burn the skim
        }
    }
}
