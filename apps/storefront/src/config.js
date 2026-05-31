/**
 * FreeMarket storefront configuration.
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
export const SELLER = envOr('VITE_SELLER', '');
export const RPC_URL = envOr('VITE_RPC_URL', 'https://rpc.gnosischain.com');
export const BEE_URL = envOr('VITE_BEE_URL', 'https://api.gateway.ethswarm.org');
export const SHOP_METADATA = envOr('VITE_SHOP_METADATA', '');

/** Gnosis Chain id — the escrow contract lives here regardless of ENS chain. */
export const GNOSIS_CHAIN_ID = 100;

/** Block explorer base for tx links. */
export const EXPLORER_URL = 'https://gnosisscan.io';

/**
 * The app is in DEMO MODE only when BOTH the contract address and seller are
 * unset. With either set we attempt the real path (and surface real errors).
 */
export const DEMO_MODE = !MARKETPLACE_ADDRESS || !SELLER;

/**
 * Ported sample shop — used ONLY in DEMO MODE. This is the same white-label
 * config shape the real path builds from `ShopProfile` + on-chain listings, so
 * the UI component stays identical across demo and real.
 *
 * In the real path: `theme`/`name`/`tagline`/`blurb`/`ens` come from the Swarm
 * `ShopProfile`, and `listings` come from on-chain `ListingCreated` logs +
 * Swarm `ListingMetadata`. Prices below are display-only demo numbers; the real
 * path formats from on-chain smallest-unit amounts via the token's decimals.
 */
export const DEMO_SHOP = {
  seller: '0xF00Dcafe00000000000000000000000000000a17e',
  ens: 'sunnyfield.eth',
  name: 'Sunny Field',
  tagline: 'Freeze-dried fruit, nothing else added.',
  blurb: 'Single-origin fruit, freeze-dried at harvest. Crunchy, bright, real.',
  theme: {
    bg: '#FFF7EE', surface: '#FFFFFF', text: '#2B1A12', muted: '#9A7C68',
    accent: '#FF4D6D', accent2: '#FFA51E', border: '#F1E3D3', radius: '22px',
    display: "'Fraunces', Georgia, serif", body: "'DM Sans', sans-serif",
  },
  hero: 'radial-gradient(120% 120% at 80% 0%, #FFE6CC 0%, #FFF7EE 55%)',
  listings: [
    { id: 1, title: 'Strawberries', variant: '10 g pouch', priceFormatted: '3.50', symbol: 'USDC', glyph: '🍓', description: 'One ingredient. Whole slices.', images: [] },
    { id: 2, title: 'Strawberries', variant: '100 g jar', priceFormatted: '14.00', symbol: 'USDC', glyph: '🍓', description: 'Family jar, resealable.', images: [] },
    { id: 3, title: 'Bananas', variant: '10 g pouch', priceFormatted: '3.00', symbol: 'USDC', glyph: '🍌', description: 'Coins, no sugar coating.', images: [] },
    { id: 4, title: 'Bananas', variant: '100 g jar', priceFormatted: '12.00', symbol: 'USDC', glyph: '🍌', description: 'Snack-all-week size.', images: [] },
    { id: 5, title: 'Mango', variant: '100 g jar', priceFormatted: '16.00', symbol: 'USDC', glyph: '🥭', description: 'Alphonso, intense.', images: [] },
    { id: 6, title: 'Mixed Berries', variant: '100 g jar', priceFormatted: '18.00', symbol: 'USDC', glyph: '🫐', description: 'Strawberry · blueberry · rasp.', images: [] },
  ],
};

/** A neutral fallback theme used if a real shop has no readable profile yet. */
export const FALLBACK_THEME = {
  bg: '#0D1014', surface: '#15191F', text: '#E8EEF4', muted: '#7E8893',
  accent: '#FF6A00', accent2: '#FFD400', border: '#242C36', radius: '10px',
  display: "'Bebas Neue', Impact, sans-serif", body: "'DM Sans', sans-serif",
};
