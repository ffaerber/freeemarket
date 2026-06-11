/**
 * useMyListings — load the connected merchant's listings from chain + Swarm.
 *
 * Same read pipeline as the storefront's useListings, with two differences:
 *   - filtered by the CONNECTED wallet (the seller), not a build-time VITE_SELLER;
 *   - INCLUDES inactive listings (the merchant needs to see + re-activate them),
 *     whereas the storefront hides them from buyers.
 *
 * Pipeline:
 *   1. getContractEvents `ListingCreated(id, seller, …)` filtered by seller.
 *   2. Read current `listings(id)` state for each id.
 *   3. Read token decimals/symbol (NEVER hardcoded) for price formatting.
 *   4. Fetch + validate ListingMetadata JSON from Swarm.
 */
import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { formatUnits } from 'viem';
import { marketplaceAbi } from '../abi/marketplace.js';
import { erc20Abi } from '../abi/erc20.js';
import { fetchListingMetadata } from '../lib/swarm.js';
import { MARKETPLACE_ADDRESS, BEE_URL, GNOSIS_CHAIN_ID } from '../config.js';

async function readToken(client, token, hint) {
  let decimals;
  let symbol;
  try {
    decimals = await client.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' });
  } catch {
    decimals = undefined;
  }
  try {
    symbol = await client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' });
  } catch {
    symbol = undefined;
  }
  const resolvedDecimals =
    decimals != null ? Number(decimals) : hint?.decimals != null ? hint.decimals : 18;
  const resolvedSymbol = symbol || hint?.symbol || 'TOKEN';
  return { decimals: resolvedDecimals, symbol: resolvedSymbol };
}

async function loadMyListings(client, seller) {
  if (!client || !MARKETPLACE_ADDRESS || !seller) return [];

  const logs = await client.getContractEvents({
    address: MARKETPLACE_ADDRESS,
    abi: marketplaceAbi,
    eventName: 'ListingCreated',
    args: { seller },
    fromBlock: 0n,
    toBlock: 'latest',
  });

  const ids = [...new Set(logs.map((l) => l.args.id))];

  const results = await Promise.all(
    ids.map(async (id) => {
      let listing;
      try {
        listing = await client.readContract({
          address: MARKETPLACE_ADDRESS,
          abi: marketplaceAbi,
          functionName: 'listings',
          args: [id],
        });
      } catch (err) {
        console.warn(`[cms:listings] failed reading listing ${id}:`, err);
        return null;
      }
      // listings() → [seller, token, price, stock, metadata, active]
      const [, token, price, stock, metadataRef, active] = listing;

      const meta = await fetchListingMetadata(BEE_URL, metadataRef);
      const { decimals, symbol } = await readToken(client, token, meta?.payment);

      return {
        id,
        token,
        price, // bigint, smallest unit
        stock, // bigint, remaining units (a COUNT — never formatUnits)
        stockCount: Number(stock),
        decimals,
        symbol,
        priceFormatted: formatUnits(price, decimals),
        active,
        // DISPLAY-ONLY price breakdown ({ item, shipping }) from metadata
        // (CLAUDE.md §6). The on-chain `price` above stays authoritative and
        // already INCLUDES shipping; this is surfaced so the rows/edit form can
        // show + prefill the split. Absent on legacy listings ⇒ null.
        pricing: meta?.pricing || null,
        metadataRef,
        title: meta?.title || `Listing #${id}`,
        variant: meta?.variant || '',
        description: meta?.description || '',
        images: Array.isArray(meta?.images) ? meta.images : [],
        category: meta?.category || '',
        attributes: meta?.attributes || {},
        // Product variant grouping (OFF-CHAIN metadata; CLAUDE.md §6). price +
        // stock above stay ON-CHAIN per variant. Surfaced so listing rows can
        // show which product group a listing belongs to + prefill the edit form.
        productId: meta?.productId || '',
        variantLabel: meta?.variantLabel || '',
        variantOf: meta?.variantOf || '',
        hasMetadata: Boolean(meta),
      };
    }),
  );

  return results.filter(Boolean).sort((a, b) => Number(a.id - b.id));
}

export function useMyListings() {
  const client = usePublicClient({ chainId: GNOSIS_CHAIN_ID });
  const { address } = useAccount();

  const query = useQuery({
    queryKey: ['cms', 'myListings', MARKETPLACE_ADDRESS, address, BEE_URL],
    enabled: Boolean(client && MARKETPLACE_ADDRESS && address),
    queryFn: () => loadMyListings(client, address),
    staleTime: 30 * 1000,
  });

  return {
    listings: query.data || [],
    isLoading: query.isLoading,
    error: query.error || null,
    refetch: query.refetch,
  };
}
