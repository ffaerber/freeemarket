/**
 * useAcceptedToken — verify a token is on the marketplace allowlist and read
 * its decimals/symbol so the listing form can convert human price → smallest
 * unit (via viem parseUnits) without ever hardcoding decimals.
 *
 * Returns a manual-trigger `check(address)` plus reactive state. We use a
 * react-query lookup keyed by the (trimmed, lowercased) token address so the
 * form can validate on demand as the merchant types/selects a token.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { isAddress, getAddress } from 'viem';
import { marketplaceAbi } from '../abi/marketplace.js';
import { erc20Abi } from '../abi/erc20.js';
import { MARKETPLACE_ADDRESS, GNOSIS_CHAIN_ID } from '../config.js';

async function inspectToken(client, token) {
  const addr = getAddress(token);

  const accepted = await client.readContract({
    address: MARKETPLACE_ADDRESS,
    abi: marketplaceAbi,
    functionName: 'acceptedTokens',
    args: [addr],
  });

  let decimals;
  let symbol;
  try {
    decimals = await client.readContract({ address: addr, abi: erc20Abi, functionName: 'decimals' });
  } catch {
    decimals = undefined;
  }
  try {
    symbol = await client.readContract({ address: addr, abi: erc20Abi, functionName: 'symbol' });
  } catch {
    symbol = undefined;
  }

  return {
    address: addr,
    accepted: Boolean(accepted),
    decimals: decimals != null ? Number(decimals) : undefined,
    symbol: symbol || undefined,
  };
}

export function useAcceptedToken() {
  const client = usePublicClient({ chainId: GNOSIS_CHAIN_ID });
  const [token, setToken] = useState('');

  const valid = Boolean(token && isAddress(token));

  const query = useQuery({
    queryKey: ['cms', 'acceptedToken', MARKETPLACE_ADDRESS, token.toLowerCase()],
    enabled: Boolean(client && MARKETPLACE_ADDRESS && valid),
    queryFn: () => inspectToken(client, token),
    staleTime: 5 * 60 * 1000,
  });

  return {
    token,
    setToken,
    valid,
    info: query.data || null, // { address, accepted, decimals, symbol }
    isLoading: query.isLoading && valid,
    error: query.error || null,
  };
}
