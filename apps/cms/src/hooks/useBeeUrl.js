/**
 * useBeeUrl — the CMS's Bee node URL, persisted in ONE place.
 *
 * Canonical store = swarm-connect's own localStorage key, so the package's modal
 * AND the CMS sidebar field write the SAME value and neither clobbers the other.
 * We deliberately do NOT pass a `beeApiUrl` prop to <SwarmConnectButton> — the
 * package resolves `prop ?? localStorage ?? default`, so a prop would override
 * (and overwrite) the persisted URL. usePostageBatch + the node-health check
 * read this same key via readBeeUrl().
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BEE_URL } from '../config.js';

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
  const [url, setUrlState] = useState(readBeeUrl);

  const setUrl = useCallback(
    (next) => {
      const trimmed = (next || '').trim() || BEE_URL;
      setUrlState(trimmed);
      try {
        window.localStorage.setItem(BEE_KEY, trimmed);
      } catch {
        /* ignore */
      }
      // Re-run node + stamp detection immediately against the new URL.
      qc.invalidateQueries({ queryKey: ['cms', 'postageBatch'] });
    },
    [qc],
  );

  return [url, setUrl];
}
