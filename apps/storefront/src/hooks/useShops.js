/**
 * useShops — list every currently-registered shop for the portal directory.
 *
 * Pipeline:
 *   1. getContractEvents `HandleClaimed(handleHash, handle, seller)` from the
 *      HandleRegistry → candidate handles (the plaintext rides in the event).
 *   2. Dedupe by handle string and VERIFY each still resolves on-chain
 *      (`resolve(handle)` != 0) — a handle can be released or re-pointed, so the
 *      event log alone is not authoritative.
 *   3. Best-effort fetch each shop's display name from its ShopProfile
 *      (`shops(seller).metadata` → Swarm), falling back to the handle.
 *
 * Returns `[{ handle, seller, name }]` sorted by handle. Empty when the registry
 * is unconfigured or no handles are live.
 */
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { getAddress, zeroAddress } from 'viem';
import { handleRegistryAbi } from '../abi/handleRegistry.js';
import { marketplaceAbi } from '../abi/marketplace.js';
import { fetchShopProfile } from '../lib/swarm.js';
import {
  HANDLE_REGISTRY,
  MARKETPLACE_ADDRESS,
  BEE_URL,
  GNOSIS_CHAIN_ID,
} from '../config.js';

async function loadShops(client) {
  if (!client || !HANDLE_REGISTRY) return [];

  // 1. All HandleClaimed events (handle plaintext is in the data).
  const logs = await client.getContractEvents({
    address: HANDLE_REGISTRY,
    abi: handleRegistryAbi,
    eventName: 'HandleClaimed',
    fromBlock: 0n,
    toBlock: 'latest',
  });

  // Dedupe by handle string (a re-claimed handle appears more than once).
  const handles = [...new Set(logs.map((l) => l.args.handle).filter(Boolean))];

  const resolved = await Promise.all(
    handles.map(async (handle) => {
      // 2. Verify the handle is still live and get its CURRENT owner.
      let seller;
      try {
        seller = await client.readContract({
          address: HANDLE_REGISTRY,
          abi: handleRegistryAbi,
          functionName: 'resolve',
          args: [handle],
        });
      } catch {
        return null;
      }
      if (!seller || seller === zeroAddress) return null;

      // 3. Best-effort display name from the ShopProfile.
      let name = handle;
      if (MARKETPLACE_ADDRESS) {
        try {
          const shop = await client.readContract({
            address: MARKETPLACE_ADDRESS,
            abi: marketplaceAbi,
            functionName: 'shops',
            args: [getAddress(seller)],
          });
          const metadataRef = shop?.[1];
          if (metadataRef) {
            const profile = await fetchShopProfile(BEE_URL, metadataRef);
            if (profile?.name) name = profile.name;
          }
        } catch {
          /* keep handle as the name */
        }
      }

      return { handle, seller: getAddress(seller), name };
    }),
  );

  return resolved.filter(Boolean).sort((a, b) => a.handle.localeCompare(b.handle));
}

export function useShops() {
  const client = usePublicClient({ chainId: GNOSIS_CHAIN_ID });

  const query = useQuery({
    queryKey: ['shops', HANDLE_REGISTRY, MARKETPLACE_ADDRESS, BEE_URL],
    enabled: Boolean(client && HANDLE_REGISTRY),
    queryFn: () => loadShops(client),
    staleTime: 60 * 1000,
  });

  return {
    shops: query.data || [],
    isLoading: query.isLoading,
    error: query.error || null,
  };
}
