/**
 * Swarm helpers for the storefront.
 *
 * Shop profiles and listing metadata are JSON documents stored on Swarm and
 * pointed to by on-chain `bytes32` references (`shops(seller).metadata`,
 * `listings(id).metadata`). Images are also Swarm references. We read them
 * through a Bee node / public gateway base URL (see VITE_BEE_URL).
 *
 * Validation is delegated to the shared @freemarket/schema runtime guards so
 * the storefront and CMS agree on the exact shape (CLAUDE.md §6).
 */
import { Bee } from '@ethersphere/bee-js';
import { isShopProfile, isListingMetadata } from '@freemarket/schema';

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
    // bee-js Data has .text(); fall back to decoding the bytes.
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
 * @returns {Promise<import('@freemarket/schema').ShopProfile | null>}
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
 * @returns {Promise<import('@freemarket/schema').ListingMetadata | null>}
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
