// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Marketplace
 * @notice A permissionless, multi-vendor marketplace with USDC escrow.
 *
 *  - Any address can register a shop and list items (e.g. a freeze-dried
 *    fruit shop with separate listings for 10g / 100g strawberries, etc.).
 *  - Each shop publishes an ECIES encryption public key. Buyers encrypt
 *    their shipping address to that key CLIENT-SIDE, upload the ciphertext
 *    to Swarm, and pass only the Swarm reference on-chain. No plaintext
 *    address ever touches the public chain.
 *  - Payment is held in escrow until the buyer confirms receipt (or a
 *    timeout elapses). Either party can open a dispute for the arbiter.
 *
 * @dev USDC has 6 decimals: a price of 10 USDC == 10_000_000. Buyers must
 *      `approve` this contract for the price before calling `buy`. The USDC
 *      address is set once at deployment (use the canonical token for Base).
 */
contract Marketplace is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    uint16 public feeBps;                          // platform fee, basis points (100 = 1%)
    uint16 public constant MAX_FEE_BPS = 1000;     // hard cap: 10%
    uint256 public autoReleasePeriod = 14 days;    // buyer silence -> seller may claim
    uint256 public accruedFees;

    enum OrderState { None, Funded, Completed, Disputed, Refunded }

    struct Shop {
        bool registered;
        bytes32 metadata;       // Swarm ref: shop name, banner, description
        bytes encryptionPubKey; // seller's ECIES public key; buyers encrypt shipping info to this
    }

    struct Listing {
        address seller;
        uint256 price;     // USDC smallest unit
        bytes32 metadata;  // Swarm ref: item title, photos, package size (e.g. 100g strawberries)
        bool active;
    }

    struct Order {
        uint256 listingId;
        address buyer;
        address seller;
        uint256 amount;
        bytes32 shippingRef; // Swarm ref to the buyer's ECIES-encrypted shipping address
        uint64  fundedAt;
        OrderState state;
    }

    uint256 public nextListingId = 1;
    uint256 public nextOrderId = 1;
    mapping(address => Shop) public shops;
    mapping(uint256 => Listing) public listings;
    mapping(uint256 => Order) public orders;

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

    constructor(address _usdc, address _owner) Ownable(_owner) {
        require(_usdc != address(0), "usdc=0");
        usdc = IERC20(_usdc);
    }

    // --- Shops ---

    /// @notice Register (or update) your shop. encryptionPubKey is the public
    ///         key buyers will encrypt their shipping address to.
    function registerShop(bytes32 metadata, bytes calldata encryptionPubKey) external {
        require(encryptionPubKey.length >= 33, "bad key"); // 33B compressed / 65B uncompressed secp256k1
        Shop storage s = shops[msg.sender];
        s.registered = true;
        s.metadata = metadata;
        s.encryptionPubKey = encryptionPubKey;
        emit ShopRegistered(msg.sender, metadata);
    }

    /// @notice Explicit getter; the auto-generated mapping getter omits `bytes`.
    function shopEncryptionKey(address seller) external view returns (bytes memory) {
        return shops[seller].encryptionPubKey;
    }

    // --- Listings ---

    function createListing(uint256 price, bytes32 metadata) external returns (uint256 id) {
        require(shops[msg.sender].registered, "no shop");
        require(price > 0, "price=0");
        id = nextListingId++;
        listings[id] = Listing({seller: msg.sender, price: price, metadata: metadata, active: true});
        emit ListingCreated(id, msg.sender, price, metadata);
    }

    function updateListing(uint256 id, uint256 price, bytes32 metadata, bool active) external {
        Listing storage l = listings[id];
        require(l.seller == msg.sender, "not seller");
        require(price > 0, "price=0");
        l.price = price;
        l.metadata = metadata;
        l.active = active;
        emit ListingUpdated(id, price, metadata, active);
    }

    // --- Buying / escrow ---

    /// @notice Buyer must `approve` this contract for `price` USDC first.
    /// @param shippingRef Swarm reference to the buyer's encrypted shipping address.
    function buy(uint256 listingId, bytes32 shippingRef)
        external
        nonReentrant
        returns (uint256 orderId)
    {
        Listing memory l = listings[listingId];
        require(l.active, "inactive");
        require(l.seller != msg.sender, "self-buy");

        orderId = nextOrderId++;
        orders[orderId] = Order({
            listingId: listingId,
            buyer: msg.sender,
            seller: l.seller,
            amount: l.price,
            shippingRef: shippingRef,
            fundedAt: uint64(block.timestamp),
            state: OrderState.Funded
        });

        usdc.safeTransferFrom(msg.sender, address(this), l.price);
        emit OrderFunded(orderId, listingId, msg.sender, l.seller, l.price, shippingRef);
    }

    /// @notice Buyer releases escrow to the seller after receiving the item.
    function confirmReceipt(uint256 orderId) external nonReentrant {
        Order storage o = orders[orderId];
        require(o.state == OrderState.Funded, "not funded");
        require(o.buyer == msg.sender, "not buyer");
        _release(orderId, o);
    }

    /// @notice Seller claims escrow if the buyer never confirms within the window.
    function claimAfterTimeout(uint256 orderId) external nonReentrant {
        Order storage o = orders[orderId];
        require(o.state == OrderState.Funded, "not funded");
        require(o.seller == msg.sender, "not seller");
        require(block.timestamp >= uint256(o.fundedAt) + autoReleasePeriod, "too early");
        _release(orderId, o);
    }

    function _release(uint256 orderId, Order storage o) internal {
        o.state = OrderState.Completed;
        uint256 fee = (o.amount * feeBps) / 10_000;
        uint256 payout = o.amount - fee;
        accruedFees += fee;
        usdc.safeTransfer(o.seller, payout);
        emit OrderCompleted(orderId, payout, fee);
    }

    // --- Disputes ---

    function openDispute(uint256 orderId) external {
        Order storage o = orders[orderId];
        require(o.state == OrderState.Funded, "not funded");
        require(msg.sender == o.buyer || msg.sender == o.seller, "not party");
        o.state = OrderState.Disputed;
        emit DisputeOpened(orderId, msg.sender);
    }

    /// @notice Arbiter resolves a dispute: refund the buyer or pay the seller.
    function resolveDispute(uint256 orderId, bool refundBuyer) external onlyOwner nonReentrant {
        Order storage o = orders[orderId];
        require(o.state == OrderState.Disputed, "not disputed");
        if (refundBuyer) {
            o.state = OrderState.Refunded;
            usdc.safeTransfer(o.buyer, o.amount);
            emit OrderRefunded(orderId, o.amount);
        } else {
            _release(orderId, o);
        }
    }

    // --- Admin ---

    function setFeeBps(uint16 _feeBps) external onlyOwner {
        require(_feeBps <= MAX_FEE_BPS, "fee too high");
        feeBps = _feeBps;
        emit FeeUpdated(_feeBps);
    }

    function setAutoReleasePeriod(uint256 period) external onlyOwner {
        require(period >= 1 days && period <= 90 days, "out of range");
        autoReleasePeriod = period;
        emit AutoReleasePeriodUpdated(period);
    }

    function withdrawFees(address to) external onlyOwner nonReentrant {
        require(to != address(0), "to=0");
        uint256 amt = accruedFees;
        accruedFees = 0;
        usdc.safeTransfer(to, amt);
        emit FeesWithdrawn(to, amt);
    }
}
