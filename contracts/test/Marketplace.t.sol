// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Marketplace} from "../src/Marketplace.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";

contract MarketplaceTest is Test {
    Marketplace internal market;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner"); // arbiter
    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant PRICE = 10_000_000; // 10 USDC (6 dp)
    bytes32 internal constant SHIP_REF = bytes32(uint256(0x5417));
    bytes32 internal constant SHOP_META = bytes32(uint256(0x5409));
    bytes32 internal constant ITEM_META = bytes32(uint256(0x17e3));

    // Mirror of the contract's events for expectEmit assertions.
    event ShopRegistered(address indexed seller, bytes32 metadata);
    event ListingCreated(uint256 indexed id, address indexed seller, uint256 price, bytes32 metadata);
    event ListingUpdated(uint256 indexed id, uint256 price, bytes32 metadata, bool active);
    event OrderFunded(
        uint256 indexed orderId,
        uint256 indexed listingId,
        address indexed buyer,
        address seller,
        uint256 amount,
        bytes32 shippingRef
    );
    event OrderCompleted(uint256 indexed orderId, uint256 payout, uint256 fee);
    event OrderRefunded(uint256 indexed orderId, uint256 amount);
    event DisputeOpened(uint256 indexed orderId, address indexed by);
    event FeeUpdated(uint16 feeBps);
    event AutoReleasePeriodUpdated(uint256 period);
    event FeesWithdrawn(address indexed to, uint256 amount);

    function setUp() public virtual {
        usdc = new MockUSDC();
        market = new Marketplace(address(usdc), owner);
        usdc.mint(buyer, 1_000_000_000); // 1,000 USDC
    }

    // --- helpers ---

    function _pubKey() internal pure returns (bytes memory k) {
        k = new bytes(33); // 33B compressed secp256k1 key
        k[0] = 0x02;
    }

    function _registerShop() internal {
        vm.prank(seller);
        market.registerShop(SHOP_META, _pubKey());
    }

    function _listing(uint256 price) internal returns (uint256 id) {
        _registerShop();
        vm.prank(seller);
        id = market.createListing(price, ITEM_META);
    }

    function _fund(uint256 listingId) internal returns (uint256 orderId) {
        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        orderId = market.buy(listingId, SHIP_REF);
        vm.stopPrank();
    }

    // --- shops ---

    function test_registerShop_setsStateAndEmits() public {
        vm.expectEmit(true, false, false, true);
        emit ShopRegistered(seller, SHOP_META);
        vm.prank(seller);
        market.registerShop(SHOP_META, _pubKey());

        (bool registered, bytes32 metadata,) = market.shops(seller);
        assertTrue(registered);
        assertEq(metadata, SHOP_META);
        assertEq(market.shopEncryptionKey(seller), _pubKey());
    }

    function test_registerShop_revertsOnShortKey() public {
        bytes memory shortKey = new bytes(32);
        vm.prank(seller);
        vm.expectRevert(bytes("bad key"));
        market.registerShop(SHOP_META, shortKey);
    }

    function test_registerShop_overwritesOnReregister() public {
        _registerShop();
        bytes32 newMeta = bytes32(uint256(0xBEEF));
        bytes memory newKey = new bytes(65); // uncompressed key (rotation)
        newKey[0] = 0x04;

        vm.prank(seller);
        market.registerShop(newMeta, newKey);

        (, bytes32 metadata,) = market.shops(seller);
        assertEq(metadata, newMeta);
        assertEq(market.shopEncryptionKey(seller), newKey);
    }

    // --- listings ---

    function test_createListing_requiresShop() public {
        vm.prank(seller);
        vm.expectRevert(bytes("no shop"));
        market.createListing(PRICE, ITEM_META);
    }

    function test_createListing_rejectsZeroPrice() public {
        _registerShop();
        vm.prank(seller);
        vm.expectRevert(bytes("price=0"));
        market.createListing(0, ITEM_META);
    }

    function test_createListing_incrementsIdAndEmits() public {
        _registerShop();
        vm.expectEmit(true, true, false, true);
        emit ListingCreated(1, seller, PRICE, ITEM_META);
        vm.prank(seller);
        uint256 id1 = market.createListing(PRICE, ITEM_META);

        vm.prank(seller);
        uint256 id2 = market.createListing(PRICE, ITEM_META);

        assertEq(id1, 1);
        assertEq(id2, 2);
        (address s, uint256 price, bytes32 meta, bool active) = market.listings(id1);
        assertEq(s, seller);
        assertEq(price, PRICE);
        assertEq(meta, ITEM_META);
        assertTrue(active);
    }

    function test_updateListing_onlySeller() public {
        uint256 id = _listing(PRICE);
        vm.prank(stranger);
        vm.expectRevert(bytes("not seller"));
        market.updateListing(id, PRICE, ITEM_META, false);
    }

    function test_updateListing_editsFields() public {
        uint256 id = _listing(PRICE);
        bytes32 newMeta = bytes32(uint256(0xC0DE));
        vm.expectEmit(true, false, false, true);
        emit ListingUpdated(id, 5_000_000, newMeta, false);
        vm.prank(seller);
        market.updateListing(id, 5_000_000, newMeta, false);

        (, uint256 price, bytes32 meta, bool active) = market.listings(id);
        assertEq(price, 5_000_000);
        assertEq(meta, newMeta);
        assertFalse(active);
    }

    function test_updateListing_rejectsZeroPrice() public {
        uint256 id = _listing(PRICE);
        vm.prank(seller);
        vm.expectRevert(bytes("price=0"));
        market.updateListing(id, 0, ITEM_META, true);
    }

    // --- buy / escrow ---

    function test_buy_escrowsFundsAndEmits() public {
        uint256 id = _listing(PRICE);

        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        vm.expectEmit(true, true, true, true);
        emit OrderFunded(1, id, buyer, seller, PRICE, SHIP_REF);
        uint256 orderId = market.buy(id, SHIP_REF);
        vm.stopPrank();

        assertEq(orderId, 1);
        assertEq(usdc.balanceOf(address(market)), PRICE);
        assertEq(usdc.balanceOf(buyer), 1_000_000_000 - PRICE);

        (
            uint256 listingId,
            address oBuyer,
            address oSeller,
            uint256 amount,
            bytes32 shippingRef,
            ,
            Marketplace.OrderState state
        ) = market.orders(orderId);
        assertEq(listingId, id);
        assertEq(oBuyer, buyer);
        assertEq(oSeller, seller);
        assertEq(amount, PRICE);
        assertEq(shippingRef, SHIP_REF);
        assertEq(uint8(state), uint8(Marketplace.OrderState.Funded));
    }

    function test_buy_revertsWithoutApproval() public {
        uint256 id = _listing(PRICE);
        vm.prank(buyer);
        vm.expectRevert(); // SafeERC20 / allowance failure
        market.buy(id, SHIP_REF);
    }

    function test_buy_revertsOnInactiveListing() public {
        uint256 id = _listing(PRICE);
        vm.prank(seller);
        market.updateListing(id, PRICE, ITEM_META, false);

        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        vm.expectRevert(bytes("inactive"));
        market.buy(id, SHIP_REF);
        vm.stopPrank();
    }

    function test_buy_revertsOnSelfBuy() public {
        uint256 id = _listing(PRICE);
        usdc.mint(seller, PRICE);
        vm.startPrank(seller);
        usdc.approve(address(market), PRICE);
        vm.expectRevert(bytes("self-buy"));
        market.buy(id, SHIP_REF);
        vm.stopPrank();
    }

    // --- confirmReceipt ---

    function test_confirmReceipt_releasesToSeller() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);

        vm.expectEmit(true, false, false, true);
        emit OrderCompleted(orderId, PRICE, 0);
        vm.prank(buyer);
        market.confirmReceipt(orderId);

        assertEq(usdc.balanceOf(seller), PRICE);
        assertEq(usdc.balanceOf(address(market)), 0);
        (,,,,,, Marketplace.OrderState state) = market.orders(orderId);
        assertEq(uint8(state), uint8(Marketplace.OrderState.Completed));
    }

    function test_confirmReceipt_onlyBuyer() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.prank(seller);
        vm.expectRevert(bytes("not buyer"));
        market.confirmReceipt(orderId);
    }

    function test_confirmReceipt_revertsIfNotFunded() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.prank(buyer);
        market.confirmReceipt(orderId);

        // second confirm: state is now Completed
        vm.prank(buyer);
        vm.expectRevert(bytes("not funded"));
        market.confirmReceipt(orderId);
    }

    // --- claimAfterTimeout ---

    function test_claimAfterTimeout_releasesAfterWindow() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);

        vm.warp(block.timestamp + 14 days);
        vm.prank(seller);
        market.claimAfterTimeout(orderId);

        assertEq(usdc.balanceOf(seller), PRICE);
    }

    function test_claimAfterTimeout_revertsTooEarly() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);

        vm.warp(block.timestamp + 14 days - 1);
        vm.prank(seller);
        vm.expectRevert(bytes("too early"));
        market.claimAfterTimeout(orderId);
    }

    function test_claimAfterTimeout_onlySeller() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.warp(block.timestamp + 14 days);
        vm.prank(stranger);
        vm.expectRevert(bytes("not seller"));
        market.claimAfterTimeout(orderId);
    }

    // --- disputes ---

    function test_openDispute_byBuyer() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.expectEmit(true, true, false, false);
        emit DisputeOpened(orderId, buyer);
        vm.prank(buyer);
        market.openDispute(orderId);
        (,,,,,, Marketplace.OrderState state) = market.orders(orderId);
        assertEq(uint8(state), uint8(Marketplace.OrderState.Disputed));
    }

    function test_openDispute_bySeller() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.prank(seller);
        market.openDispute(orderId);
        (,,,,,, Marketplace.OrderState state) = market.orders(orderId);
        assertEq(uint8(state), uint8(Marketplace.OrderState.Disputed));
    }

    function test_openDispute_rejectsThirdParty() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.prank(stranger);
        vm.expectRevert(bytes("not party"));
        market.openDispute(orderId);
    }

    function test_resolveDispute_refundsBuyer() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.prank(buyer);
        market.openDispute(orderId);

        vm.expectEmit(true, false, false, true);
        emit OrderRefunded(orderId, PRICE);
        vm.prank(owner);
        market.resolveDispute(orderId, true);

        assertEq(usdc.balanceOf(buyer), 1_000_000_000); // made whole
        assertEq(usdc.balanceOf(address(market)), 0);
        (,,,,,, Marketplace.OrderState state) = market.orders(orderId);
        assertEq(uint8(state), uint8(Marketplace.OrderState.Refunded));
    }

    function test_resolveDispute_paysSeller() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.prank(seller);
        market.openDispute(orderId);

        vm.prank(owner);
        market.resolveDispute(orderId, false);

        assertEq(usdc.balanceOf(seller), PRICE);
        (,,,,,, Marketplace.OrderState state) = market.orders(orderId);
        assertEq(uint8(state), uint8(Marketplace.OrderState.Completed));
    }

    function test_resolveDispute_onlyOwner() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.prank(buyer);
        market.openDispute(orderId);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        market.resolveDispute(orderId, true);
    }

    function test_resolveDispute_revertsIfNotDisputed() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.prank(owner);
        vm.expectRevert(bytes("not disputed"));
        market.resolveDispute(orderId, true);
    }

    function test_confirmReceipt_revertsWhenDisputed() public {
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.prank(buyer);
        market.openDispute(orderId);
        vm.prank(buyer);
        vm.expectRevert(bytes("not funded"));
        market.confirmReceipt(orderId);
    }

    // --- fee math ---

    function test_fee_splitsPayoutAndAccrues() public {
        vm.prank(owner);
        market.setFeeBps(250); // 2.5%

        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        uint256 expectedFee = (PRICE * 250) / 10_000; // 250_000
        uint256 expectedPayout = PRICE - expectedFee;

        vm.expectEmit(true, false, false, true);
        emit OrderCompleted(orderId, expectedPayout, expectedFee);
        vm.prank(buyer);
        market.confirmReceipt(orderId);

        assertEq(usdc.balanceOf(seller), expectedPayout);
        assertEq(market.accruedFees(), expectedFee);
        assertEq(usdc.balanceOf(address(market)), expectedFee);
    }

    function test_fee_roundsDownToZeroOnTinyAmount() public {
        vm.prank(owner);
        market.setFeeBps(1); // 0.01%

        // price * 1 / 10000 < 1  => fee rounds to 0
        uint256 id = _listing(9_999);
        vm.startPrank(buyer);
        usdc.approve(address(market), 9_999);
        uint256 orderId = market.buy(id, SHIP_REF);
        vm.stopPrank();

        vm.prank(buyer);
        market.confirmReceipt(orderId);
        assertEq(market.accruedFees(), 0);
        assertEq(usdc.balanceOf(seller), 9_999);
    }

    // --- admin ---

    function test_setFeeBps_capEnforced() public {
        vm.prank(owner);
        vm.expectRevert(bytes("fee too high"));
        market.setFeeBps(1001); // > 10%

        vm.prank(owner);
        market.setFeeBps(1000); // exactly 10% ok
        assertEq(market.feeBps(), 1000);
    }

    function test_setFeeBps_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        market.setFeeBps(100);
    }

    function test_setAutoReleasePeriod_rangeEnforced() public {
        vm.startPrank(owner);
        vm.expectRevert(bytes("out of range"));
        market.setAutoReleasePeriod(1 days - 1);
        vm.expectRevert(bytes("out of range"));
        market.setAutoReleasePeriod(90 days + 1);
        market.setAutoReleasePeriod(30 days);
        vm.stopPrank();
        assertEq(market.autoReleasePeriod(), 30 days);
    }

    function test_withdrawFees_transfersAndZeroes() public {
        vm.prank(owner);
        market.setFeeBps(1000);
        uint256 id = _listing(PRICE);
        uint256 orderId = _fund(id);
        vm.prank(buyer);
        market.confirmReceipt(orderId);

        uint256 fee = market.accruedFees();
        assertGt(fee, 0);

        vm.expectEmit(true, false, false, true);
        emit FeesWithdrawn(owner, fee);
        vm.prank(owner);
        market.withdrawFees(owner);

        assertEq(market.accruedFees(), 0);
        assertEq(usdc.balanceOf(owner), fee);
    }

    function test_withdrawFees_rejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(bytes("to=0"));
        market.withdrawFees(address(0));
    }

    // --- reentrancy ---

    function test_buy_blocksReentrancy() public {
        ReentrantToken evil = new ReentrantToken();
        Marketplace m = new Marketplace(address(evil), owner);

        evil.mint(seller, PRICE);
        evil.mint(buyer, PRICE);

        vm.prank(seller);
        m.registerShop(SHOP_META, _pubKey());
        vm.prank(seller);
        uint256 id = m.createListing(PRICE, ITEM_META);

        // On the buyer's token pull, re-enter buy() again.
        evil.arm(address(m), abi.encodeWithSelector(m.buy.selector, id, SHIP_REF));

        vm.startPrank(buyer);
        evil.approve(address(m), type(uint256).max);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        m.buy(id, SHIP_REF);
        vm.stopPrank();
    }

    function test_confirmReceipt_blocksReentrancy() public {
        ReentrantToken evil = new ReentrantToken();
        Marketplace m = new Marketplace(address(evil), owner);

        evil.mint(buyer, PRICE);
        vm.prank(seller);
        m.registerShop(SHOP_META, _pubKey());
        vm.prank(seller);
        uint256 id = m.createListing(PRICE, ITEM_META);

        vm.startPrank(buyer);
        evil.approve(address(m), PRICE);
        uint256 orderId = m.buy(id, SHIP_REF);
        vm.stopPrank();

        // On the seller payout, re-enter confirmReceipt for the same order.
        evil.arm(address(m), abi.encodeWithSelector(m.confirmReceipt.selector, orderId));

        vm.prank(buyer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        m.confirmReceipt(orderId);
    }
}
