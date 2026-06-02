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
 *
 * The buyer only ever needs the EPHEMERAL messaging batch (sending the address;
 * reading the seller's tracking reply needs no batch). `MESSAGING_BATCH_ID`
 * prefers the dedicated `VITE_MESSAGING_BATCH_ID` and falls back to the legacy
 * single `VITE_POSTAGE_BATCH_ID` (see docs/POSTAGE.md). Use a SHORT-LIVED batch
 * so the ciphertext self-expires after fulfillment.
 */
export const POSTAGE_BATCH_ID = envOr('VITE_POSTAGE_BATCH_ID', '');
export const MESSAGING_BATCH_ID = envOr('VITE_MESSAGING_BATCH_ID', POSTAGE_BATCH_ID);

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
  // Sample ADVISORY shipping-region policy (off-chain; CLAUDE.md §5): ships to
  // the EU + the US only. The storefront renders a "Ships to: EU & US" badge and
  // gates checkout by the buyer's selected country. NOT on-chain-enforced.
  shipping: { mode: 'allowlist', regions: ['EU'], countries: ['US'], note: 'Ships within 3 days' },
  // `stock` mirrors the on-chain unit count (a COUNT, never a token amount).
  // `productId` + `variantLabel` are OFF-CHAIN grouping metadata: listings that
  // share a productId render as ONE product card with a variant selector. Here
  // the two Strawberries (one sold out) and the two Bananas each collapse into a
  // single card; Mango / Mixed Berries have no productId ⇒ standalone cards.
  // `price` (bigint smallest-unit) mirrors the real normalized shape so
  // groupListings can sort variants by price; demo decimals are 6 (USDC-like).
  listings: [
    { id: 1, productId: 'strawberries', variantLabel: '10 g pouch', title: 'Strawberries', variant: '10 g pouch', price: 3500000n, priceFormatted: '3.50', symbol: 'USDC', glyph: '🍓', description: 'One ingredient. Whole slices.', images: [], stock: 0 },
    // `pricing` is a DISPLAY-ONLY split of the on-chain price (which already
    // includes shipping); item + shipping reconcile to priceFormatted. FLAT per
    // variant — not per-region (the contract can't see the destination, §5).
    { id: 2, productId: 'strawberries', variantLabel: '100 g jar', title: 'Strawberries', variant: '100 g jar', price: 14000000n, priceFormatted: '14.00', pricing: { item: '12.00', shipping: '2.00' }, symbol: 'USDC', glyph: '🍓', description: 'Family jar, resealable.', images: [], stock: 8 },
    { id: 3, productId: 'bananas', variantLabel: '10 g pouch', title: 'Bananas', variant: '10 g pouch', price: 3000000n, priceFormatted: '3.00', symbol: 'USDC', glyph: '🍌', description: 'Coins, no sugar coating.', images: [], stock: 120 },
    { id: 4, productId: 'bananas', variantLabel: '100 g jar', title: 'Bananas', variant: '100 g jar', price: 12000000n, priceFormatted: '12.00', pricing: { item: '10.00', shipping: '2.00' }, symbol: 'USDC', glyph: '🍌', description: 'Snack-all-week size.', images: [], stock: 3 },
    { id: 5, title: 'Mango', variant: '100 g jar', variantLabel: '100 g jar', price: 16000000n, priceFormatted: '16.00', symbol: 'USDC', glyph: '🥭', description: 'Alphonso, intense.', images: [], stock: 0 },
    { id: 6, title: 'Mixed Berries', variant: '100 g jar', variantLabel: '100 g jar', price: 18000000n, priceFormatted: '18.00', symbol: 'USDC', glyph: '🫐', description: 'Strawberry · blueberry · rasp.', images: [], stock: 25 },
  ],
};

/** A neutral fallback theme used if a real shop has no readable profile yet. */
export const FALLBACK_THEME = {
  bg: '#0D1014', surface: '#15191F', text: '#E8EEF4', muted: '#7E8893',
  accent: '#FF6A00', accent2: '#FFD400', border: '#242C36', radius: '10px',
  display: "'Bebas Neue', Impact, sans-serif", body: "'DM Sans', sans-serif",
};
