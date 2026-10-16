/**
 * useBeeUrl — the CMS's Bee node URL, persisted in ONE place.
 *
 * The URL lives in the app's shared swarm-connect state (SwarmProvider), which
 * persists it under swarm-connect's own localStorage key — so the modal AND
 * the CMS sidebar field change the SAME value, and reads follow it.
 * usePostageBatch + the node-health check read the stored key via readBeeUrl().
 */
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BEE_URL } from '../config.js';
import { useSwarm } from '../swarm/SwarmContext.jsx';

/** The key the swarm-connect package persists its Bee API URL under. */
export const BEE_KEY = 'swarm-connect:bee-api-url';

/** Current Bee URL: the persisted swarm-connect value, else VITE_BEE_URL. */
export function readBeeUrl() {
  if (typeof window !== 'undefined') {
    try {
      const v = window.localStorage.getItem(BEE_KEY);
      if (v && v.trim()) return v.trim();
    } catch {
      /* ignore */
    }
  }
  return BEE_URL;
}

export function useBeeUrl() {
  const qc = useQueryClient();
  const swarm = useSwarm();

  const setUrl = useCallback(
    (next) => {
      const trimmed = (next || '').trim() || BEE_URL;
      // The shared swarm-connect state (modal, node checks, reads) …
      swarm.setBeeApiUrl(trimmed);
      // … and the stored key right away: swarm-connect persists it in an
      // effect, but readBeeUrl() below is read synchronously by the refetch.
      try {
        window.localStorage.setItem(BEE_KEY, trimmed);
      } catch {
        /* ignore */
      }
      // Re-run node + stamp detection immediately against the new URL.
      qc.invalidateQueries({ queryKey: ['cms', 'postageBatch'] });
    },
    [qc, swarm.setBeeApiUrl],
  );

  return [swarm.beeApiUrl, setUrl];
}
