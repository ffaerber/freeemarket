/**
 * useMyHandle — read the connected merchant's current storefront handle.
 *
 * Reads `sellerHandle(me)` on the ownerless HandleRegistry. Empty string = no
 * handle claimed yet. The connected wallet IS the seller (the CMS is shared).
 */
import { useAccount, useReadContract } from 'wagmi';
import { handleRegistryAbi } from '../abi/handleRegistry.js';
import { HANDLE_REGISTRY_ADDRESS, GNOSIS_CHAIN_ID } from '../config.js';

export function useMyHandle() {
  const { address } = useAccount();
  const enabled = Boolean(HANDLE_REGISTRY_ADDRESS && address);

  const read = useReadContract({
    abi: handleRegistryAbi,
    address: HANDLE_REGISTRY_ADDRESS || undefined,
    functionName: 'sellerHandle',
    args: address ? [address] : undefined,
    chainId: GNOSIS_CHAIN_ID,
    query: { enabled },
  });

  return {
    handle: read.data || '',
    isLoading: read.isLoading,
    error: read.error || null,
    refetch: read.refetch,
  };
}
