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

/**
 * Hardcoded RECOMMENDED settlement tokens for the listing form's dropdown.
 *
 * These are only SUGGESTIONS — the canonical accepted-token allowlist lives
 * ON-CHAIN (the contract's owner-curated `acceptedTokens`, CLAUDE.md §4), and
 * every pick (recommended OR custom) is still verified against it via
 * useAcceptedToken before a listing can be created. The seller can always pick
 * "Custom address…" to settle in any other token the platform owner has
 * accepted. These canonical Gnosis Chain (id 100) addresses mirror the deploy
 * script's defaults (contracts/script/Deploy.s.sol).
 */
export const RECOMMENDED_TOKENS = [
  {
    address: '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d',
    symbol: 'WXDAI',
    name: 'Wrapped xDAI — native stable, 18 dp',
  },
  {
    address: '0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83',
    symbol: 'USDC',
    name: 'USDC — bridged via Omnibridge, 6 dp',
  },
  {
    address: '0x2a22f9c3b484c3629090FeED35F17Ff8F88f76F0',
    symbol: 'USDC.e',
    name: 'USDC.e — Circle via Stargate, 6 dp',
  },
];

/**
 * Full dropdown option set: the hardcoded recommendations PLUS any extra
 * addresses supplied via VITE_KNOWN_TOKENS (deduped, case-insensitive). The
 * env extras carry no label since we only know their address up front; their
 * symbol/decimals are still resolved on-chain when selected.
 */
export const TOKEN_OPTIONS = (() => {
  const seen = new Set(RECOMMENDED_TOKENS.map((t) => t.address.toLowerCase()));
  const extras = KNOWN_TOKENS.filter((a) => !seen.has(a.toLowerCase())).map((address) => ({
    address,
    symbol: undefined,
    name: 'From VITE_KNOWN_TOKENS',
  }));
  return [...RECOMMENDED_TOKENS, ...extras];
})();

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
