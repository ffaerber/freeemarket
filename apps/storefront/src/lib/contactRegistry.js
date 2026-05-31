/**
 * ContactRegistry — resolve a party's ECIES public key ON-CHAIN (CLAUDE.md §5).
 *
 * Sellers (and buyers) publish their ECIES public key via SwarmChat's
 * `ContactRegistry` contract. Rather than duplicating a key field on the
 * Marketplace contract, we look it up by address here. The storefront resolves
 * the SELLER's key (to encrypt the shipping address to) and the BUYER's own key
 * is not needed for sending — but the same resolver reads any address's key for
 * the seller→buyer tracking path.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTANT — ABI MUST BE CONFIRMED AGAINST THE DEPLOYED SwarmChat REGISTRY.
 *
 * SwarmChat's ContactRegistry is NOT part of this repo, so its exact function
 * name / selector cannot be verified here. We default to a conventional
 * `getPublicKey(address) view returns (bytes)` view. If the deployed registry
 * uses a different shape (e.g. `contacts(address)` returning a struct, or a
 * `string` instead of `bytes`), this is the ONE place to fix it:
 *   - change `CONTACT_REGISTRY_FN` to the real view name, and
 *   - adjust `CONTACT_REGISTRY_ABI` to match its return type.
 * The resolver below normalizes the returned value to a 0x-hex string.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The view function name to call on the registry. Confirm against SwarmChat. */
export const CONTACT_REGISTRY_FN = 'getPublicKey';

/**
 * Minimal ContactRegistry ABI — lookup ONLY. Keep this in sync with the deployed
 * SwarmChat registry. `bytes` covers a raw uncompressed/compressed ECIES key;
 * if the registry returns a hex `string`, change `outputs[0].type` to 'string'.
 */
export const CONTACT_REGISTRY_ABI = [
  {
    type: 'function',
    name: CONTACT_REGISTRY_FN,
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'publicKey', type: 'bytes' }],
  },
];

/**
 * Normalize a registry return value to a non-empty 0x-hex string, or null.
 * Accepts viem `bytes` (already 0x-hex), a plain hex string, or empty.
 */
function normalizeKey(value) {
  if (value == null) return null;
  const hex = String(value).trim();
  if (!hex || hex === '0x' || hex.toLowerCase() === '0x00') return null;
  return hex.startsWith('0x') ? hex : `0x${hex}`;
}

/**
 * Resolve `account`'s published ECIES public key via the ContactRegistry.
 *
 * @param {import('viem').PublicClient} client  a viem/wagmi public client.
 * @param {string} registryAddress  ContactRegistry address (VITE_CONTACT_REGISTRY).
 *   When unset/empty the app is UNCONFIGURED — returns null (caller falls back to stub).
 * @param {string} account  the address whose key to resolve.
 * @returns {Promise<string|null>}  0x-hex public key, or null if unconfigured/not found.
 */
export async function resolvePublicKey(client, registryAddress, account) {
  if (!registryAddress || typeof registryAddress !== 'string' || !registryAddress.trim()) {
    return null; // unconfigured — no registry address.
  }
  if (!client || !account) return null;
  try {
    const result = await client.readContract({
      abi: CONTACT_REGISTRY_ABI,
      address: registryAddress.trim(),
      functionName: CONTACT_REGISTRY_FN,
      args: [account],
    });
    return normalizeKey(result);
  } catch {
    // Registry missing/wrong ABI/no entry → treat as unconfigured (stub fallback).
    return null;
  }
}
