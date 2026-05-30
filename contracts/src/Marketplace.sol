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
 *  - Payment is held in escrow until the buyer confirms receipt (or a
 *    timeout elapses). Either party can open a dispute for the arbiter.
 *
 *  This contract is pure escrow + listings. Encrypted shipping addresses and
 *  seller encryption keys are deliberately kept OFF-CHAIN (CLAUDE.md §5):
 *  sellers publish their ECIES key via SwarmChat's ContactRegistry, and buyers
 *  send their address as an ECIES-encrypted PSS message — stamped with a
 *  short-lived Swarm postage batch so the ciphertext self-expires after
 *  fulfillment. The seller correlates an incoming address to an order via the
 *  on-chain `OrderFunded(orderId, …, buyer, …)` event. No address, and no
 *  pointer to one, ever touches the public chain.
 *
 * @dev USDC has 6 decimals: a price of 10 USDC == 10_000_000. Buyers must
 *      `approve` this contract for the price before calling `buy`. The USDC
 *      address is set once at deployment (use the canonical token for Gnosis
 *      Chain, or commit to xDAI — see CLAUDE.md §3).
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
        bytes32 metadata; // Swarm ref: shop name, banner, description
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
        uint256 amount
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

    /// @notice Register (or update) your shop. `metadata` is a Swarm ref to the
    ///         shop profile. Seller encryption keys live off-chain in SwarmChat's
    ///         ContactRegistry (CLAUDE.md §5), not here.
    function registerShop(bytes32 metadata) external {
        Shop storage s = shops[msg.sender];
        s.registered = true;
        s.metadata = metadata;
        emit ShopRegistered(msg.sender, metadata);
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

    /// @notice Buyer must `approve` this contract for `price` USDC first. The
    ///         encrypted shipping address is delivered to the seller off-chain
    ///         over PSS once the order is funded (CLAUDE.md §5), keyed by the
    ///         emitted `orderId`.
    function buy(uint256 listingId)
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
            fundedAt: uint64(block.timestamp),
            state: OrderState.Funded
        });

        usdc.safeTransferFrom(msg.sender, address(this), l.price);
        emit OrderFunded(orderId, listingId, msg.sender, l.seller, l.price);
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
