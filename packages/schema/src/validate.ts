/**
 * Runtime validators for the FreeMarket schema. Thin wrappers over Ajv with
 * ergonomic type guards and asserts that the CMS and storefront can share.
 */
import { Ajv, type ValidateFunction } from 'ajv';
import {
  shopProfileSchema,
  listingMetadataSchema,
  shopThemeSchema,
  shippingPolicySchema,
  paymentHintSchema,
} from './schemas.js';
import type { ShopProfile, ListingMetadata } from './index.js';

const ajv = new Ajv({ allErrors: true });

// Register the shared $ref'd schemas once so resolution works.
ajv.addSchema(shopThemeSchema);
ajv.addSchema(shippingPolicySchema);
ajv.addSchema(paymentHintSchema);

const _validateShop: ValidateFunction = ajv.compile(shopProfileSchema);
const _validateListing: ValidateFunction = ajv.compile(listingMetadataSchema);

export function isShopProfile(value: unknown): value is ShopProfile {
  return _validateShop(value) as boolean;
}

export function isListingMetadata(value: unknown): value is ListingMetadata {
  return _validateListing(value) as boolean;
}

export class SchemaValidationError extends Error {
  readonly errors: object[];
  constructor(message: string, errors: object[]) {
    super(message);
    this.name = 'SchemaValidationError';
    this.errors = errors;
  }
}

function format(errors: unknown): object[] {
  return (errors as object[]) ?? [];
}

export function assertShopProfile(value: unknown): ShopProfile {
  if (!_validateShop(value)) {
    throw new SchemaValidationError(
      'Invalid ShopProfile',
      format(_validateShop.errors),
    );
  }
  return value as ShopProfile;
}

export function assertListingMetadata(value: unknown): ListingMetadata {
  if (!_validateListing(value)) {
    throw new SchemaValidationError(
      'Invalid ListingMetadata',
      format(_validateListing.errors),
    );
  }
  return value as ListingMetadata;
}
