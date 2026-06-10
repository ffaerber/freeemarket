/**
 * Minimal viem-style ABI for the FreeMarket `HandleRegistry` contract.
 * The storefront only needs the read side: resolve a URL handle → seller
 * address. Full surface lives in contracts/src/HandleRegistry.sol.
 */
export const handleRegistryAbi = [
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
