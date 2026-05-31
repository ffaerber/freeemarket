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
