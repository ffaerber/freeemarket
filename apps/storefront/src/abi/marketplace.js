/**
 * Minimal viem-style ABI for the FreeMarket `Marketplace` contract.
 * Only the pieces the storefront needs: the `ListingCreated`/`OrderFunded`
 * events, the `listings`/`shops`/`acceptedTokens` views, and `buy`.
 * Full surface lives in contracts/src/Marketplace.sol.
 */
export const marketplaceAbi = [
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
  {
    type: 'function',
    name: 'acceptedTokens',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
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
];
