/**
 * FreeMarket shared Swarm schema.
 *
 * This is the real platform contract (see CLAUDE.md §6): the CMS writes these
 * objects to Swarm, and any storefront reads them. Pin this before building
 * more clients.
 *
 * Note: prices are NOT stored here — they live on-chain in the Marketplace
 * contract as USDC 6-decimal integers.
 */

/** White-label theme tokens consumed by the storefront engine. */
export interface ShopTheme {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  border: string;
  radius: string;
  display: string;
  body: string;
}

/**
 * Shop-level shipping-region policy (OPTIONAL, additive in v1).
 *
 * Mode semantics:
 *   - `worldwide` — ships everywhere; `countries`/`regions` are IGNORED.
 *   - `allowlist` — ships ONLY to the listed countries/regions.
 *   - `blocklist` — ships everywhere EXCEPT the listed countries/regions.
 *
 * IMPORTANT — this is an ADVISORY STOREFRONT policy, NOT on-chain-enforced. The
 * buyer's address (and country) is ECIES-encrypted and travels OFF-CHAIN over
 * Swarm PSS (CLAUDE.md §5), so the Marketplace contract never sees a country
 * and a buyer could lie. The storefront uses this to show the policy and DISABLE
 * checkout for excluded countries; the dispute/refund path is the backstop if
 * someone funds escrow anyway. Resolve it with `canShipTo` / `describeShipping-
 * Policy` from `./regions.ts` (shared by the CMS and storefront).
 *
 * Backward compatible: a shop with no `shipping` policy is treated as worldwide.
 */
export interface ShippingPolicy {
  /** How `countries`/`regions` are interpreted (see interface JSDoc). */
  mode: 'worldwide' | 'allowlist' | 'blocklist';
  /**
   * Individual ISO 3166-1 alpha-2 country codes (UPPERCASE, e.g. "DE", "US").
   * Used by `allowlist`/`blocklist`; ignored for `worldwide`.
   */
  countries?: string[];
  /**
   * Named region presets (e.g. "EU", "EEA", "US", "NA") that EXPAND into country
   * codes via `REGION_PRESETS` in `./regions.ts`. Combined (unioned) with
   * `countries`. Ignored for `worldwide`.
   */
  regions?: string[];
  /** Optional free-text shown to buyers, e.g. "Ships within 3 days". */
  note?: string;
}

/** Pointed to by `Shop.metadata` (bytes32 Swarm ref). */
export interface ShopProfile {
  version: 1;
  name: string;
  ens?: string;
  tagline?: string;
  blurb?: string;
  logo?: string; // Swarm ref
  banner?: string; // Swarm ref
  theme: ShopTheme;
  /**
   * Optional ADVISORY shipping-region policy (see `ShippingPolicy`). Absent ⇒
   * the shop ships worldwide. NOT on-chain-enforced (CLAUDE.md §5).
   */
  shipping?: ShippingPolicy;
}

/**
 * DISPLAY-ONLY breakdown of a listing's ON-CHAIN price (OPTIONAL, additive in
 * v1, backward compatible).
 *
 * Why this is display-only:
 *   (a) The listing's ON-CHAIN `price` (a smallest-unit integer in the Marketplace
 *       contract) is AUTHORITATIVE — it's the single amount actually escrowed and
 *       paid by the buyer via `buy()`. That price ALREADY INCLUDES shipping.
 *   (b) `item` + `shipping` here are a human-readable split of that total so the
 *       storefront can itemize it ("item €10.00 + shipping €3.00 = €13.00"). They
 *       SHOULD sum to the on-chain price; if they don't, the storefront trusts the
 *       on-chain price and derives the difference (see `shippingFromPricing`).
 *   (c) Shipping is FLAT — one figure per listing/variant, NOT per-region. The
 *       contract never sees the destination country (it travels off-chain inside
 *       the encrypted address; CLAUDE.md §5), so a per-region shipping fee cannot
 *       be charged on-chain.
 *   (d) Amounts are DECIMAL STRINGS in the listing token's units (e.g. "10.00"),
 *       NOT smallest-unit integers (mirroring how `price` itself is on-chain, not
 *       duplicated here as a number).
 */
