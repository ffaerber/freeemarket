/**
 * The app's single @ffaerber/swarm-connect instance.
 *
 * One instance, shared by the connect button and every Swarm read, so that
 * connecting a node in the modal switches reads to it at once. `swarm.read`
 * is where downloads go: the user's own node (with a bee-manager's API key)
 * once it is running, the public gateway (VITE_GATEWAY_URL) otherwise — so a
 * visitor with no node still sees every shop, listing and image.
 *
 * Writes and PSS messaging are NOT routed through `read`: they need a full,
 * writeable node and keep using it directly.
 *
 * Kept in sync between apps/storefront and apps/cms (we can't import across apps).
 */
import React, { createContext, useContext } from 'react';
import { useSwarmConnect } from '@ffaerber/swarm-connect';
import { BEE_URL, GATEWAY_URL } from '../config.js';

/** The key swarm-connect persists its Bee API URL under. */
const BEE_KEY = 'swarm-connect:bee-api-url';

/** The node URL the user last saved in the modal, else VITE_BEE_URL. */
function initialBeeUrl() {
  try {
    const v = window.localStorage.getItem(BEE_KEY);
    if (v && v.trim()) return v.trim();
  } catch {
    /* ignore */
  }
  return BEE_URL;
}

const SwarmContext = createContext(null);

export function SwarmProvider({ children }) {
  // beeApiUrl is passed (rather than left to swarm-connect's own restore) so a
  // build-time VITE_BEE_URL is the default instead of localhost:1633; the
  // user's saved choice still wins, see initialBeeUrl.
  const swarm = useSwarmConnect({ beeApiUrl: initialBeeUrl(), gatewayUrl: GATEWAY_URL });
  return <SwarmContext.Provider value={swarm}>{children}</SwarmContext.Provider>;
}

/** The shared swarm-connect state (wallet, node, stamps, read). */
export function useSwarm() {
  const swarm = useContext(SwarmContext);
  if (!swarm) throw new Error('useSwarm must be used within <SwarmProvider>');
  return swarm;
}
