/**
 * useActiveSeller — resolve which shop this storefront should render.
 *
 * The storefront is MULTI-TENANT: one Swarm/ENS deploy at freeemarket.eth serves
 * every shop, picked from the URL path (e.g. freeemarket.eth.limo/autoparts24).
 * Resolution order for the first path segment:
 *
 *   1. A raw 0x…40-hex address → use it directly (escape hatch, no registry).
 *   2. A non-empty slug + a configured HANDLE_REGISTRY → on-chain
 *      `resolve(slug)` against the ownerless HandleRegistry on Gnosis.
 *   3. No slug (root path) → fall back to the build-time VITE_SELLER, which makes
 *      a single-shop, per-shop deploy still work unchanged.
 *
 * Returns `{ seller, handle, status }` where status is:
 *   'resolving' — registry read in flight (show a spinner)
 *   'ok'        — `seller` is a usable address
 *   'notfound'  — slug given but unclaimed (show "shop not found")
 *   'landing'   — root path with nothing configured (show the demo/landing)
 */
import { useReadContract } from 'wagmi';
import { isAddress, getAddress } from 'viem';
import { handleRegistryAbi } from '../abi/handleRegistry.js';
import { HANDLE_REGISTRY, SELLER, GNOSIS_CHAIN_ID } from '../config.js';

/** First non-empty path segment, decoded + lowercased. '' for the root path. */
export function firstPathSegment(pathname) {
  const seg = (pathname || '/').split('/').filter(Boolean)[0] || '';
  try {
    return decodeURIComponent(seg).trim().toLowerCase();
  } catch {
    return seg.trim().toLowerCase();
  }
}

export function useActiveSeller() {
  // Read once at module evaluation per render; the path doesn't change without a
  // full reload on these static SPA hosts, so we don't need a popstate listener.
  const segment =
    typeof window !== 'undefined' ? firstPathSegment(window.location.pathname) : '';

  const isRawAddress = isAddress(segment);
  // Only hit the registry for a real slug (not a raw address, not the root).
  const wantRegistry = Boolean(segment) && !isRawAddress && Boolean(HANDLE_REGISTRY);

  const reg = useReadContract({
    abi: handleRegistryAbi,
    address: HANDLE_REGISTRY || undefined,
    functionName: 'resolve',
    args: [segment],
    chainId: GNOSIS_CHAIN_ID,
    query: { enabled: wantRegistry },
  });

  // 1. Raw address in the path.
  if (isRawAddress) {
    return { seller: getAddress(segment), handle: '', status: 'ok' };
  }

  // 2. Slug → registry resolution.
  if (wantRegistry) {
    if (reg.isLoading) return { seller: '', handle: segment, status: 'resolving' };
    const resolved = reg.data;
    if (resolved && resolved !== '0x0000000000000000000000000000000000000000') {
      return { seller: getAddress(resolved), handle: segment, status: 'ok' };
    }
    return { seller: '', handle: segment, status: 'notfound' };
  }

  // A slug was given but no registry is configured — can't resolve it.
  if (segment && !HANDLE_REGISTRY) {
    return { seller: '', handle: segment, status: 'notfound' };
  }

  // 3. Root path → build-time single-shop fallback, else landing/demo.
  if (SELLER) return { seller: getAddress(SELLER), handle: '', status: 'ok' };
  return { seller: '', handle: '', status: 'landing' };
}