export interface PricingBreakdown {
  /** Base item cost as a decimal string in the listing token's units (e.g. "10.00"). */
  item?: string;
  /**
   * Shipping cost INCLUDED in the on-chain price, as a decimal string in the
   * listing token's units (e.g. "3.00"). FLAT per variant (not per-region).
   */
  shipping?: string;
}

/** Pointed to by `Listing.metadata` (bytes32 Swarm ref). */
export interface ListingMetadata {
  version: 1;
  title: string;
  variant?: string; // e.g. "100 g jar", "Front · ceramic"
  description?: string;
  images: string[]; // Swarm refs
  category?: string;
  attributes?: Record<string, string>;
  // price is ON-CHAIN (in the listing token's smallest unit), not here.
  // stock/quantity is likewise ON-CHAIN (listings(id).stock — a unit COUNT,
  // decremented by buy()), deliberately NOT duplicated here to avoid drift.

  /**
   * OPTIONAL display-only breakdown of the ON-CHAIN price into item + shipping
   * (see `PricingBreakdown`). The on-chain `price` stays authoritative and is
   * what the buyer actually pays via escrow — this only records how it splits so
   * the storefront can itemize it. FLAT per variant (not per-region; CLAUDE.md
   * §5). Absent ⇒ the listing renders with just its single on-chain price.
   */
  pricing?: PricingBreakdown;

  // --- Product variant grouping (OFF-CHAIN, optional, additive in v1) ---
  // Each variant remains its own on-chain Listing (own price + own on-chain
  // stock); grouping is expressed purely here so the storefront/CMS can render
  // multiple pack sizes / variants of one product under a single product card
  // with a variant selector. None of these affect escrow or settlement.

  /**
   * Stable key shared by all variants of the SAME product within one shop/seller
   * (e.g. a slug "sunny-strawberries" or a uuid). Listings sharing a `productId`
   * are grouped as variants of one product. Absent ⇒ the listing is its own
   * standalone product (a group of one).
   */
  productId?: string;
  /**
   * Short label for THIS variant shown in the selector (e.g. "Single roll",
   * "6-pack", "100 g jar"). This is the selector-specific label and is PREFERRED
   * over `variant` for the selector; the two can coexist (`variant` may carry a
   * longer descriptive phrase). Fallback order for the selector label is
   * `variantLabel` → `variant` → `title`.
   */
  variantLabel?: string;
  /**
   * Optional human product name for the group header (e.g. "Strawberries") when
   * the card title should differ from the per-variant `title`. If absent, the
   * group title is derived from the first variant's `title`.
   */
  variantOf?: string;
}

export const SCHEMA_VERSION = 1 as const;

// JSON Schema (draft-07) definitions and runtime validators.
export {
  shopThemeSchema,
  shippingPolicySchema,
  paymentHintSchema,
  pricingBreakdownSchema,
  shopProfileSchema,
  listingMetadataSchema,
  allSchemas,
} from './schemas.js';
export {
  SchemaValidationError,
  isShopProfile,
  isListingMetadata,
  assertShopProfile,
  assertListingMetadata,
} from './validate.js';

// Shipping-region policy logic (shared by CMS + storefront).
export {
  REGION_PRESETS,
  REGION_LABELS,
  resolveShippingCountries,
  canShipTo,
  describeShippingPolicy,
} from './regions.js';

// Pricing-breakdown reconciliation (shared by CMS + storefront). DISPLAY ONLY —
// the on-chain price is always authoritative. See ./pricing.ts.
export { shippingFromPricing, type NormalizedPricing } from './pricing.js';
