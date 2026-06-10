/**
 * Minimal viem-style ABI for the FreeMarket `HandleRegistry` contract.
 * The storefront only needs the read side: resolve a URL handle → seller
 * address. Full surface lives in contracts/src/HandleRegistry.sol.
 */
export const handleRegistryAbi = [
  {
    type: 'event',
    name: 'HandleClaimed',
    inputs: [
      { name: 'handleHash', type: 'bytes32', indexed: true },
      { name: 'handle', type: 'string', indexed: false },
      { name: 'seller', type: 'address', indexed: true },
    ],
  },
  {
    type: 'function',
    name: 'resolve',
    stateMutability: 'view',
    inputs: [{ name: 'handle', type: 'string' }],
    outputs: [{ name: 'seller', type: 'address' }],
  },
  {
    type: 'function',
    name: 'handleToSeller',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'sellerHandle',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'string' }],
  },
];
