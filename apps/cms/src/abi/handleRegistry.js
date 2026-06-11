/**
 * Minimal viem-style ABI for the FreeeMarket `HandleRegistry` contract.
 * The CMS needs the write side (claim/release) plus the reverse read
 * (sellerHandle) to show the merchant's current handle.
 * Full surface lives in contracts/src/HandleRegistry.sol.
 */
export const handleRegistryAbi = [
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'handle', type: 'string' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'release',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
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
    name: 'sellerHandle',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'string' }],
  },
];
