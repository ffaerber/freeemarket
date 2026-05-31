/**
 * useListings — load this shop's listings from the chain + Swarm.
 *
 * Pipeline (all REAL):
 *   1. getContractEvents `ListingCreated(id, seller, token, price, metadata)`
 *      filtered by the shop's `seller` address → candidate listing ids.
 *   2. For each unique id, read current on-chain state via `listings(id)` →
 *      (seller, token, price, metadata, active). Skip inactive listings.
 *   3. Read the listing token's ERC-20 `decimals()` + `symbol()` so prices
 *      format correctly (decimals vary per token — never hardcoded). Fall back
 *      to the metadata `payment` hint, then 18.
 *   4. Fetch + validate the `ListingMetadata` JSON from Swarm for each listing.
 *   5. Return a normalized array the white-label UI renders directly.
 *
 * The `price` from step 1's event is the price at creation time; we prefer the
 * current `listings(id).price` from step 2 since the seller may have updated it.
 */
import { useQuery } from '@tanstack/react-query';
import { useClient } from 'wagmi';
import { formatUnits, getAddress } from 'viem';
import { marketplaceAbi } from '../abi/marketplace.js';
import { erc20Abi } from '../abi/erc20.js';
import { fetchListingMetadata } from '../lib/swarm.js';
import {
  MARKETPLACE_ADDRESS,
  SELLER,
  BEE_URL,
  GNOSIS_CHAIN_ID,
} from '../config.js';

/** Read decimals+symbol for a token, with graceful fallbacks. */
async function readToken(client, token, hint) {
  let decimals;
  let symbol;
  try {
    decimals = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'decimals',
    });
  } catch {
    decimals = undefined;
  }
  try {
    symbol = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'symbol',
    });
  } catch {
    symbol = undefined;
  }
  // decimals: on-chain → metadata payment hint → 18.
  const resolvedDecimals =
    decimals != null ? Number(decimals) : hint?.decimals != null ? hint.decimals : 18;
  const resolvedSymbol = symbol || hint?.symbol || 'TOKEN';
  return { decimals: resolvedDecimals, symbol: resolvedSymbol };
}

async function loadListings(client) {
  if (!client || !MARKETPLACE_ADDRESS || !SELLER) return [];

  const seller = getAddress(SELLER);

  // 1. ListingCreated logs for this seller (indexed → efficient filter).
  const logs = await client.getContractEvents({
    address: MARKETPLACE_ADDRESS,
    abi: marketplaceAbi,
    eventName: 'ListingCreated',
    args: { seller },
    fromBlock: 0n,
    toBlock: 'latest',
  });

  // Dedupe listing ids (a seller could appear in multiple logs).
  const ids = [...new Set(logs.map((l) => l.args.id))];

  const results = await Promise.all(
    ids.map(async (id) => {
      // 2. Current on-chain state.
      let listing;
      try {
        listing = await client.readContract({
          address: MARKETPLACE_ADDRESS,
          abi: marketplaceAbi,
          functionName: 'listings',
          args: [id],
        });
      } catch (err) {
        console.warn(`[listings] failed reading listing ${id}:`, err);
        return null;
      }
      // listings() → [seller, token, price, metadata, active]
      const [, token, price, metadataRef, active] = listing;
      if (!active) return null; // skip inactive

      // 4. Swarm metadata (validated). Fetch first so we have the payment hint.
      const meta = await fetchListingMetadata(BEE_URL, metadataRef);

      // 3. Token decimals/symbol (never hardcoded).
      const { decimals, symbol } = await readToken(client, token, meta?.payment);

      const priceFormatted = formatUnits(price, decimals);

      return {
        id,
        token,
        price, // bigint, smallest unit
        decimals,
        symbol,
        priceFormatted,
        metadataRef,
        title: meta?.title || `Listing #${id}`,
        variant: meta?.variant || '',
        description: meta?.description || '',
        images: Array.isArray(meta?.images) ? meta.images : [],
        category: meta?.category || '',
        attributes: meta?.attributes || {},
        hasMetadata: Boolean(meta),
      };
    }),
  );

  return results.filter(Boolean).sort((a, b) => Number(a.id - b.id));
}

export function useListings() {
  const client = useClient({ chainId: GNOSIS_CHAIN_ID });

  const query = useQuery({
    queryKey: ['listings', MARKETPLACE_ADDRESS, SELLER, BEE_URL],
    enabled: Boolean(client && MARKETPLACE_ADDRESS && SELLER),
    queryFn: () => loadListings(client),
    staleTime: 60 * 1000,
  });

  return {
    listings: query.data || [],
    isLoading: query.isLoading,
    error: query.error || null,
    refetch: query.refetch,
  };
}
