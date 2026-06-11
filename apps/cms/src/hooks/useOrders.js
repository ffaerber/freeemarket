/**
 * useOrders — load orders escrowed against the connected merchant.
 *
 * Pipeline:
 *   1. getContractEvents `OrderFunded(orderId, listingId, buyer, seller, …)`
 *      filtered by `seller == connected address`. (`seller` is NOT indexed in
 *      the event, so we filter client-side after fetching all OrderFunded logs;
 *      buyer/orderId/listingId are indexed.)
 *   2. For each orderId, read CURRENT `orders(orderId)` state (the event only
 *      captures the funded snapshot; state changes as the order progresses).
 *   3. Read token decimals/symbol (NEVER hardcoded) to format the amount.
 *   4. Read `autoReleasePeriod()` once to compute timeout eligibility.
 *
 * Also surfaces the block timestamp of the funding tx where available so the
 * dashboard can show when the order was funded.
 */
import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { formatUnits, getAddress } from 'viem';
import { marketplaceAbi } from '../abi/marketplace.js';
import { erc20Abi } from '../abi/erc20.js';
import { MARKETPLACE_ADDRESS, GNOSIS_CHAIN_ID } from '../config.js';

const tokenMetaCache = new Map();

async function readTokenMeta(client, token) {
  const key = token.toLowerCase();
  if (tokenMetaCache.has(key)) return tokenMetaCache.get(key);
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
  const meta = {
    decimals: decimals != null ? Number(decimals) : 18,
    symbol: symbol || 'TOKEN',
  };
  tokenMetaCache.set(key, meta);
  return meta;
}

async function loadOrders(client, seller) {
  if (!client || !MARKETPLACE_ADDRESS || !seller) {
    return { orders: [], autoReleasePeriod: 0n };
  }

  const me = getAddress(seller);

  // autoReleasePeriod (seconds) — used for timeout eligibility.
  let autoReleasePeriod = 0n;
  try {
    autoReleasePeriod = await client.readContract({
      address: MARKETPLACE_ADDRESS,
      abi: marketplaceAbi,
      functionName: 'autoReleasePeriod',
    });
  } catch (err) {
    console.warn('[cms:orders] failed reading autoReleasePeriod:', err);
  }

  // OrderFunded logs. `seller` isn't indexed → fetch all, filter client-side.
  const logs = await client.getContractEvents({
    address: MARKETPLACE_ADDRESS,
    abi: marketplaceAbi,
    eventName: 'OrderFunded',
    fromBlock: 0n,
    toBlock: 'latest',
  });

  const mine = logs.filter(
    (l) => l.args?.seller && getAddress(l.args.seller) === me,
  );

  const orders = await Promise.all(
    mine.map(async (log) => {
      const orderId = log.args.orderId;
      let order;
      try {
        order = await client.readContract({
          address: MARKETPLACE_ADDRESS,
          abi: marketplaceAbi,
          functionName: 'orders',
          args: [orderId],
        });
      } catch (err) {
        console.warn(`[cms:orders] failed reading order ${orderId}:`, err);
        return null;
      }
      // orders() → [listingId, buyer, seller, token, amount, fundedAt, state]
      const [listingId, buyer, orderSeller, token, amount, fundedAt, state] = order;

      const { decimals, symbol } = await readTokenMeta(client, token);

      return {
        orderId,
        listingId,
        buyer,
        seller: orderSeller,
        token,
        amount, // bigint, smallest unit
        decimals,
        symbol,
        amountFormatted: formatUnits(amount, decimals),
        fundedAt, // uint64 unix seconds (bigint)
        state: Number(state),
        txHash: log.transactionHash,
      };
    }),
  );

  return {
    orders: orders.filter(Boolean).sort((a, b) => Number(b.orderId - a.orderId)),
    autoReleasePeriod,
  };
}

export function useOrders() {
  const client = usePublicClient({ chainId: GNOSIS_CHAIN_ID });
  const { address } = useAccount();

  const query = useQuery({
    queryKey: ['cms', 'orders', MARKETPLACE_ADDRESS, address],
    enabled: Boolean(client && MARKETPLACE_ADDRESS && address),
    queryFn: () => loadOrders(client, address),
    staleTime: 15 * 1000,
  });

  return {
    orders: query.data?.orders || [],
    autoReleasePeriod: query.data?.autoReleasePeriod || 0n,
    isLoading: query.isLoading,
    error: query.error || null,
    refetch: query.refetch,
  };
}
