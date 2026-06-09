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
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        market = new Marketplace(tokens, owner);
        handler = new MarketplaceHandler(market, usdc, owner);
        targetContract(address(handler));
    }

    /// Escrow solvency: the contract's USDC balance must always equal the funds
    /// still held for open orders. With no platform fee, the contract never
    /// retains anything beyond open escrow — settled orders pay out 100% to the
    /// seller, so nothing is ever lost or paid out twice.
    function invariant_escrowSolvency() public view {
        assertEq(
            usdc.balanceOf(address(market)),
            handler.openEscrow(),
            "contract balance must exactly back open escrow"
        );
    }
}
