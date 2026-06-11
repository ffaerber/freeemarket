/**
 * usePostageBatch — resolve a Swarm postage batch + the Bee node URL to upload to.
 *
 * Resolution:
 *   1. Bee URL = the node the user configured in the swarm-connect modal
 *      (persisted to localStorage by the package), else VITE_BEE_URL. This keeps
 *      detection on the SAME node the Swarm connect button uses — they were
 *      previously decoupled (button on the user's node, this on a static URL).
 *   2. Batch = VITE_POSTAGE_BATCH_ID override, else AUTO-DETECT the first usable
 *      stamp on that node (GET /stamps, longest TTL first).
 *
 * Polls so a newly-bought stamp (or a node-URL change in the modal) is picked up
 * within ~20s, and surfaces the real fetch error (CORS / offline) for diagnostics.
 * Consumers should upload to the returned `beeUrl` (the node that holds the stamp).
 */
import { useQuery } from '@tanstack/react-query';
import { POSTAGE_BATCH_ID } from '../config.js';
import { readBeeUrl } from './useBeeUrl.js';

async function detect(override) {
  const beeUrl = readBeeUrl();
  if (override) return { beeUrl, batchId: override, error: null };
  const base = beeUrl.replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/stamps`);
    if (!res.ok) return { beeUrl, batchId: '', error: `Bee /stamps responded ${res.status}` };
    const data = await res.json();
    const usable = (data.stamps || []).filter((s) => s.usable).sort((a, b) => (b.batchTTL || 0) - (a.batchTTL || 0));
    return { beeUrl, batchId: usable[0]?.batchID || '', error: null };
  } catch (e) {
    // Network/CORS error — the node is unreachable from the browser.
    return { beeUrl, batchId: '', error: e?.message || 'cannot reach Bee node' };
  }
}

export function usePostageBatch() {
  const override = POSTAGE_BATCH_ID;
  const q = useQuery({
    queryKey: ['cms', 'postageBatch'],
    queryFn: () => detect(override),
    refetchInterval: 20 * 1000, // pick up a newly-bought stamp / node-URL change
    refetchOnWindowFocus: true,
    staleTime: 10 * 1000,
  });
  const d = q.data || {};
  const beeUrl = d.beeUrl || readBeeUrl();
  return {
    batchId: d.batchId || '',
    beeUrl,
    ready: Boolean(d.batchId),
    isChecking: q.isLoading,
    error: d.error || (q.error ? q.error.message : null),
  };
}
