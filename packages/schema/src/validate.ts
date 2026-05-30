/**
 * Runtime validation for the FreeMarket Swarm schema.
 *
 * Wraps ajv with a small, typed API so clients can validate untrusted objects
 * fetched from Swarm before trusting them. On success the value is narrowed to
 * the corresponding TypeScript type; on failure a `SchemaValidationError`
 * carries the underlying ajv errors.
 */
import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import type { ListingMetadata, ShopProfile } from './index.js';
import {
  listingMetadataSchema,
  shopProfileSchema,
  shopThemeSchema,
} from './schemas.js';

const ajv = new Ajv({ allErrors: true, strict: true });

// `shopThemeSchema` is referenced by `$ref` from the shop-profile schema, so it
// must be registered (not compiled into a validator) before compilation.
ajv.addSchema(shopThemeSchema);

const validateShopProfileFn: ValidateFunction<ShopProfile> =
  ajv.compile<ShopProfile>(shopProfileSchema);
const validateListingMetadataFn: ValidateFunction<ListingMetadata> =
  ajv.compile<ListingMetadata>(listingMetadataSchema);

/** Thrown by the `assert*` helpers when validation fails. */
export class SchemaValidationError extends Error {
  readonly errors: ErrorObject[];

  constructor(what: string, errors: ErrorObject[] | null | undefined) {
    const detail = (errors ?? [])
      .map((e) => `${e.instancePath || '/'} ${e.message}`)
      .join('; ');
    super(`Invalid ${what}: ${detail || 'unknown validation error'}`);
    this.name = 'SchemaValidationError';
    this.errors = errors ?? [];
  }
}

/** Type guard: returns true and narrows `value` to `ShopProfile` if valid. */
export function isShopProfile(value: unknown): value is ShopProfile {
  return validateShopProfileFn(value);
}

/** Type guard: returns true and narrows `value` to `ListingMetadata` if valid. */
export function isListingMetadata(value: unknown): value is ListingMetadata {
  return validateListingMetadataFn(value);
}

/** Validates a `ShopProfile`, throwing `SchemaValidationError` on failure. */
export function assertShopProfile(value: unknown): ShopProfile {
  if (!validateShopProfileFn(value)) {
    throw new SchemaValidationError('ShopProfile', validateShopProfileFn.errors);
  }
  return value;
}

/** Validates a `ListingMetadata`, throwing `SchemaValidationError` on failure. */
export function assertListingMetadata(value: unknown): ListingMetadata {
  if (!validateListingMetadataFn(value)) {
    throw new SchemaValidationError(
      'ListingMetadata',
      validateListingMetadataFn.errors,
    );
  }
  return value;
}
