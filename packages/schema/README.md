# @freemarket/schema

Shared Swarm JSON schema for all FreeMarket clients (CMS + storefronts).

This package is the platform contract described in [CLAUDE.md §6](../../CLAUDE.md).
The CMS writes `ShopProfile` and `ListingMetadata` objects to Swarm; storefronts
read them. Prices are **not** here — they live on-chain in `Marketplace` as USDC
6-decimal integers.

## TODO

- [ ] Add JSON Schema validation alongside the TS types.
- [ ] Publish as a versioned package consumed by `apps/storefront` and `apps/cms`.
