/**
 * FreeeMarket storefront configuration.
 *
 * Everything here is driven by Vite env vars (`import.meta.env.VITE_*`), with
 * sensible fallbacks. See `.env.example` for the documented var set.
 *
 * DEMO MODE: when neither VITE_MARKETPLACE_ADDRESS nor VITE_SELLER is set, the
 * app falls back to a clearly-labeled demo that renders the ported sample shop
 * config (so `npm run build` + `npm run preview` show something without a chain
 * or Bee node). The moment those two env vars are set, the REAL on-chain path
 * is the default — demo data is never mixed into a configured shop.
 */

const env = import.meta.env;

/** Trimmed env getter that treats empty strings as unset. */
function envOr(key, fallback) {
  const v = env[key];
  return v != null && String(v).trim() !== '' ? String(v).trim() : fallback;
}

export const MARKETPLACE_ADDRESS = envOr('VITE_MARKETPLACE_ADDRESS', '');

/**
 * Optional single-shop seller. In MULTI-TENANT mode (the default for the shared
 * freeemarket.eth deploy) the active shop is resolved from the URL path via the
 * on-chain HandleRegistry (see useActiveSeller), and this is left unset. Setting
 * it pins the deploy to ONE shop (a per-shop ENS deploy) regardless of path.
 */
export const SELLER = envOr('VITE_SELLER', '');

/**
 * Ownerless on-chain HandleRegistry (handle → seller) on Gnosis. Enables the
 * multi-tenant path resolution `freeemarket.eth.limo/<handle>`. When unset, only
 * the VITE_SELLER fallback / raw-address path works.
 */
export const HANDLE_REGISTRY = envOr('VITE_HANDLE_REGISTRY', '');
export const RPC_URL = envOr('VITE_RPC_URL', 'https://rpc.gnosischain.com');
export const BEE_URL = envOr('VITE_BEE_URL', 'https://api.gateway.ethswarm.org');
export const SHOP_METADATA = envOr('VITE_SHOP_METADATA', '');

/**
 * SwarmChat ContactRegistry address — resolves a party's published ECIES public
 * key on-chain (CLAUDE.md §5). When unset, the encrypted-shipping/tracking flow
 * is UNCONFIGURED and the messaging boundary gracefully returns its stub result.
 */
export const CONTACT_REGISTRY = envOr('VITE_CONTACT_REGISTRY', '');

/**
 * Postage batch ("stamp") for the buyer's own Bee node — REQUIRED to send the
 * encrypted address over PSS via `BeeTransport`. The buyer needs a writeable
 * full Bee node + batch (same caveat as the CMS, CLAUDE.md §5). NOT a secret,
 * but per-node; when unset the messaging boundary falls back to its stub.
 */
export const POSTAGE_BATCH_ID = envOr('VITE_POSTAGE_BATCH_ID', '');

/** Gnosis Chain id — the escrow contract lives here regardless of ENS chain. */
export const GNOSIS_CHAIN_ID = 100;

/** Block explorer base for tx links. */
export const EXPLORER_URL = 'https://gnosisscan.io';

/** CMS / admin URL — the portal's "Create your shop" CTA points here. */
export const ADMIN_URL = envOr('VITE_ADMIN_URL', 'https://admin.freeemarket.eth.limo');

/** Public host this storefront is served at — used to show shop URLs in the portal. */
export const STOREFRONT_HOST = envOr('VITE_STOREFRONT_HOST', 'freeemarket.eth.limo');

/** True when no Marketplace is configured at build time (chain reads disabled). */
export const NO_CHAIN_CONFIGURED = !MARKETPLACE_ADDRESS;

/**
 * The single STATIC storefront theme. Custom per-shop theming is dropped for now
 * (the storefront is a fixed default UI); every shop renders with this theme. A
 * `ShopProfile.theme`, if present, is intentionally ignored. A future custom
 * storefront could re-introduce per-shop theming. Tokens map 1:1 to the CSS vars
 * the UI consumes (see <Styles> + StorefrontView).
 */
export const STOREFRONT_THEME = {
  bg: '#F7F8FA', surface: '#FFFFFF', text: '#16181D', muted: '#6B7280',
  accent: '#4F46E5', accent2: '#10B981', border: '#E6E8EC', radius: '14px',
  display: "'DM Sans', system-ui, sans-serif", body: "'DM Sans', system-ui, sans-serif",
};
