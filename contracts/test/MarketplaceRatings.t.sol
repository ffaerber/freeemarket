// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MarketplaceTest} from "./Marketplace.t.sol";
import {Marketplace} from "../src/Marketplace.sol";

/// @notice Coverage for the on-chain star ratings (CLAUDE.md §reviews): buyers
///         rate a COMPLETED order with two 1–5 star scores (quality + delivery
///         speed), exactly once, and the contract maintains per-seller tallies
///         for cheap average reads. Inherits MarketplaceTest's setUp + helpers
///         (_listing / _fund / actors / constants).
contract MarketplaceRatingsTest is MarketplaceTest {
    event OrderRated(
        uint256 indexed orderId,
        address indexed seller,
        address indexed buyer,
        uint8 quality,
        uint8 deliverySpeed
    );

    /// Fund a listing then settle it to Completed via the buyer's confirmReceipt.
    function _completed(uint256 price) internal returns (uint256 orderId) {
        uint256 id = _listing(price);
        orderId = _fund(id);
        vm.prank(buyer);
        market.confirmReceipt(orderId);
    }

    // --- happy path ---

    function test_rateOrder_storesRatingAndEmits() public {
        uint256 orderId = _completed(PRICE);

        vm.expectEmit(true, true, true, true);
        emit OrderRated(orderId, seller, buyer, 5, 4);
        vm.prank(buyer);
        market.rateOrder(orderId, 5, 4);

        (uint8 quality, uint8 deliverySpeed, uint64 ratedAt) = market.ratings(orderId);
        assertEq(quality, 5);
        assertEq(deliverySpeed, 4);
        assertEq(ratedAt, uint64(block.timestamp));
    }

    function test_rateOrder_updatesSellerAggregate() public {
        uint256 orderId = _completed(PRICE);
        vm.prank(buyer);
        market.rateOrder(orderId, 4, 2);

        (uint256 count, uint256 qualitySum, uint256 deliverySum) = market.sellerRatings(seller);
        assertEq(count, 1);
        assertEq(qualitySum, 4);
        assertEq(deliverySum, 2);
    }

    function test_rateOrder_aggregatesMultipleOrders() public {
        // First completed order, rated 5/5.
        uint256 first = _completed(PRICE);
        vm.prank(buyer);
        market.rateOrder(first, 5, 5);

        // Second completed order on a fresh listing, rated 3/1.
        uint256 id2 = _listing(PRICE);
        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        uint256 second = market.buy(id2);
        market.confirmReceipt(second);
        market.rateOrder(second, 3, 1);
        vm.stopPrank();

        (uint256 count, uint256 qualitySum, uint256 deliverySum) = market.sellerRatings(seller);
        assertEq(count, 2);
        assertEq(qualitySum, 8); // 5 + 3 -> avg 4
        assertEq(deliverySum, 6); // 5 + 1 -> avg 3
    }

    function test_rateOrder_acceptsBoundaryScores() public {
        uint256 orderId = _completed(PRICE);
        vm.prank(buyer);
        market.rateOrder(orderId, 1, 1); // lowest valid scores

        (uint8 quality, uint8 deliverySpeed,) = market.ratings(orderId);
        assertEq(quality, 1);
        assertEq(deliverySpeed, 1);
    }

    // --- access / state gating ---

    function test_rateOrder_revertsBeforeCompleted() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id); // still Funded, not Completed
        vm.prank(buyer);
        vm.expectRevert(bytes("not completed"));
        market.rateOrder(orderId, 5, 5);
    }

    function test_rateOrder_revertsForNonBuyer() public {
        uint256 orderId = _completed(PRICE);
        vm.prank(seller);
        vm.expectRevert(bytes("not buyer"));
        market.rateOrder(orderId, 5, 5);

        vm.prank(stranger);
        vm.expectRevert(bytes("not buyer"));
        market.rateOrder(orderId, 5, 5);
    }

    function test_rateOrder_revertsOnSecondRating() public {
        uint256 orderId = _completed(PRICE);
        vm.startPrank(buyer);
        market.rateOrder(orderId, 5, 5);
        vm.expectRevert(bytes("already rated"));
        market.rateOrder(orderId, 1, 1);
        vm.stopPrank();

        // Aggregate stayed at exactly one rating.
        (uint256 count,,) = market.sellerRatings(seller);
        assertEq(count, 1);
    }

    function test_rateOrder_revertsOnRefundedOrder() public {
        // Fund -> dispute -> arbiter refunds the buyer (never Completed).
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.prank(buyer);
        market.openDispute(orderId);
        vm.prank(owner);
        market.resolveDispute(orderId, true);

        vm.prank(buyer);
        vm.expectRevert(bytes("not completed"));
        market.rateOrder(orderId, 5, 5);
    }

    // --- score range validation ---

    function test_rateOrder_revertsOnZeroQuality() public {
        uint256 orderId = _completed(PRICE);
        vm.prank(buyer);
        vm.expectRevert(bytes("quality 1-5"));
        market.rateOrder(orderId, 0, 3);
    }

    function test_rateOrder_revertsOnQualityAboveFive() public {
        uint256 orderId = _completed(PRICE);
        vm.prank(buyer);
        vm.expectRevert(bytes("quality 1-5"));
        market.rateOrder(orderId, 6, 3);
    }

    function test_rateOrder_revertsOnZeroDelivery() public {
        uint256 orderId = _completed(PRICE);
        vm.prank(buyer);
        vm.expectRevert(bytes("delivery 1-5"));
        market.rateOrder(orderId, 3, 0);
    }

    function test_rateOrder_revertsOnDeliveryAboveFive() public {
        uint256 orderId = _completed(PRICE);
        vm.prank(buyer);
        vm.expectRevert(bytes("delivery 1-5"));
        market.rateOrder(orderId, 3, 6);
    }

    // --- works after a timeout-claimed completion too ---

    function test_rateOrder_afterClaimAfterTimeout() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        // Seller claims after the auto-release window; order becomes Completed.
        vm.warp(block.timestamp + market.autoReleasePeriod());
        vm.prank(seller);
        market.claimAfterTimeout(orderId);

        // Buyer can still rate the (now completed) order.
        vm.prank(buyer);
        market.rateOrder(orderId, 2, 5);
        (uint8 quality, uint8 deliverySpeed,) = market.ratings(orderId);
        assertEq(quality, 2);
        assertEq(deliverySpeed, 5);
    }

    // --- public sales counter (units sold) ---

    function test_sellerSales_incrementsOnConfirmReceipt() public {
        assertEq(market.sellerSales(seller), 0);
        _completed(PRICE); // funds + confirmReceipt
        assertEq(market.sellerSales(seller), 1);
    }

    function test_sellerSales_incrementsOnClaimAfterTimeout() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.warp(block.timestamp + market.autoReleasePeriod());
        vm.prank(seller);
        market.claimAfterTimeout(orderId);
        assertEq(market.sellerSales(seller), 1);
    }

    function test_sellerSales_incrementsOnDisputeResolvedForSeller() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.prank(buyer);
        market.openDispute(orderId);
        vm.prank(owner);
        market.resolveDispute(orderId, false); // pay seller
        assertEq(market.sellerSales(seller), 1);
    }

    function test_sellerSales_notCountedOnRefund() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.prank(buyer);
        market.openDispute(orderId);
        vm.prank(owner);
        market.resolveDispute(orderId, true); // refund buyer
        assertEq(market.sellerSales(seller), 0);
    }

    function test_sellerSales_accumulatesAcrossOrders() public {
        _completed(PRICE);
        _completed(PRICE);
        _completed(PRICE);
        assertEq(market.sellerSales(seller), 3);
    }

    // --- fuzz: any valid pair stores + aggregates correctly ---

    function testFuzz_rateOrder_validScores(uint8 q, uint8 d) public {
        q = uint8(bound(q, 1, 5));
        d = uint8(bound(d, 1, 5));
        uint256 orderId = _completed(PRICE);
        vm.prank(buyer);
        market.rateOrder(orderId, q, d);

        (uint8 sq, uint8 sd,) = market.ratings(orderId);
        assertEq(sq, q);
        assertEq(sd, d);
        (uint256 count, uint256 qSum, uint256 dSum) = market.sellerRatings(seller);
        assertEq(count, 1);
        assertEq(qSum, q);
        assertEq(dSum, d);
    }
}
