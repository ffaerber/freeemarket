// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract MarketplaceFuzzTest is Test {
    Marketplace internal market;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");

    bytes32 internal constant META = bytes32(uint256(1));

    function setUp() public {
        usdc = new MockUSDC();
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        market = new Marketplace(tokens, owner);
    }

    /// Payout + fee must always exactly equal the escrowed amount, and the fee
    /// must never exceed the configured rate, for any price/fee combination.
    function testFuzz_feeConservation(uint256 price, uint16 feeBps) public {
        price = bound(price, 1, 1e18); // up to 1e12 USDC; well within uint256 math
        feeBps = uint16(bound(feeBps, 0, market.MAX_FEE_BPS()));

        vm.prank(owner);
        market.setFeeBps(feeBps);

        vm.prank(seller);
        market.registerShop(META);
        vm.prank(seller);
        uint256 id = market.createListing(address(usdc), price, 1, META);

        usdc.mint(buyer, price);
        vm.startPrank(buyer);
        usdc.approve(address(market), price);
        uint256 orderId = market.buy(id);
        vm.stopPrank();

        vm.prank(buyer);
        market.confirmReceipt(orderId);

        uint256 fee = market.accruedFees(address(usdc));
        uint256 payout = usdc.balanceOf(seller);

        assertEq(payout + fee, price, "payout + fee must equal escrow");
        assertLe(fee, (price * feeBps) / 10_000 + 1, "fee within rate");
        assertEq(usdc.balanceOf(address(market)), fee, "only fees remain");
    }

    /// The seller can never claim before exactly `autoReleasePeriod` elapses,
    /// and always can at/after it, regardless of the configured window.
    function testFuzz_timeoutBoundary(uint256 period, uint256 elapsed) public {
        period = bound(period, 1 days, 90 days);
        elapsed = bound(elapsed, 0, 180 days);

        vm.prank(owner);
        market.setAutoReleasePeriod(period);

        vm.prank(seller);
        market.registerShop(META);
        vm.prank(seller);
        uint256 id = market.createListing(address(usdc), 1_000_000, 1, META);

        usdc.mint(buyer, 1_000_000);
        vm.startPrank(buyer);
        usdc.approve(address(market), 1_000_000);
        uint256 orderId = market.buy(id);
        vm.stopPrank();

        uint256 start = block.timestamp;
        vm.warp(start + elapsed);

        vm.prank(seller);
        if (elapsed >= period) {
            market.claimAfterTimeout(orderId);
            assertEq(usdc.balanceOf(seller), 1_000_000);
        } else {
            vm.expectRevert(bytes("too early"));
            market.claimAfterTimeout(orderId);
        }
    }
}
