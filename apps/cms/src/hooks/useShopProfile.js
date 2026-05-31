/**
 * useShopProfile — read the connected merchant's registered shop.
 *
 * Reads `shops(me)` on-chain → (registered, metadata bytes32 Swarm ref), then
 * fetches + validates the ShopProfile JSON from Swarm. Mirrors the storefront's
 * useShop, except the "seller" is the CONNECTED wallet (the CMS is shared across
 * shops; the wallet selects the shop).
 */
import { useQuery } from '@tanstack/react-query';
import { useAccount, useReadContract } from 'wagmi';
import { marketplaceAbi } from '../abi/marketplace.js';
import { fetchShopProfile } from '../lib/swarm.js';
import { MARKETPLACE_ADDRESS, BEE_URL, GNOSIS_CHAIN_ID } from '../config.js';

export function useShopProfile() {
  const { address } = useAccount();

  const enabled = Boolean(MARKETPLACE_ADDRESS && address);

  const shopRead = useReadContract({
    abi: marketplaceAbi,
    address: MARKETPLACE_ADDRESS || undefined,
    functionName: 'shops',
    args: address ? [address] : undefined,
    chainId: GNOSIS_CHAIN_ID,
    query: { enabled },
  });

  // shops() returns [registered, metadata]
  const registered = shopRead.data ? shopRead.data[0] : false;
  const metadataRef = shopRead.data ? shopRead.data[1] : '';

  const profileQuery = useQuery({
    queryKey: ['cms', 'shopProfile', BEE_URL, metadataRef],
    enabled: Boolean(metadataRef),
    queryFn: () => fetchShopProfile(BEE_URL, metadataRef),
    staleTime: 60 * 1000,
  });

  return {
    registered,
    metadataRef,
    profile: profileQuery.data || null,
    isLoading: shopRead.isLoading || profileQuery.isLoading,
    error: shopRead.error || profileQuery.error || null,
    refetch: async () => {
      await shopRead.refetch?.();
      await profileQuery.refetch?.();
    },
  };
}
