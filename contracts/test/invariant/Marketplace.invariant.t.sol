// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Marketplace} from "../../src/Marketplace.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {MarketplaceHandler} from "./MarketplaceHandler.sol";

contract MarketplaceInvariantTest is Test {
    Marketplace internal market;
    MockUSDC internal usdc;
    MarketplaceHandler internal handler;

    address internal owner = makeAddr("inv_owner");

    function setUp() public {
        usdc = new MockUSDC();
        market = new Marketplace(address(usdc), owner);
        handler = new MarketplaceHandler(market, usdc, owner);
        targetContract(address(handler));
    }

    /// Escrow solvency: the contract's USDC balance must always equal the funds
    /// still held for open orders plus the fees accrued-but-not-withdrawn.
    /// Nothing is ever lost or paid out twice.
    function invariant_escrowSolvency() public view {
        assertEq(
            usdc.balanceOf(address(market)),
            handler.openEscrow() + market.accruedFees(),
            "contract balance must back open escrow + accrued fees"
        );
    }

    /// The contract must always hold at least the fees it claims to have accrued.
    function invariant_feesAreBacked() public view {
        assertGe(usdc.balanceOf(address(market)), market.accruedFees());
    }
}
