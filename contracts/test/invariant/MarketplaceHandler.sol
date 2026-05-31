// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Marketplace} from "../../src/Marketplace.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";

/// @notice Drives the Marketplace through random user actions for invariant
///         testing. All money-moving paths are exercised; the handler keeps no
///         accounting of its own beyond the set of order ids it has created.
contract MarketplaceHandler is Test {
    Marketplace public market;
    MockUSDC public usdc;

    address public seller = makeAddr("h_seller");
    address public buyer = makeAddr("h_buyer");
    address public owner;

    uint256[] public orderIds;
    uint256[] public listingIds;

    constructor(Marketplace _market, MockUSDC _usdc, address _owner) {
        market = _market;
        usdc = _usdc;
        owner = _owner;

        vm.prank(seller);
        market.registerShop(bytes32(uint256(1)));

        // a handful of listings at varied prices
        for (uint256 i = 1; i <= 3; i++) {
            vm.prank(seller);
            listingIds.push(market.createListing(address(usdc), i * 1_000_000, bytes32(i)));
        }
    }

    function orderCount() external view returns (uint256) {
        return orderIds.length;
    }

    function _pick(uint256[] storage arr, uint256 seed) internal view returns (uint256) {
        return arr[seed % arr.length];
    }

    function buy(uint256 listingSeed) external {
        uint256 listingId = _pick(listingIds, listingSeed);
        (,, uint256 price,,) = market.listings(listingId);

        usdc.mint(buyer, price);
        vm.startPrank(buyer);
        usdc.approve(address(market), price);
        uint256 orderId = market.buy(listingId);
        vm.stopPrank();
        orderIds.push(orderId);
    }

    function confirm(uint256 orderSeed) external {
        if (orderIds.length == 0) return;
        uint256 orderId = _pick(orderIds, orderSeed);
        (,,,,,, Marketplace.OrderState state) = market.orders(orderId);
        if (state != Marketplace.OrderState.Funded) return;
        vm.prank(buyer);
        market.confirmReceipt(orderId);
    }

    function timeout(uint256 orderSeed) external {
        if (orderIds.length == 0) return;
        uint256 orderId = _pick(orderIds, orderSeed);
        (,,,,,, Marketplace.OrderState state) = market.orders(orderId);
        if (state != Marketplace.OrderState.Funded) return;
        vm.warp(block.timestamp + market.autoReleasePeriod());
        vm.prank(seller);
        market.claimAfterTimeout(orderId);
    }

    function dispute(uint256 orderSeed, bool byBuyer) external {
        if (orderIds.length == 0) return;
        uint256 orderId = _pick(orderIds, orderSeed);
        (,,,,,, Marketplace.OrderState state) = market.orders(orderId);
        if (state != Marketplace.OrderState.Funded) return;
        vm.prank(byBuyer ? buyer : seller);
        market.openDispute(orderId);
    }

    function resolve(uint256 orderSeed, bool refundBuyer) external {
        if (orderIds.length == 0) return;
        uint256 orderId = _pick(orderIds, orderSeed);
        (,,,,,, Marketplace.OrderState state) = market.orders(orderId);
        if (state != Marketplace.OrderState.Disputed) return;
        vm.prank(owner);
        market.resolveDispute(orderId, refundBuyer);
    }

    function withdraw() external {
        vm.prank(owner);
        market.withdrawFees(address(usdc), owner);
    }

    function setFee(uint256 feeSeed) external {
        uint16 fee = uint16(feeSeed % (market.MAX_FEE_BPS() + 1));
        vm.prank(owner);
        market.setFeeBps(fee);
    }

    /// Sum of escrow still held for open (Funded or Disputed) orders.
    function openEscrow() external view returns (uint256 total) {
        for (uint256 i = 0; i < orderIds.length; i++) {
            (,,,, uint256 amount,, Marketplace.OrderState state) = market.orders(orderIds[i]);
            if (state == Marketplace.OrderState.Funded || state == Marketplace.OrderState.Disputed) {
                total += amount;
            }
        }
    }
}
