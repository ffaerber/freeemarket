/**
 * Swarm READ helpers for the CMS.
 *
 * COPIED from apps/storefront/src/lib/swarm.js (we can't import across apps).
 * Keep these two files in sync — they share the same on-chain bytes32 ref
 * convention and the same @freeemarket/schema runtime guards (CLAUDE.md §6).
 * The CMS adds WRITE helpers in ./swarmWrite.js; the read side is identical.
 */
import { Bee } from '@ethersphere/bee-js';
import { isShopProfile, isListingMetadata } from '@freeemarket/schema';

/**
 * Normalize a Swarm reference. On-chain refs are `bytes32` (0x-prefixed, 64
 * hex chars). Bee wants the bare 64-char hex. Swarm refs in metadata JSON may
 * already be bare hex (or full 128-char encrypted refs). We strip a leading
 * `0x` and reject obviously empty/zero refs.
 * @param {string} ref
 * @returns {string | null} bare reference, or null if it's empty/zero.
 */
export function normalizeRef(ref) {
  if (!ref || typeof ref !== 'string') return null;
  let r = ref.trim();
  if (r.startsWith('0x') || r.startsWith('0X')) r = r.slice(2);
  if (!/^[0-9a-fA-F]+$/.test(r)) return null;
  // A bytes32 of all zeros means "unset" on-chain.
  if (/^0+$/.test(r)) return null;
  return r.toLowerCase();
}

/**
 * Format a bare 64-char Swarm reference as an on-chain `bytes32` (0x-prefixed).
 * Swarm uploads return a 64-char hex reference; `registerShop`/`createListing`
 * take a `bytes32`. Throws if the reference isn't a 32-byte hash (e.g. a 128-
 * char encrypted reference can't be stored in a single bytes32 slot).
 * @param {string} ref bare or 0x-prefixed Swarm reference
 * @returns {`0x${string}`}
 */
export function refToBytes32(ref) {
  const r = normalizeRef(ref);
  if (!r) throw new Error('refToBytes32: empty/zero reference');
  if (r.length !== 64) {
    throw new Error(
      `refToBytes32: expected a 32-byte (64-hex) Swarm reference, got ${r.length} chars. ` +
        'Encrypted (128-char) references do not fit in a bytes32 slot.',
    );
  }
  return `0x${r}`;
}

/**
 * Build a URL suitable for an <img src> from a Swarm image reference.
 * @param {string} beeUrl base Bee/gateway URL
 * @param {string} ref Swarm reference (bytes32 or bare hex)
 * @returns {string | null}
 */
export function swarmImageUrl(beeUrl, ref) {
  const r = normalizeRef(ref);
  if (!r) return null;
  const base = beeUrl.replace(/\/+$/, '');
  return `${base}/bytes/${r}`;
}

/**
 * Fetch and JSON-parse a Swarm document via bee-js.
 * @param {string} beeUrl base Bee/gateway URL
 * @param {string} ref Swarm reference (bytes32 or bare hex)
 * @returns {Promise<unknown | null>} parsed JSON, or null on any failure.
 */
export async function fetchSwarmJson(beeUrl, ref) {
  const r = normalizeRef(ref);
  if (!r) return null;
  try {
    const bee = new Bee(beeUrl);
    const data = await bee.downloadData(r);
    const text =
      typeof data.text === 'function'
        ? data.text()
        : new TextDecoder().decode(data);
    return JSON.parse(text);
  } catch (err) {
    console.warn(`[swarm] failed to fetch/parse ref ${r}:`, err);
    return null;
  }
}

/**
 * Fetch a ShopProfile from Swarm and validate it against the shared schema.
 * @returns {Promise<import('@freeemarket/schema').ShopProfile | null>}
 */
export async function fetchShopProfile(beeUrl, ref) {
  const json = await fetchSwarmJson(beeUrl, ref);
  if (json == null) return null;
  if (!isShopProfile(json)) {
    console.warn('[swarm] fetched object is not a valid ShopProfile, skipping');
    return null;
  }
  return json;
}

/**
 * Fetch a ListingMetadata from Swarm and validate it against the shared schema.
 * @returns {Promise<import('@freeemarket/schema').ListingMetadata | null>}
 */
export async function fetchListingMetadata(beeUrl, ref) {
  const json = await fetchSwarmJson(beeUrl, ref);
  if (json == null) return null;
  if (!isListingMetadata(json)) {
    console.warn(
      '[swarm] fetched object is not a valid ListingMetadata, skipping',
    );
    return null;
  }
  return json;
}
