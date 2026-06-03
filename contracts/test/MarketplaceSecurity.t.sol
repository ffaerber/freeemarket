// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {Marketplace} from "../src/Marketplace.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockToken} from "./mocks/MockToken.sol";
import {FeeOnTransferToken} from "./mocks/FeeOnTransferToken.sol";

/// @notice Security-hardening regression suite (CLAUDE.md step #8):
///   1. permanent arbiter (no renounce) + Ownable2Step;
///   2. fee-on-transfer-safe escrow (balance-delta amount);
///   3. allowlist re-check on buy;
///   4. Pausable circuit breaker on intake ONLY (funds never trapped).
contract MarketplaceSecurityTest is Test {
    Marketplace internal market;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner"); // arbiter
    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant PRICE = 10_000_000; // 10 USDC (6 dp)
    uint256 internal constant STOCK = 100;
    bytes32 internal constant SHOP_META = bytes32(uint256(0x5409));
    bytes32 internal constant ITEM_META = bytes32(uint256(0x17e3));

    function setUp() public {
        usdc = new MockUSDC();
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        market = new Marketplace(tokens, owner);
        usdc.mint(buyer, 1_000_000_000); // 1,000 USDC
    }

    // --- helpers ---

    function _listUsdc(uint256 price) internal returns (uint256 id) {
        vm.prank(seller);
        market.registerShop(SHOP_META);
        vm.prank(seller);
        id = market.createListing(address(usdc), price, STOCK, ITEM_META);
    }

    function _fundUsdc(uint256 listingId) internal returns (uint256 orderId) {
        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        orderId = market.buy(listingId);
        vm.stopPrank();
    }

    // =====================================================================
    // FIX 1 — permanent arbiter: block renounce; 2-step transfer
    // =====================================================================

    function test_renounceOwnership_reverts() public {
        vm.prank(owner);
        vm.expectRevert(bytes("renounce disabled: arbiter required"));
        market.renounceOwnership();

        // Owner is unchanged and disputes remain resolvable.
        assertEq(market.owner(), owner);
    }

    function test_renounceOwnership_revertsForNonOwnerToo() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        market.renounceOwnership();
    }

    function test_disputeStillResolvableAfterRenounceAttempt() public {
        uint256 id = _listUsdc(PRICE);
        uint256 orderId = _fundUsdc(id);
        vm.prank(buyer);
        market.openDispute(orderId);

        // Renounce is blocked, so the arbiter persists and can resolve.
        vm.prank(owner);
        vm.expectRevert(bytes("renounce disabled: arbiter required"));
        market.renounceOwnership();

        vm.prank(owner);
        market.resolveDispute(orderId, true);
        assertEq(usdc.balanceOf(buyer), 1_000_000_000); // refunded whole
    }

    function test_ownable2Step_transferRequiresAccept() public {
        address newOwner = makeAddr("newOwner");

        // Step 1: current owner proposes; ownership does NOT change yet.
        vm.prank(owner);
        market.transferOwnership(newOwner);
        assertEq(market.owner(), owner, "old owner remains until acceptance");
        assertEq(market.pendingOwner(), newOwner, "pending owner set");

        // Old owner is STILL the arbiter until the transfer is accepted.
        uint256 id = _listUsdc(PRICE);
        uint256 orderId = _fundUsdc(id);
        vm.prank(buyer);
        market.openDispute(orderId);
        vm.prank(newOwner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, newOwner));
        market.resolveDispute(orderId, true); // pending owner can't arbitrate yet
        vm.prank(owner);
        market.resolveDispute(orderId, true); // old owner still can
        assertEq(usdc.balanceOf(buyer), 1_000_000_000);

        // Step 2: only the pending owner can accept.
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        market.acceptOwnership();

        vm.prank(newOwner);
        market.acceptOwnership();
        assertEq(market.owner(), newOwner, "ownership transferred on accept");
        assertEq(market.pendingOwner(), address(0), "pending cleared");
    }

    // =====================================================================
    // FIX 2 — fee-on-transfer / deflationary token safety
    // =====================================================================

    function test_feeOnTransfer_escrowsActualReceivedNotPrice() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        vm.prank(owner);
        market.setTokenAccepted(address(fot), true);

        vm.prank(seller);
        market.registerShop(SHOP_META);
        vm.prank(seller);
        uint256 id = market.createListing(address(fot), PRICE, STOCK, ITEM_META);

        fot.mint(buyer, PRICE);
        vm.startPrank(buyer);
        fot.approve(address(market), PRICE);
        uint256 orderId = market.buy(id);
        vm.stopPrank();

        // 1% is skimmed on transfer-in, so the contract received 99% of price.
        uint256 expectedReceived = PRICE - (PRICE * fot.FEE_BPS()) / 10_000;
        assertLt(expectedReceived, PRICE, "skimming token delivers < price");

        (,,,, uint256 amount,,) = market.orders(orderId);
        assertEq(amount, expectedReceived, "order.amount == actually escrowed");
        assertEq(fot.balanceOf(address(market)), expectedReceived, "balance matches order amount");
    }

    function test_feeOnTransfer_confirmReceiptPaysExactlyReceivedNoOverdraw() public {
        FeeOnTransferToken fot = new FeeOnTransferToken();
        vm.prank(owner);
        market.setTokenAccepted(address(fot), true);

        vm.prank(seller);
        market.registerShop(SHOP_META);
        vm.prank(seller);
        uint256 id = market.createListing(address(fot), PRICE, STOCK, ITEM_META);

        fot.mint(buyer, PRICE);
        vm.startPrank(buyer);
        fot.approve(address(market), PRICE);
        uint256 orderId = market.buy(id);
        vm.stopPrank();

        (,,,, uint256 escrowed,,) = market.orders(orderId);
        uint256 contractBefore = fot.balanceOf(address(market));
        assertEq(contractBefore, escrowed, "escrow == received");

        // Settle. With no platform fee the contract sends 100% of the escrowed
        // (received) amount to the seller.
        vm.prank(buyer);
        market.confirmReceipt(orderId);

        // The seller receives the full escrowed amount minus the token's own 1%
        // skim on the OUTBOUND transfer. The KEY solvency property: the contract
        // never tries to send more than it escrowed, and retains nothing after.
        uint256 sellerSkim = (escrowed * fot.FEE_BPS()) / 10_000;
        assertEq(fot.balanceOf(seller), escrowed - sellerSkim, "seller paid 100% of received (less outbound skim)");

        // No over-draw: the contract sent out exactly what it escrowed (the
        // outbound skim was burned by the token), so its balance is now zero.
        assertEq(fot.balanceOf(address(market)), 0, "contract retains nothing; no over-draw");
    }

    // =====================================================================
    // FIX 3 — re-check allowlist on buy
    // =====================================================================

    function test_buy_revertsWhenTokenRemovedFromAllowlist() public {
        MockToken dai = new MockToken("Mock DAI", "DAI", 18);
        uint256 daiPrice = 2 * 1e18;
        vm.prank(owner);
        market.setTokenAccepted(address(dai), true);

        vm.prank(seller);
        market.registerShop(SHOP_META);
        vm.prank(seller);
        uint256 id = market.createListing(address(dai), daiPrice, STOCK, ITEM_META);

        // Owner de-lists the token. The listing still exists but new funding must fail.
        vm.prank(owner);
        market.setTokenAccepted(address(dai), false);

        dai.mint(buyer, daiPrice);
        vm.startPrank(buyer);
        dai.approve(address(market), daiPrice);
        vm.expectRevert(bytes("token not accepted"));
        market.buy(id);
        vm.stopPrank();
    }

    function test_buy_allowlistReCheck_doesNotAffectAlreadyFundedOrders() public {
        MockToken dai = new MockToken("Mock DAI", "DAI", 18);
        uint256 daiPrice = 2 * 1e18;
        vm.prank(owner);
        market.setTokenAccepted(address(dai), true);

        vm.prank(seller);
        market.registerShop(SHOP_META);
        vm.prank(seller);
        uint256 id = market.createListing(address(dai), daiPrice, STOCK, ITEM_META);

        // Fund TWO orders while the token is accepted.
        dai.mint(buyer, daiPrice * 2);
        vm.startPrank(buyer);
        dai.approve(address(market), daiPrice * 2);
        uint256 order1 = market.buy(id);
        uint256 order2 = market.buy(id);
        vm.stopPrank();

        // De-list the token AFTER funding.
        vm.prank(owner);
        market.setTokenAccepted(address(dai), false);

        // Existing orders still settle: confirmReceipt + dispute resolve both work.
        vm.prank(buyer);
        market.confirmReceipt(order1);
        assertEq(dai.balanceOf(seller), daiPrice);

        vm.prank(buyer);
        market.openDispute(order2);
        vm.prank(owner);
        market.resolveDispute(order2, true); // refund buyer
        assertEq(dai.balanceOf(buyer), daiPrice); // got order2's escrow back
    }

    // =====================================================================
    // FIX 4 — Pausable circuit breaker on intake ONLY
    // =====================================================================

    function test_pause_blocksBuyAndCreateListing() public {
        uint256 id = _listUsdc(PRICE);

        vm.prank(owner);
        market.pause();

        // buy reverts when paused.
        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        market.buy(id);
        vm.stopPrank();

        // createListing reverts when paused.
        vm.prank(seller);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        market.createListing(address(usdc), PRICE, STOCK, ITEM_META);
    }

    function test_pause_doesNotTrapFunds_allExitPathsWork() public {
        // Fund several orders BEFORE pausing.
        uint256 id = _listUsdc(PRICE);
        uint256 orderConfirm = _fundUsdc(id);
        uint256 orderTimeout = _fundUsdc(id);
        uint256 orderDispute = _fundUsdc(id);

        vm.prank(owner);
        market.pause();

        // confirmReceipt works while paused; seller is paid 100%.
        vm.prank(buyer);
        market.confirmReceipt(orderConfirm);
        assertEq(uint8(_state(orderConfirm)), uint8(Marketplace.OrderState.Completed));
        assertEq(usdc.balanceOf(seller), PRICE, "seller paid full amount while paused");

        // claimAfterTimeout works while paused.
        vm.warp(block.timestamp + 14 days);
        vm.prank(seller);
        market.claimAfterTimeout(orderTimeout);
        assertEq(uint8(_state(orderTimeout)), uint8(Marketplace.OrderState.Completed));

        // openDispute + resolveDispute work while paused.
        vm.prank(buyer);
        market.openDispute(orderDispute);
        vm.prank(owner);
        market.resolveDispute(orderDispute, true);
        assertEq(uint8(_state(orderDispute)), uint8(Marketplace.OrderState.Refunded));

        // updateListing works while paused (sellers can still adjust/deactivate).
        vm.prank(seller);
        market.updateListing(id, PRICE, 0, ITEM_META, false);

        // The contract holds no leftover funds: every settled/refunded order
        // moved 100% of its escrow out (no platform fee is ever retained).
        assertEq(usdc.balanceOf(address(market)), 0, "no funds trapped or skimmed");
    }

    function test_unpause_restoresIntake() public {
        uint256 id = _listUsdc(PRICE);

        vm.prank(owner);
        market.pause();
        vm.prank(owner);
        market.unpause();

        // buy works again.
        uint256 orderId = _fundUsdc(id);
        assertEq(uint8(_state(orderId)), uint8(Marketplace.OrderState.Funded));

        // createListing works again.
        vm.prank(seller);
        uint256 id2 = market.createListing(address(usdc), PRICE, STOCK, ITEM_META);
        assertGt(id2, id);
    }

    function test_pauseUnpause_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        market.pause();

        vm.prank(owner);
        market.pause();

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        market.unpause();
    }

    function _state(uint256 orderId) internal view returns (Marketplace.OrderState s) {
        (,,,,,, s) = market.orders(orderId);
    }
}
