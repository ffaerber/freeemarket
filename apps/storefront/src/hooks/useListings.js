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
import { usePublicClient } from 'wagmi';
import { formatUnits, getAddress } from 'viem';
import { shippingFromPricing } from '@freeemarket/schema';
import { marketplaceAbi } from '../abi/marketplace.js';
import { erc20Abi } from '../abi/erc20.js';
import { fetchListingMetadata } from '../lib/swarm.js';
import {
  MARKETPLACE_ADDRESS,
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

async function loadListings(client, sellerAddress) {
  if (!client || !MARKETPLACE_ADDRESS || !sellerAddress) return [];

  const seller = getAddress(sellerAddress);

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
      // listings() → [seller, token, price, stock, metadata, active]
      const [, token, price, stock, metadataRef, active] = listing;
      if (!active) return null; // skip inactive (stock 0 is kept, shown "Sold out")

      // 4. Swarm metadata (validated). Fetch first so we have the payment hint.
      const meta = await fetchListingMetadata(BEE_URL, metadataRef);

      // 3. Token decimals/symbol (never hardcoded).
      const { decimals, symbol } = await readToken(client, token, meta?.payment);

      const priceFormatted = formatUnits(price, decimals);

      // Display-only price itemization (CLAUDE.md §6/§7). The on-chain `price`
      // above is AUTHORITATIVE — it's the full escrowed total the buyer pays via
      // buy(), and it already INCLUDES shipping. `meta.pricing` is an optional,
      // FLAT-per-variant breakdown ({ item, shipping }); the shared
      // `shippingFromPricing` helper reconciles it against the authoritative
      // priceFormatted (trusting the on-chain price on any mismatch) so we never
      // show a total the buyer isn't actually paying. Shipping is flat (not
      // per-region) because the contract never sees the destination (CLAUDE.md §5).
      const normPricing = shippingFromPricing(meta?.pricing, priceFormatted);

      return {
        id,
        token,
        price, // bigint, smallest unit
        stock, // bigint, remaining units (a COUNT — never run through formatUnits)
        stockCount: Number(stock), // convenience number for display/logic
        soldOut: stock === 0n,
        decimals,
        symbol,
        priceFormatted, // authoritative on-chain total (already includes shipping)
        pricing: meta?.pricing || null, // raw breakdown from metadata (or null)
        itemFormatted: normPricing.item, // display: base item cost
        shippingFormatted: normPricing.shipping, // display: shipping included in price
        hasShipping: normPricing.hasShipping, // worth itemizing?
        metadataRef,
        title: meta?.title || `Listing #${id}`,
        variant: meta?.variant || '',
        description: meta?.description || '',
        images: Array.isArray(meta?.images) ? meta.images : [],
        category: meta?.category || '',
        attributes: meta?.attributes || {},
        // Product variant grouping (OFF-CHAIN metadata; CLAUDE.md §6). price +
        // stock above stay ON-CHAIN per variant. `variantLabel` is the selector
        // label, falling back variant → title. `productId` keys the group;
        // `variantOf` is an optional group header override.
        productId: meta?.productId || '',
        variantLabel: meta?.variantLabel || meta?.variant || meta?.title || `Listing #${id}`,
        variantOf: meta?.variantOf || '',
        hasMetadata: Boolean(meta),
      };
    }),
  );

  return results.filter(Boolean).sort((a, b) => Number(a.id - b.id));
}

/**
 * Group a flat listings array into product groups for the storefront UI.
 *
 * Pure function (no chain/IO) so it's trivially unit-testable. The on-chain /
 * off-chain split stays crisp: grouping + labels come from OFF-CHAIN metadata
 * (`productId`/`variantLabel`/`variantOf`), while each variant keeps its own
 * ON-CHAIN price + stock.
 *
 * Listings sharing a non-empty `productId` collapse into one group; a listing
 * without a `productId` is its own group (group of one), keyed by its id so the
 * non-grouped path renders exactly as before.
 *
 * @param {Array} listings normalized listings (from loadListings)
 * @returns {Array<{ productId: string, title: string, variants: Array }>}
 *   variants sorted by price ascending. Group order follows first appearance.
 */
export function groupListings(listings) {
  const groups = new Map();
  for (const l of listings || []) {
    // Standalone listings get a synthetic, collision-proof key so each is its
    // own group; real shared productIds collapse together.
    const key = l.productId ? `pid:${l.productId}` : `id:${l.id.toString()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  }
  return [...groups.entries()].map(([key, variants]) => {
    // Cheapest variant first; ties keep stable id order.
    const sorted = [...variants].sort((a, b) => {
      if (a.price === b.price) return Number(a.id - b.id);
      return a.price < b.price ? -1 : 1;
    });
    const first = sorted[0];
    // Group title: explicit variantOf wins, else the first variant's title.
    const title = sorted.find((v) => v.variantOf)?.variantOf || first.title;
    return {
      key,
      productId: first.productId || '',
      title,
      variants: sorted,
    };
  });
}

export function useListings(seller) {
  const client = usePublicClient({ chainId: GNOSIS_CHAIN_ID });

  const query = useQuery({
    queryKey: ['listings', MARKETPLACE_ADDRESS, seller, BEE_URL],
    enabled: Boolean(client && MARKETPLACE_ADDRESS && seller),
    queryFn: () => loadListings(client, seller),
    staleTime: 60 * 1000,
  });

  const listings = query.data || [];
  return {
    listings, // flat list (kept for any code that needs it)
    groups: groupListings(listings), // grouped by productId for the card UI
    isLoading: query.isLoading,
    error: query.error || null,
    refetch: query.refetch,
  };
}
