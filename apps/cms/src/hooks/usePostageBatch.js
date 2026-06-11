/**
 * usePostageBatch — resolve a Swarm postage batch for uploads.
 *
 * Prefers an explicit VITE_POSTAGE_BATCH_ID override; otherwise AUTO-DETECTS the
 * first usable stamp on the connected Bee node (GET /stamps). So a merchant
 * running a local Bee node with a funded stamp can upload with no env config —
 * matching the swarm-connect wizard's node/stamp model. Shared via react-query,
 * so every section sees the same resolved batch from one fetch.
 */
import { useQuery } from '@tanstack/react-query';
import { BEE_URL, POSTAGE_BATCH_ID } from '../config.js';

async function fetchUsableBatch(beeUrl) {
  const base = beeUrl.replace(/\/+$/, '');
  const res = await fetch(`${base}/stamps`);
  if (!res.ok) throw new Error(`Bee /stamps responded ${res.status}`);
  const data = await res.json();
  const usable = (data.stamps || []).filter((s) => s.usable);
  // Prefer the longest-lived stamp so uploads don't land on one about to expire.
  usable.sort((a, b) => (b.batchTTL || 0) - (a.batchTTL || 0));
  return usable[0]?.batchID || '';
}

export function usePostageBatch() {
  const override = POSTAGE_BATCH_ID;
  const q = useQuery({
    queryKey: ['cms', 'postageBatch', BEE_URL],
    enabled: !override,
    queryFn: () => fetchUsableBatch(BEE_URL),
    staleTime: 60 * 1000,
    retry: 1,
  });
  const batchId = override || q.data || '';
  return {
    batchId,
    ready: Boolean(batchId),
    isChecking: !override && q.isLoading,
    source: override ? 'env' : batchId ? 'node' : 'none',
    error: q.error || null,
  };
}
