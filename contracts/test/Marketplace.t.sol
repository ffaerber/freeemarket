// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Marketplace} from "../src/Marketplace.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockToken} from "./mocks/MockToken.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";

contract MarketplaceTest is Test {
    Marketplace internal market;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner"); // arbiter
    address internal seller = makeAddr("seller");
    address internal buyer = makeAddr("buyer");
    address internal stranger = makeAddr("stranger");

    uint256 internal constant PRICE = 10_000_000; // 10 USDC (6 dp)
    uint256 internal constant STOCK = 100;        // default listing stock (a unit count)
    bytes32 internal constant SHOP_META = bytes32(uint256(0x5409));
    bytes32 internal constant ITEM_META = bytes32(uint256(0x17e3));

    // Mirror of the contract's events for expectEmit assertions.
    event ShopRegistered(address indexed seller, bytes32 metadata);
    event TokenAccepted(address indexed token, bool accepted);
    event ListingCreated(
        uint256 indexed id,
        address indexed seller,
        address indexed token,
        uint256 price,
        uint256 stock,
        bytes32 metadata
    );
    event ListingUpdated(uint256 indexed id, uint256 price, uint256 stock, bytes32 metadata, bool active);
    event StockChanged(uint256 indexed id, uint256 newStock);
    event OrderFunded(
        uint256 indexed orderId,
        uint256 indexed listingId,
        address indexed buyer,
        address seller,
        address token,
        uint256 amount
    );
    event OrderCompleted(uint256 indexed orderId, uint256 payout, uint256 fee);
    event OrderRefunded(uint256 indexed orderId, uint256 amount);
    event DisputeOpened(uint256 indexed orderId, address indexed by);
    event FeeUpdated(uint16 feeBps);
    event AutoReleasePeriodUpdated(uint256 period);
    event FeesWithdrawn(address indexed token, address indexed to, uint256 amount);

    function setUp() public virtual {
        usdc = new MockUSDC();
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        market = new Marketplace(tokens, owner);
        usdc.mint(buyer, 1_000_000_000); // 1,000 USDC
    }

    // --- helpers ---

    function _registerShop() internal {
        vm.prank(seller);
        market.registerShop(SHOP_META);
    }

    function _listing(uint256 price) internal returns (uint256 id) {
        _registerShop();
        vm.prank(seller);
        id = market.createListing(address(usdc), price, STOCK, ITEM_META);
    }

    function _fund(uint256 listingId) internal returns (uint256 orderId) {
        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        orderId = market.buy(listingId);
        vm.stopPrank();
    }

    // --- shops ---

    function test_registerShop_setsStateAndEmits() public {
        vm.expectEmit(true, false, false, true);
        emit ShopRegistered(seller, SHOP_META);
        vm.prank(seller);
        market.registerShop(SHOP_META);

        (bool registered, bytes32 metadata) = market.shops(seller);
        assertTrue(registered);
        assertEq(metadata, SHOP_META);
    }

    function test_registerShop_overwritesOnReregister() public {
        _registerShop();
        bytes32 newMeta = bytes32(uint256(0xBEEF));

        vm.prank(seller);
        market.registerShop(newMeta);

        (, bytes32 metadata) = market.shops(seller);
        assertEq(metadata, newMeta);
    }

    // --- token allowlist ---

    function test_constructor_seedsAcceptedTokens() public view {
        assertTrue(market.acceptedTokens(address(usdc)));
    }

    function test_setTokenAccepted_onlyOwner() public {
        MockToken other = new MockToken("Other", "OTH", 18);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        market.setTokenAccepted(address(other), true);
    }

    function test_setTokenAccepted_togglesAndEmits() public {
        MockToken other = new MockToken("Other", "OTH", 18);

        vm.expectEmit(true, false, false, true);
        emit TokenAccepted(address(other), true);
        vm.prank(owner);
        market.setTokenAccepted(address(other), true);
        assertTrue(market.acceptedTokens(address(other)));

        vm.expectEmit(true, false, false, true);
        emit TokenAccepted(address(other), false);
        vm.prank(owner);
        market.setTokenAccepted(address(other), false);
        assertFalse(market.acceptedTokens(address(other)));
    }

    function test_setTokenAccepted_rejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(bytes("token=0"));
        market.setTokenAccepted(address(0), true);
    }

    // --- listings ---

    function test_createListing_requiresShop() public {
        vm.prank(seller);
        vm.expectRevert(bytes("no shop"));
        market.createListing(address(usdc), PRICE, STOCK, ITEM_META);
    }

    function test_createListing_rejectsUnacceptedToken() public {
        _registerShop();
        MockToken other = new MockToken("Other", "OTH", 18);
        vm.prank(seller);
        vm.expectRevert(bytes("token not accepted"));
        market.createListing(address(other), PRICE, STOCK, ITEM_META);
    }

    function test_createListing_rejectsZeroPrice() public {
        _registerShop();
        vm.prank(seller);
        vm.expectRevert(bytes("price=0"));
        market.createListing(address(usdc), 0, STOCK, ITEM_META);
    }

    function test_createListing_rejectsZeroStock() public {
        _registerShop();
        vm.prank(seller);
        vm.expectRevert(bytes("stock=0"));
        market.createListing(address(usdc), PRICE, 0, ITEM_META);
    }

    function test_createListing_incrementsIdAndEmits() public {
        _registerShop();
        vm.expectEmit(true, true, true, true);
        emit ListingCreated(1, seller, address(usdc), PRICE, STOCK, ITEM_META);
        vm.prank(seller);
        uint256 id1 = market.createListing(address(usdc), PRICE, STOCK, ITEM_META);

        vm.prank(seller);
        uint256 id2 = market.createListing(address(usdc), PRICE, STOCK, ITEM_META);

        assertEq(id1, 1);
        assertEq(id2, 2);
        (address s, address token, uint256 price, uint256 stock, bytes32 meta, bool active) =
            market.listings(id1);
        assertEq(s, seller);
        assertEq(token, address(usdc));
        assertEq(price, PRICE);
        assertEq(stock, STOCK);
        assertEq(meta, ITEM_META);
        assertTrue(active);
    }

    function test_updateListing_onlySeller() public {
        uint256 id = _listing(PRICE);
        vm.prank(stranger);
        vm.expectRevert(bytes("not seller"));
        market.updateListing(id, PRICE, STOCK, ITEM_META, false);
    }

    function test_updateListing_editsFields() public {
        uint256 id = _listing(PRICE);
        bytes32 newMeta = bytes32(uint256(0xC0DE));
        vm.expectEmit(true, false, false, true);
        emit ListingUpdated(id, 5_000_000, 42, newMeta, false);
        vm.prank(seller);
        market.updateListing(id, 5_000_000, 42, newMeta, false);

        (, address token, uint256 price, uint256 stock, bytes32 meta, bool active) = market.listings(id);
        assertEq(token, address(usdc)); // token is immutable across updates
        assertEq(price, 5_000_000);
        assertEq(stock, 42);
        assertEq(meta, newMeta);
        assertFalse(active);
    }

    function test_updateListing_rejectsZeroPrice() public {
        uint256 id = _listing(PRICE);
        vm.prank(seller);
        vm.expectRevert(bytes("price=0"));
        market.updateListing(id, 0, STOCK, ITEM_META, true);
    }

    // --- stock / inventory ---

    function test_buy_decrementsStockByOneAndEmits() public {
        uint256 id = _listing(PRICE);

        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        vm.expectEmit(true, false, false, true);
        emit StockChanged(id, STOCK - 1);
        market.buy(id);
        vm.stopPrank();

        (,,, uint256 stock,,) = market.listings(id);
        assertEq(stock, STOCK - 1);
    }

    function test_buy_lastUnitThenOutOfStock() public {
        uint256 id = _listing(PRICE);
        vm.prank(seller);
        market.updateListing(id, PRICE, 1, ITEM_META, true); // restock down to a single unit

        // Buy the last unit -> stock hits 0.
        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        market.buy(id);
        vm.stopPrank();

        (,,, uint256 stock,,) = market.listings(id);
        assertEq(stock, 0);

        // Next buy reverts: out of stock.
        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        vm.expectRevert(bytes("out of stock"));
        market.buy(id);
        vm.stopPrank();
    }

    function test_updateListing_setStockToZeroBlocksBuy() public {
        uint256 id = _listing(PRICE);
        vm.prank(seller);
        market.updateListing(id, PRICE, 0, ITEM_META, true); // sold out via update

        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        vm.expectRevert(bytes("out of stock"));
        market.buy(id);
        vm.stopPrank();
    }

    function test_updateListing_restockFromZeroReenablesBuy() public {
        uint256 id = _listing(PRICE);
        vm.prank(seller);
        market.updateListing(id, PRICE, 0, ITEM_META, true);

        // Out of stock: buy reverts.
        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        vm.expectRevert(bytes("out of stock"));
        market.buy(id);
        vm.stopPrank();

        // Restock to 3.
        vm.prank(seller);
        vm.expectEmit(true, false, false, true);
        emit StockChanged(id, 3);
        market.updateListing(id, PRICE, 3, ITEM_META, true);

        // Buy works again.
        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        market.buy(id);
        vm.stopPrank();

        (,,, uint256 stock,,) = market.listings(id);
        assertEq(stock, 2);
    }

    function test_buy_multiUnitSupportsNBuysThenReverts() public {
        uint256 n = 3;
        _registerShop();
        vm.prank(seller);
        uint256 id = market.createListing(address(usdc), PRICE, n, ITEM_META);

        for (uint256 i = 0; i < n; i++) {
            vm.startPrank(buyer);
            usdc.approve(address(market), PRICE);
            market.buy(id);
            vm.stopPrank();
        }

        (,,, uint256 stock,,) = market.listings(id);
        assertEq(stock, 0);

        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        vm.expectRevert(bytes("out of stock"));
        market.buy(id);
        vm.stopPrank();
    }

    // --- buy / escrow ---

    function test_buy_escrowsFundsAndEmits() public {
        uint256 id = _listing(PRICE);

        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        vm.expectEmit(true, true, true, true);
        emit OrderFunded(1, id, buyer, seller, address(usdc), PRICE);
        uint256 orderId = market.buy(id);
        vm.stopPrank();

        assertEq(orderId, 1);
        assertEq(usdc.balanceOf(address(market)), PRICE);
        assertEq(usdc.balanceOf(buyer), 1_000_000_000 - PRICE);

        (
            uint256 listingId,
            address oBuyer,
            address oSeller,
            address oToken,
            uint256 amount,
            ,
            Marketplace.OrderState state
        ) = market.orders(orderId);
        assertEq(listingId, id);
        assertEq(oBuyer, buyer);
        assertEq(oSeller, seller);
        assertEq(oToken, address(usdc));
        assertEq(amount, PRICE);
        assertEq(uint8(state), uint8(Marketplace.OrderState.Funded));
    }

    function test_buy_revertsWithoutApproval() public {
        uint256 id = _listing(PRICE);
        vm.prank(buyer);
        vm.expectRevert(); // SafeERC20 / allowance failure
        market.buy(id);
    }

    function test_buy_revertsOnInactiveListing() public {
        uint256 id = _listing(PRICE);
        vm.prank(seller);
        market.updateListing(id, PRICE, STOCK, ITEM_META, false);

        vm.startPrank(buyer);
        usdc.approve(address(market), PRICE);
        vm.expectRevert(bytes("inactive"));
        market.buy(id);
        vm.stopPrank();
    }

    function test_buy_revertsOnSelfBuy() public {
        uint256 id = _listing(PRICE);
        usdc.mint(seller, PRICE);
        vm.startPrank(seller);
        usdc.approve(address(market), PRICE);
        vm.expectRevert(bytes("self-buy"));
        market.buy(id);
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
        assertEq(market.accruedFees(address(usdc)), expectedFee);
        assertEq(usdc.balanceOf(address(market)), expectedFee);
    }

    function test_fee_roundsDownToZeroOnTinyAmount() public {
        vm.prank(owner);
        market.setFeeBps(1); // 0.01%

        // price * 1 / 10000 < 1  => fee rounds to 0
        uint256 id = _listing(9_999);
        vm.startPrank(buyer);
        usdc.approve(address(market), 9_999);
        uint256 orderId = market.buy(id);
        vm.stopPrank();

        vm.prank(buyer);
        market.confirmReceipt(orderId);
        assertEq(market.accruedFees(address(usdc)), 0);
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

        uint256 fee = market.accruedFees(address(usdc));
        assertGt(fee, 0);

        vm.expectEmit(true, true, false, true);
        emit FeesWithdrawn(address(usdc), owner, fee);
        vm.prank(owner);
        market.withdrawFees(address(usdc), owner);

        assertEq(market.accruedFees(address(usdc)), 0);
        assertEq(usdc.balanceOf(owner), fee);
    }

    function test_withdrawFees_rejectsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(bytes("to=0"));
        market.withdrawFees(address(usdc), address(0));
    }

    // --- multi-token behaviour ---

    /// A listing priced in a second (18-decimal) token can be bought, settled,
    /// and have its fees withdrawn fully independently of the USDC accounting.
    function test_multiToken_secondTokenLifecycle() public {
        MockToken dai = new MockToken("Mock DAI", "DAI", 18);
        uint256 daiPrice = 5 * 1e18;

        vm.prank(owner);
        market.setTokenAccepted(address(dai), true);
        vm.prank(owner);
        market.setFeeBps(1000); // 10%

        _registerShop();
        vm.prank(seller);
        uint256 id = market.createListing(address(dai), daiPrice, STOCK, ITEM_META);

        dai.mint(buyer, daiPrice);
        vm.startPrank(buyer);
        dai.approve(address(market), daiPrice);
        uint256 orderId = market.buy(id);
        vm.stopPrank();

        (,,, address oToken, uint256 amount,,) = market.orders(orderId);
        assertEq(oToken, address(dai));
        assertEq(amount, daiPrice);
        assertEq(dai.balanceOf(address(market)), daiPrice);

        vm.prank(buyer);
        market.confirmReceipt(orderId);

        uint256 expectedFee = (daiPrice * 1000) / 10_000;
        assertEq(dai.balanceOf(seller), daiPrice - expectedFee);
        assertEq(market.accruedFees(address(dai)), expectedFee);
        assertEq(market.accruedFees(address(usdc)), 0); // USDC untouched

        vm.prank(owner);
        market.withdrawFees(address(dai), owner);
        assertEq(dai.balanceOf(owner), expectedFee);
        assertEq(market.accruedFees(address(dai)), 0);
    }

    /// Fees accrue and withdraw independently per token.
    function test_multiToken_feesIndependentPerToken() public {
        MockToken dai = new MockToken("Mock DAI", "DAI", 18);
        vm.prank(owner);
        market.setTokenAccepted(address(dai), true);
        vm.prank(owner);
        market.setFeeBps(1000); // 10%

        _registerShop();

        // USDC order
        vm.prank(seller);
        uint256 usdcListing = market.createListing(address(usdc), PRICE, STOCK, ITEM_META);
        uint256 usdcOrder = _fund(usdcListing);
        vm.prank(buyer);
        market.confirmReceipt(usdcOrder);

        // DAI order
        uint256 daiPrice = 3 * 1e18;
        vm.prank(seller);
        uint256 daiListing = market.createListing(address(dai), daiPrice, STOCK, ITEM_META);
        dai.mint(buyer, daiPrice);
        vm.startPrank(buyer);
        dai.approve(address(market), daiPrice);
        uint256 daiOrder = market.buy(daiListing);
        vm.stopPrank();
        vm.prank(buyer);
        market.confirmReceipt(daiOrder);

        uint256 usdcFee = (PRICE * 1000) / 10_000;
        uint256 daiFee = (daiPrice * 1000) / 10_000;
        assertEq(market.accruedFees(address(usdc)), usdcFee);
        assertEq(market.accruedFees(address(dai)), daiFee);

        // Withdrawing one token does not affect the other.
        vm.prank(owner);
        market.withdrawFees(address(usdc), owner);
        assertEq(market.accruedFees(address(usdc)), 0);
        assertEq(market.accruedFees(address(dai)), daiFee);
        assertEq(usdc.balanceOf(owner), usdcFee);

        vm.prank(owner);
        market.withdrawFees(address(dai), owner);
        assertEq(market.accruedFees(address(dai)), 0);
        assertEq(dai.balanceOf(owner), daiFee);
    }

    /// Removing a token from the allowlist after an order is funded must NOT
    /// break settlement of that order — the token is snapshotted on the order.
    function test_multiToken_removedTokenStillSettles() public {
        MockToken dai = new MockToken("Mock DAI", "DAI", 18);
        uint256 daiPrice = 2 * 1e18;

        vm.prank(owner);
        market.setTokenAccepted(address(dai), true);

        _registerShop();
        vm.prank(seller);
        uint256 id = market.createListing(address(dai), daiPrice, STOCK, ITEM_META);

        dai.mint(buyer, daiPrice);
        vm.startPrank(buyer);
        dai.approve(address(market), daiPrice);
        uint256 orderId = market.buy(id);
        vm.stopPrank();

        // Owner de-lists the token AFTER funding.
        vm.prank(owner);
        market.setTokenAccepted(address(dai), false);
        assertFalse(market.acceptedTokens(address(dai)));

        // Existing order still settles in DAI.
        vm.prank(buyer);
        market.confirmReceipt(orderId);
        assertEq(dai.balanceOf(seller), daiPrice);

        // But new listings in the de-listed token are blocked.
        vm.prank(seller);
        vm.expectRevert(bytes("token not accepted"));
        market.createListing(address(dai), daiPrice, STOCK, ITEM_META);
    }

    // --- reentrancy ---

    function _reentrantMarket(ReentrantToken evil) internal returns (Marketplace m) {
        address[] memory tokens = new address[](1);
        tokens[0] = address(evil);
        m = new Marketplace(tokens, owner);
    }

    function test_buy_blocksReentrancy() public {
        ReentrantToken evil = new ReentrantToken();
        Marketplace m = _reentrantMarket(evil);

        evil.mint(seller, PRICE);
        evil.mint(buyer, PRICE);

        vm.prank(seller);
        m.registerShop(SHOP_META);
        vm.prank(seller);
        uint256 id = m.createListing(address(evil), PRICE, STOCK, ITEM_META);

        // On the buyer's token pull, re-enter buy() again.
        evil.arm(address(m), abi.encodeWithSelector(m.buy.selector, id));

        vm.startPrank(buyer);
        evil.approve(address(m), type(uint256).max);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        m.buy(id);
        vm.stopPrank();
    }

    function test_confirmReceipt_blocksReentrancy() public {
        ReentrantToken evil = new ReentrantToken();
        Marketplace m = _reentrantMarket(evil);

        evil.mint(buyer, PRICE);
        vm.prank(seller);
        m.registerShop(SHOP_META);
        vm.prank(seller);
        uint256 id = m.createListing(address(evil), PRICE, STOCK, ITEM_META);

        vm.startPrank(buyer);
        evil.approve(address(m), PRICE);
        uint256 orderId = m.buy(id);
        vm.stopPrank();

        // On the seller payout, re-enter confirmReceipt for the same order.
        evil.arm(address(m), abi.encodeWithSelector(m.confirmReceipt.selector, orderId));

        vm.prank(buyer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        m.confirmReceipt(orderId);
    }
}
