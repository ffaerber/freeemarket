/**
 * useBeeUrl — the CMS's single source of truth for the Bee node URL.
 *
 * Persisted in our own localStorage key (default VITE_BEE_URL). We also mirror it
 * into swarm-connect's key so the connect button agrees, and we pass it as the
 * `beeApiUrl` prop (which the package prioritises over its own localStorage).
 * Changing it invalidates the postage-batch query so detection re-runs at once.
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BEE_URL } from '../config.js';

export const APP_BEE_KEY = 'fmkt.beeUrl';
export const SWARM_CONNECT_BEE_KEY = 'swarm-connect:bee-api-url';

/** Current Bee URL: our key → swarm-connect's key → VITE_BEE_URL. */
export function readBeeUrl() {
  if (typeof window !== 'undefined') {
    try {
      const a = window.localStorage.getItem(APP_BEE_KEY);
      if (a && a.trim()) return a.trim();
      const b = window.localStorage.getItem(SWARM_CONNECT_BEE_KEY);
      if (b && b.trim()) return b.trim();
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
        window.localStorage.setItem(APP_BEE_KEY, trimmed);
        window.localStorage.setItem(SWARM_CONNECT_BEE_KEY, trimmed);
      } catch {
        /* ignore */
      }
      qc.invalidateQueries({ queryKey: ['cms', 'postageBatch'] });
    },
    [qc],
  );

  return [url, setUrl];
}
