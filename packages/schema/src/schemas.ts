/**
 * JSON Schema (draft-07) definitions for the FreeMarket Swarm schema.
 *
 * These mirror the TypeScript interfaces in `./index.ts` and are the runtime
 * source of truth used by `./validate.ts`. Any client (CMS, storefront) can
 * also consume these raw schemas to validate objects in non-TS environments.
 */
import type { SchemaObject } from 'ajv';

/** White-label theme tokens — every field is a required string. */
export const shopThemeSchema: SchemaObject = {
  $id: 'https://freemarket.eth/schema/shop-theme.json',
  type: 'object',
  additionalProperties: false,
  required: [
    'bg',
    'surface',
    'text',
    'muted',
    'accent',
    'accent2',
    'border',
    'radius',
    'display',
    'body',
  ],
  properties: {
    bg: { type: 'string' },
    surface: { type: 'string' },
    text: { type: 'string' },
    muted: { type: 'string' },
    accent: { type: 'string' },
    accent2: { type: 'string' },
    border: { type: 'string' },
    radius: { type: 'string' },
    display: { type: 'string' },
    body: { type: 'string' },
  },
};

/**
 * Shop-level ADVISORY shipping-region policy (see `ShippingPolicy` in
 * ./index.ts). NOT on-chain-enforced — the country travels off-chain inside the
 * encrypted address (CLAUDE.md §5). `mode` is required; `countries` are ISO
 * 3166-1 alpha-2 (2 uppercase letters), `regions` are named presets (EU/EEA/…).
 */
export const shippingPolicySchema: SchemaObject = {
  $id: 'https://freemarket.eth/schema/shipping-policy.json',
  type: 'object',
  additionalProperties: false,
  required: ['mode'],
  properties: {
    mode: { type: 'string', enum: ['worldwide', 'allowlist', 'blocklist'] },
    countries: {
      type: 'array',
      items: { type: 'string', pattern: '^[A-Z]{2}$' },
    },
    regions: {
      type: 'array',
      items: { type: 'string' },
    },
    note: { type: 'string' },
  },
};

/** Pointed to by `Shop.metadata` (bytes32 Swarm ref). */
export const shopProfileSchema: SchemaObject = {
  $id: 'https://freemarket.eth/schema/shop-profile.json',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'name', 'theme'],
  properties: {
    version: { const: 1 },
    name: { type: 'string', minLength: 1 },
    ens: { type: 'string' },
    tagline: { type: 'string' },
    blurb: { type: 'string' },
    logo: { type: 'string' },
    banner: { type: 'string' },
    theme: { $ref: 'https://freemarket.eth/schema/shop-theme.json' },
    // Optional advisory shipping-region policy (off-chain; CLAUDE.md §5).
    shipping: { $ref: 'https://freemarket.eth/schema/shipping-policy.json' },
  },
};

/**
 * Display hint for the listing's on-chain payment token. The canonical token +
 * price are on-chain; this only carries symbol/decimals for rendering.
 */
export const paymentHintSchema: SchemaObject = {
  $id: 'https://freemarket.eth/schema/payment-hint.json',
  type: 'object',
  additionalProperties: false,
  required: ['token'],
  properties: {
    token: { type: 'string', minLength: 1 },
    symbol: { type: 'string' },
    decimals: { type: 'integer', minimum: 0, maximum: 36 },
  },
};

/**
 * Human-readable breakdown of the listing's ON-CHAIN price (which already
 * INCLUDES shipping). DISPLAY ONLY — the on-chain `price` is the single amount
 * actually escrowed/paid via `buy()`; this just records how that total splits
 * into item + shipping so the storefront can itemize it. FLAT (one shipping
 * figure per listing/variant), NOT per-region: the contract never sees the
 * destination country (it's inside the off-chain encrypted address, CLAUDE.md
 * §5), so a per-region shipping fee can't be charged on-chain. Amounts are
 * DECIMAL STRINGS in the listing token's units (e.g. "10.00"), NOT smallest-unit
 * integers. `item` + `shipping` SHOULD sum to the on-chain price; storefronts
 * treat the on-chain price as authoritative (see `shippingFromPricing`).
 */
export const pricingBreakdownSchema: SchemaObject = {
  $id: 'https://freemarket.eth/schema/pricing-breakdown.json',
  type: 'object',
  additionalProperties: false,
  properties: {
    // Decimal strings in token units (e.g. "10.00"), NOT smallest-unit ints.
    item: { type: 'string', pattern: '^[0-9]+(\\.[0-9]+)?$' },
    shipping: { type: 'string', pattern: '^[0-9]+(\\.[0-9]+)?$' },
  },
};

/** Pointed to by `Listing.metadata` (bytes32 Swarm ref). Price is on-chain. */
export const listingMetadataSchema: SchemaObject = {
  $id: 'https://freemarket.eth/schema/listing-metadata.json',
  type: 'object',
  additionalProperties: false,
  required: ['version', 'title', 'images'],
  properties: {
    version: { const: 1 },
    title: { type: 'string', minLength: 1 },
    variant: { type: 'string' },
    description: { type: 'string' },
    images: { type: 'array', items: { type: 'string' } },
    category: { type: 'string' },
    attributes: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    // Display hint only; on-chain token/price remain authoritative.
    payment: { $ref: 'https://freemarket.eth/schema/payment-hint.json' },
    // DISPLAY-ONLY breakdown of the ON-CHAIN price into item + shipping. The
    // on-chain price already INCLUDES shipping and stays authoritative; this
    // only itemizes it. FLAT per variant (not per-region — the contract can't
    // see the destination country, CLAUDE.md §5). See `pricingBreakdownSchema`.
    pricing: { $ref: 'https://freemarket.eth/schema/pricing-breakdown.json' },
    // Product variant grouping (OFF-CHAIN, optional, additive in v1). Each
    // variant stays its own on-chain Listing; these only drive how the
    // storefront/CMS group + label variants under one card. See ./index.ts.
    productId: { type: 'string' },
    variantLabel: { type: 'string' },
    variantOf: { type: 'string' },
  },
};

/** All schemas, keyed by their `$id`. Useful for bulk registration. */
export const allSchemas: SchemaObject[] = [
  shopThemeSchema,
  shippingPolicySchema,
  paymentHintSchema,
  pricingBreakdownSchema,
  shopProfileSchema,
  listingMetadataSchema,
];
