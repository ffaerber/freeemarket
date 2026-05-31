// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title Marketplace
 * @notice A permissionless, multi-vendor marketplace with multi-token escrow.
 *
 *  - Any address can register a shop and list items (e.g. a freeze-dried
 *    fruit shop with separate listings for 10g / 100g strawberries, etc.).
 *  - Each listing is priced in an accepted ERC-20 (owner-curated allowlist).
 *    Different listings — even within one shop — may settle in different
 *    tokens (e.g. USDC for one item, a wrapped-xDAI stable for another).
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
 * @dev Prices are denominated in each token's smallest unit, so decimals vary
 *      per token (USDC has 6 decimals: 10 USDC == 10_000_000; an 18-decimal
 *      token would use 10 * 1e18). Buyers must `approve` this contract for the
 *      price in the listing's token before calling `buy`. The owner curates the
 *      accepted-token allowlist via `setTokenAccepted` (initial set is seeded at
 *      deployment — see CLAUDE.md §3/§4).
 *
 * @dev SECURITY HARDENING (CLAUDE.md step #8, pre-audit). Four mitigations are
 *      baked in; the contract remains unaudited:
 *
 *      1. PERMANENT ARBITER. The owner is the sole dispute arbiter, so losing
 *         ownership would lock every Disputed order's funds forever. This
 *         contract therefore uses `Ownable2Step` (a transfer must be accepted
 *         by the new owner — no fat-fingering the arbiter role to a wrong/zero
 *         address) and `renounceOwnership` is overridden to REVERT (the arbiter
 *         can never be removed).
 *
 *      2. FEE-ON-TRANSFER SAFE ESCROW. `buy` records the ACTUALLY-received
 *         amount (balance delta around the transfer), not the listed price, so
 *         a deflationary/skimming token can never make one order over-draw
 *         another's escrow. The escrow-solvency invariant holds even if such a
 *         token slips the allowlist.
 *
 *      3. ALLOWLIST RE-CHECK ON BUY. `buy` re-checks `acceptedTokens[token]`,
 *         so de-listing a compromised token stops NEW funding immediately.
 *         Already-funded orders settle on their snapshotted token and are
 *         unaffected (their settlement path does not re-check the allowlist).
 *
 *      4. CIRCUIT BREAKER (Pausable). The owner can `pause()` to halt INTAKE
 *         only — `buy` and `createListing`. Settlement and exit paths
 *         (confirmReceipt, claimAfterTimeout, openDispute, resolveDispute,
 *         withdrawFees, updateListing) are NEVER pausable, so pausing can stop
 *         new money/listings but can NEVER trap escrowed funds.
 */
contract Marketplace is ReentrancyGuard, Ownable2Step, Pausable {
    using SafeERC20 for IERC20;

    /// @notice Owner-curated allowlist of ERC-20s a listing may be priced in.
    mapping(address => bool) public acceptedTokens;

    uint16 public feeBps;                          // platform fee, basis points (100 = 1%)
    uint16 public constant MAX_FEE_BPS = 1000;     // hard cap: 10%
    uint256 public autoReleasePeriod = 14 days;    // buyer silence -> seller may claim

    /// @notice Fees accrued per token (each token settles independently).
    mapping(address => uint256) public accruedFees;

    enum OrderState { None, Funded, Completed, Disputed, Refunded }

    struct Shop {
        bool registered;
        bytes32 metadata; // Swarm ref: shop name, banner, description
    }

    struct Listing {
        address seller;
        address token;     // accepted ERC-20 this listing is priced/settled in
        uint256 price;     // in token's smallest unit (decimals vary per token)
        uint256 stock;     // remaining units; a unit count (NOT a token amount). buy() decrements; 0 == sold out
        bytes32 metadata;  // Swarm ref: item title, photos, package size (e.g. 100g strawberries)
        bool active;
    }

    struct Order {
        uint256 listingId;
        address buyer;
        address seller;
        address token;     // snapshot of the listing's token at buy time
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
    /// @notice Emitted whenever a listing's remaining `stock` changes (on buy and on update),
    ///         so storefronts/indexers can track inventory cheaply without re-reading the listing.
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

    /// @param initialTokens ERC-20s to seed the accepted-token allowlist with.
    /// @param _owner        arbiter/owner. (Ownable2Step extends Ownable, so the
    ///                      initial owner is still set via `Ownable(_owner)`.)
    constructor(address[] memory initialTokens, address _owner) Ownable(_owner) {
        for (uint256 i = 0; i < initialTokens.length; i++) {
            address token = initialTokens[i];
            require(token != address(0), "token=0");
            acceptedTokens[token] = true;
            emit TokenAccepted(token, true);
        }
    }

    // --- Ownership / arbiter (HARDENING 1: permanent arbiter) ---

    /// @notice Renouncing ownership is DISABLED: the owner is the sole dispute
    ///         arbiter, so removing it would permanently lock every Disputed
    ///         order's escrow. Ownership can still be TRANSFERRED (2-step, via
    ///         Ownable2Step), but never abandoned.
    function renounceOwnership() public override onlyOwner {
        revert("renounce disabled: arbiter required");
    }

    // --- Admin: token allowlist ---

    /// @notice Add or remove an ERC-20 from the accepted-token allowlist. Removing
    ///         a token only blocks NEW listings/buys in it; existing orders settle
    ///         in their snapshotted token regardless.
    function setTokenAccepted(address token, bool accepted) external onlyOwner {
        require(token != address(0), "token=0");
        acceptedTokens[token] = accepted;
        emit TokenAccepted(token, accepted);
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

    /// @notice Create a listing priced in `token`, which must be on the accepted
    ///         allowlist. `price` is in the token's smallest unit. `stock` is the
    ///         initial number of units available (a count, not a token amount) and
    ///         must be > 0; each `buy` decrements it by one.
    function createListing(address token, uint256 price, uint256 stock, bytes32 metadata)
        external
        whenNotPaused
        returns (uint256 id)
    {
        require(shops[msg.sender].registered, "no shop");
        require(acceptedTokens[token], "token not accepted");
        require(price > 0, "price=0");
        require(stock > 0, "stock=0");
        id = nextListingId++;
        listings[id] = Listing({
            seller: msg.sender,
            token: token,
            price: price,
            stock: stock,
            metadata: metadata,
            active: true
        });
        emit ListingCreated(id, msg.sender, token, price, stock, metadata);
    }

    /// @notice Edit price/stock/metadata/active. `stock` may be set to any value,
    ///         including 0 (sold out / paused by exhaustion) or raised to restock.
    ///         The settlement token is intentionally immutable after creation
    ///         (changing it mid-life would complicate in-flight orders); create a
    ///         new listing to sell in another token.
    function updateListing(uint256 id, uint256 price, uint256 stock, bytes32 metadata, bool active) external {
        Listing storage l = listings[id];
        require(l.seller == msg.sender, "not seller");
        require(price > 0, "price=0");
        l.price = price;
        l.stock = stock;
        l.metadata = metadata;
        l.active = active;
        emit ListingUpdated(id, price, stock, metadata, active);
        emit StockChanged(id, stock);
    }

    // --- Buying / escrow ---

    /// @notice Buyer must `approve` this contract for `price` of the listing's
    ///         token first. The encrypted shipping address is delivered to the
    ///         seller off-chain over PSS once the order is funded (CLAUDE.md §5),
    ///         keyed by the emitted `orderId`.
    function buy(uint256 listingId)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 orderId)
    {
        Listing memory l = listings[listingId];
        require(l.active, "inactive");
        require(l.stock > 0, "out of stock");
        require(l.seller != msg.sender, "self-buy");
        // HARDENING 3: re-check the allowlist at funding time. If the owner has
        // de-listed this token (e.g. it was compromised), block NEW funding even
        // for listings created while it was accepted. Already-funded orders are
        // UNAFFECTED — settlement (_release / resolveDispute) uses the order's
        // snapshotted token and never re-checks this allowlist, so existing
        // escrow always settles in the token it was funded in.
        require(acceptedTokens[l.token], "token not accepted");

        orderId = nextOrderId++;
        // Create the order with everything known BEFORE the transfer. `amount`
        // is provisionally the price; it is overwritten post-transfer with the
        // actually-received amount (see HARDENING 2 below). State and stock
        // effects stay PRE-transfer to preserve checks-effects-interactions.
        orders[orderId] = Order({
            listingId: listingId,
            buyer: msg.sender,
            seller: l.seller,
            token: l.token,
            amount: l.price,
            fundedAt: uint64(block.timestamp),
            state: OrderState.Funded
        });

        // Effects before the external token pull (checks-effects-interactions):
        // decrement the STORAGE listing's stock (the loaded `l` is a memory copy).
        uint256 newStock = l.stock - 1;
        listings[listingId].stock = newStock;
        emit StockChanged(listingId, newStock);

        // HARDENING 2: fee-on-transfer / deflationary token safety. A skimming
        // token may deliver LESS than `price`; recording `price` would let this
        // order over-draw other orders' escrow on payout/refund. Measure the
        // balance delta and escrow exactly what was received. `amount` is the
        // ONLY field written AFTER the external call — that is safe because the
        // function is `nonReentrant` (no re-entry can observe the interim state)
        // and CEI is otherwise preserved (state/stock are set pre-transfer).
        uint256 balanceBefore = IERC20(l.token).balanceOf(address(this));
        IERC20(l.token).safeTransferFrom(msg.sender, address(this), l.price);
        uint256 received = IERC20(l.token).balanceOf(address(this)) - balanceBefore;
        require(received > 0, "no funds received");

        orders[orderId].amount = received;
        emit OrderFunded(orderId, listingId, msg.sender, l.seller, l.token, received);
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
        accruedFees[o.token] += fee;
        IERC20(o.token).safeTransfer(o.seller, payout);
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
            IERC20(o.token).safeTransfer(o.buyer, o.amount);
            emit OrderRefunded(orderId, o.amount);
        } else {
            _release(orderId, o);
        }
    }

    // --- Admin ---

    // --- Admin: circuit breaker (HARDENING 4: Pausable on INTAKE only) ---

    /// @notice Pause INTAKE: `buy` and `createListing` revert while paused.
    /// @dev INVARIANT: pausing halts new money + new listings ONLY. Settlement
    ///      and exit paths (confirmReceipt, claimAfterTimeout, openDispute,
    ///      resolveDispute, withdrawFees) and updateListing are NEVER pausable —
    ///      so the owner can never trap escrowed funds by pausing. Pause stops
    ///      intake, never withdrawals.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume intake (re-enable `buy` / `createListing`).
    function unpause() external onlyOwner {
        _unpause();
    }

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

    /// @notice Withdraw fees accrued in a specific token.
    function withdrawFees(address token, address to) external onlyOwner nonReentrant {
        require(to != address(0), "to=0");
        uint256 amt = accruedFees[token];
        accruedFees[token] = 0;
        IERC20(token).safeTransfer(to, amt);
        emit FeesWithdrawn(token, to, amt);
    }
}
