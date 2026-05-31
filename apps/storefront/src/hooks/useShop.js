/**
 * useShop — read the shop's white-label profile.
 *
 * Real path: read `shops(seller).metadata` on-chain (a bytes32 Swarm ref),
 * then fetch + validate the `ShopProfile` JSON from Swarm. An optional
 * VITE_SHOP_METADATA override short-circuits the on-chain read (useful before
 * the shop is registered, or for previewing a profile).
 *
 * Returns a normalized shop object the ported white-label UI consumes:
 *   { name, ens, tagline, blurb, theme, logo, banner }
 * Falls back to FALLBACK_THEME / minimal copy when no profile is readable yet.
 */
import { useQuery } from '@tanstack/react-query';
import { useReadContract } from 'wagmi';
import { marketplaceAbi } from '../abi/marketplace.js';
import { fetchShopProfile } from '../lib/swarm.js';
import {
  MARKETPLACE_ADDRESS,
  SELLER,
  SHOP_METADATA,
  BEE_URL,
  GNOSIS_CHAIN_ID,
  FALLBACK_THEME,
} from '../config.js';

export function useShop() {
  // 1. On-chain: shops(seller) -> (registered, metadata). Skipped if we have a
  //    metadata override or are missing config.
  const enabledOnChain =
    !SHOP_METADATA && Boolean(MARKETPLACE_ADDRESS) && Boolean(SELLER);

  const shopRead = useReadContract({
    abi: marketplaceAbi,
    address: MARKETPLACE_ADDRESS || undefined,
    functionName: 'shops',
    args: SELLER ? [SELLER] : undefined,
    chainId: GNOSIS_CHAIN_ID,
    query: { enabled: enabledOnChain },
  });

  // shops() returns [registered, metadata]
  const onChainMetadata = shopRead.data ? shopRead.data[1] : undefined;
  const metadataRef = SHOP_METADATA || onChainMetadata || '';

  // 2. Swarm: fetch + validate the ShopProfile JSON.
  const profileQuery = useQuery({
    queryKey: ['shopProfile', BEE_URL, metadataRef],
    enabled: Boolean(metadataRef),
    queryFn: () => fetchShopProfile(BEE_URL, metadataRef),
    staleTime: 5 * 60 * 1000,
  });

  const profile = profileQuery.data || null;

  const shop = {
    seller: SELLER,
    ens: profile?.ens || (SELLER ? `${SELLER.slice(0, 6)}…${SELLER.slice(-4)}` : ''),
    name: profile?.name || 'Untitled Shop',
    tagline: profile?.tagline || 'Pays in stablecoins · escrow on Gnosis',
    blurb: profile?.blurb || '',
    theme: profile?.theme || FALLBACK_THEME,
    logo: profile?.logo || '',
    banner: profile?.banner || '',
  };

  return {
    shop,
    profile,
    isLoading: shopRead.isLoading || profileQuery.isLoading,
    error: shopRead.error || profileQuery.error || null,
    hasProfile: Boolean(profile),
  };
}
