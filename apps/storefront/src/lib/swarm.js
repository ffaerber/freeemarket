/**
 * Swarm helpers for the storefront.
 *
 * Shop profiles and listing metadata are JSON documents stored on Swarm and
 * pointed to by on-chain `bytes32` references (`shops(seller).metadata`,
 * `listings(id).metadata`). Images are also Swarm references. We read them
 * through swarm-connect's `read`: the user's Bee node once connected, the
 * public gateway (VITE_GATEWAY_URL) otherwise.
 *
 * Validation is delegated to the shared @freeemarket/schema runtime guards so
 * the storefront and CMS agree on the exact shape (CLAUDE.md §6).
 */
import { isShopProfile, isListingMetadata } from '@freeemarket/schema';
import { withRetry } from './retry.js';

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
 * Swarm path for an image reference, for <SwarmImage path=…> (which reads it
 * through swarm-connect's `read`: the user's node, else the public gateway).
 * @param {string} ref Swarm reference (bytes32 or bare hex)
 * @returns {string | null}
 */
export function swarmImagePath(ref) {
  const r = normalizeRef(ref);
  return r ? `/bytes/${r}` : null;
}

const ATTEMPT_TIMEOUT_MS = 30_000;

/**
 * Fetch and JSON-parse a Swarm document through swarm-connect's `read` (the
 * user's node when connected, the public gateway otherwise), retrying with
 * backoff: a gateway that is slow on one chunk usually has it next time.
 * @param {import('@ffaerber/swarm-connect').SwarmReadState} read
 * @param {string} ref Swarm reference (bytes32 or bare hex)
 * @returns {Promise<unknown | null>} parsed JSON, or null on any failure.
 */
export async function fetchSwarmJson(read, ref) {
  const r = normalizeRef(ref);
  if (!r) return null;
  try {
    const text = await withRetry(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
      try {
        const res = await read.fetch(`/bytes/${r}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } finally {
        clearTimeout(timer);
      }
    });
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
export async function fetchShopProfile(read, ref) {
  const json = await fetchSwarmJson(read, ref);
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
export async function fetchListingMetadata(read, ref) {
  const json = await fetchSwarmJson(read, ref);
  if (json == null) return null;
  if (!isListingMetadata(json)) {
    console.warn(
      '[swarm] fetched object is not a valid ListingMetadata, skipping',
    );
    return null;
  }
  return json;
}
