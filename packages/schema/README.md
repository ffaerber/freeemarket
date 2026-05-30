# @freemarket/schema

Shared Swarm JSON schema for all FreeMarket clients (CMS + storefronts).

This package is the platform contract described in [CLAUDE.md §6](../../CLAUDE.md).
The CMS writes `ShopProfile` and `ListingMetadata` objects to Swarm; storefronts
read them. Prices are **not** here — they live on-chain in `Marketplace` as USDC
6-decimal integers.

## What's in here

- **TypeScript types** (`src/index.ts`) — `ShopProfile`, `ListingMetadata`,
  `ShopTheme`, `SCHEMA_VERSION`.
- **JSON Schema** (`src/schemas.ts`) — draft-07 definitions mirroring the types,
  for validation in any environment (`shopProfileSchema`, `listingMetadataSchema`,
  `shopThemeSchema`, `allSchemas`).
- **Runtime validators** (`src/validate.ts`) — ajv-backed helpers for validating
  untrusted objects fetched from Swarm.

## Usage

```ts
import {
  assertListingMetadata,
  isShopProfile,
  type ShopProfile,
} from '@freemarket/schema';

// Type guard — narrows on success, returns false on failure.
if (isShopProfile(json)) {
  // json is ShopProfile here
}

// Assertion — returns the typed value or throws SchemaValidationError.
const listing = assertListingMetadata(await fetchFromSwarm(ref));
```

## Scripts

```bash
npm run typecheck   # tsc --noEmit
npm run build       # emit dist/ (JS + .d.ts)
npm test            # node:test via tsx
```

## TODO

- [ ] Publish as a versioned package consumed by `apps/storefront` and `apps/cms`.
