/**
 * useSellerRating — read a seller's aggregate on-chain star rating.
 *
 * One `sellerRatings(seller)` view call → rounded display averages (CLAUDE.md
 * §reviews). Returns zeros (and `hasRatings: false`) until the seller has at
 * least one rated order, so callers can hide the badge for brand-new shops.
 */
import { useReadContract } from 'wagmi';
import { marketplaceAbi } from '../abi/marketplace.js';
import { summarizeSellerRating } from '../lib/rating.js';
import { MARKETPLACE_ADDRESS, GNOSIS_CHAIN_ID } from '../config.js';

export function useSellerRating(seller) {
  const read = useReadContract({
    abi: marketplaceAbi,
    address: MARKETPLACE_ADDRESS || undefined,
    functionName: 'sellerRatings',
    args: seller ? [seller] : undefined,
    chainId: GNOSIS_CHAIN_ID,
    query: { enabled: Boolean(MARKETPLACE_ADDRESS && seller) },
  });

  const summary = summarizeSellerRating(read.data);
  return {
    ...summary,
    hasRatings: summary.count > 0,
    isLoading: read.isLoading,
    refetch: read.refetch,
  };
}
