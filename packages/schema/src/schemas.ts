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
  },
};

/** All schemas, keyed by their `$id`. Useful for bulk registration. */
export const allSchemas: SchemaObject[] = [
  shopThemeSchema,
  shopProfileSchema,
  listingMetadataSchema,
];
