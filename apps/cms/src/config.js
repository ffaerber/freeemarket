/**
 * FreeMarket CMS / admin configuration.
 *
 * Everything here is driven by Vite env vars (`import.meta.env.VITE_*`), with
 * sensible fallbacks. See `.env.example` for the documented var set.
 *
 * UNCONFIGURED MODE: when VITE_MARKETPLACE_ADDRESS is unset, the app still
 * renders the admin shell (so `npm run build` + `npm run preview` show
 * something without a chain or Bee node), but on-chain reads/writes are
 * disabled and the UI surfaces a banner. The moment the contract address is
 * set, the REAL on-chain path is active. There is no demo/sample data here —
 * the CMS is a tool, not a showcase.
 *
 * Unlike the storefront, the CMS is NOT per-shop: the merchant's connected
 * wallet address is the seller address, so there is no VITE_SELLER.
 */

const env = import.meta.env;

/** Trimmed env getter that treats empty strings as unset. */
function envOr(key, fallback) {
  const v = env[key];
  return v != null && String(v).trim() !== '' ? String(v).trim() : fallback;
}

export const MARKETPLACE_ADDRESS = envOr('VITE_MARKETPLACE_ADDRESS', '');
export const RPC_URL = envOr('VITE_RPC_URL', 'https://rpc.gnosischain.com');
/** Bee node base URL — used for reads AND writes (writes need a real node). */
export const BEE_URL = envOr('VITE_BEE_URL', 'http://localhost:1633');
/** Postage batch ("stamp") — required for any Swarm upload. */
export const POSTAGE_BATCH_ID = envOr('VITE_POSTAGE_BATCH_ID', '');

/**
 * SwarmChat ContactRegistry address — resolves a party's published ECIES public
 * key on-chain (CLAUDE.md §5). The CMS uses it to resolve the BUYER's key when
 * sending a shipment-update / tracking code. When unset, that reply flow is
 * UNCONFIGURED and the messaging boundary gracefully returns its stub result.
 * (Reading the buyer's address does NOT need the registry — only the seller's
 * unlocked PRIVATE key.)
 */
export const CONTACT_REGISTRY = envOr('VITE_CONTACT_REGISTRY', '');

/** Optional known accepted-token addresses to seed the listing token picker. */
export const KNOWN_TOKENS = envOr('VITE_KNOWN_TOKENS', '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);

/** Gnosis Chain id — the escrow contract lives here regardless of ENS chain. */
export const GNOSIS_CHAIN_ID = 100;

/** Block explorer base for tx links. */
export const EXPLORER_URL = 'https://gnosisscan.io';

/** True when the contract address is missing — on-chain features disabled. */
export const UNCONFIGURED = !MARKETPLACE_ADDRESS;

/** True when uploads can't run because no postage batch is configured. */
export const UPLOADS_DISABLED = !POSTAGE_BATCH_ID;

/**
 * Neutral dark admin theme. The CMS is intentionally NOT white-label themeable
 * per shop (it's the merchant's back-office, one app for all shops); it just
 * needs to be clean and consistent. These map to the same CSS-variable token
 * names the shared <Styles>/UI primitives consume, so the storefront's visual
 * language carries over.
 */
export const ADMIN_THEME = {
  bg: '#0B0E13',
  surface: '#141921',
  text: '#E8EEF4',
  muted: '#7E8893',
  accent: '#5B9DFF',
  accent2: '#7CE3C4',
  border: '#222B36',
  radius: '12px',
  display: "'DM Sans', system-ui, sans-serif",
  body: "'DM Sans', system-ui, sans-serif",
};
