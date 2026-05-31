/**
 * Fuller viem-style ABI for the FreeMarket `Marketplace` contract — the CMS
 * write surface plus the views/events it reads. Signatures match
 * contracts/src/Marketplace.sol EXACTLY.
 *
 * Note on `orders(uint256)`: the public mapping getter returns the Order struct
 * fields in declaration order — (listingId, buyer, seller, token, amount,
 * fundedAt[uint64], state[uint8]). The OrderState enum is:
 *   0 None · 1 Funded · 2 Completed · 3 Disputed · 4 Refunded
 * (see ORDER_STATE below).
 */
export const marketplaceAbi = [
  // --- Events ---
  {
    type: 'event',
    name: 'ShopRegistered',
    inputs: [
      { name: 'seller', type: 'address', indexed: true },
      { name: 'metadata', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ListingCreated',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'seller', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'price', type: 'uint256', indexed: false },
      { name: 'stock', type: 'uint256', indexed: false },
      { name: 'metadata', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ListingUpdated',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'price', type: 'uint256', indexed: false },
      { name: 'stock', type: 'uint256', indexed: false },
      { name: 'metadata', type: 'bytes32', indexed: false },
      { name: 'active', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'StockChanged',
    inputs: [
      { name: 'id', type: 'uint256', indexed: true },
      { name: 'newStock', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'OrderFunded',
    inputs: [
      { name: 'orderId', type: 'uint256', indexed: true },
      { name: 'listingId', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'seller', type: 'address', indexed: false },
      { name: 'token', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'OrderCompleted',
    inputs: [
      { name: 'orderId', type: 'uint256', indexed: true },
      { name: 'payout', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'OrderRefunded',
    inputs: [
      { name: 'orderId', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'DisputeOpened',
    inputs: [
      { name: 'orderId', type: 'uint256', indexed: true },
      { name: 'by', type: 'address', indexed: true },
    ],
  },

  // --- Shop write/read ---
  {
    type: 'function',
    name: 'registerShop',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'metadata', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'shops',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'registered', type: 'bool' },
      { name: 'metadata', type: 'bytes32' },
    ],
  },

  // --- Listing write/read ---
  {
    type: 'function',
    name: 'createListing',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'price', type: 'uint256' },
      { name: 'stock', type: 'uint256' },
      { name: 'metadata', type: 'bytes32' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'updateListing',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'price', type: 'uint256' },
      { name: 'stock', type: 'uint256' },
      { name: 'metadata', type: 'bytes32' },
      { name: 'active', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'listings',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'seller', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'price', type: 'uint256' },
      { name: 'stock', type: 'uint256' },
      { name: 'metadata', type: 'bytes32' },
      { name: 'active', type: 'bool' },
    ],
  },

  // --- Orders / escrow ---
  {
    type: 'function',
    name: 'orders',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'listingId', type: 'uint256' },
      { name: 'buyer', type: 'address' },
      { name: 'seller', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'fundedAt', type: 'uint64' },
      { name: 'state', type: 'uint8' },
    ],
  },
  {
    type: 'function',
    name: 'buy',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'listingId', type: 'uint256' }],
    outputs: [{ name: 'orderId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'confirmReceipt',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'orderId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimAfterTimeout',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'orderId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'openDispute',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'orderId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'resolveDispute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'orderId', type: 'uint256' },
      { name: 'refundBuyer', type: 'bool' },
    ],
    outputs: [],
  },

  // --- Admin / config views ---
  {
    type: 'function',
    name: 'setTokenAccepted',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'accepted', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'acceptedTokens',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'accruedFees',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'owner',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'autoReleasePeriod',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
];

/** OrderState enum from Marketplace.sol — index === on-chain uint8 value. */
export const ORDER_STATE = ['None', 'Funded', 'Completed', 'Disputed', 'Refunded'];

/** Human label for an OrderState uint8 (0..4). */
export function orderStateLabel(state) {
  return ORDER_STATE[Number(state)] ?? `Unknown(${state})`;
}
