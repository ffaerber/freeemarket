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
  // price is ON-CHAIN (USDC 6-dp), not here
}

export const SCHEMA_VERSION = 1 as const;
