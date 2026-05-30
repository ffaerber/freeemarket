# FreeMarket CMS / Admin

Shared merchant back-office (one app for all shops; ideally run locally for
address privacy). Talks only to the Marketplace contract + Swarm + PSS.

See [CLAUDE.md §2 and §9](../../CLAUDE.md).

## TODO

- [ ] Shop registration (`registerShop`).
- [ ] Listing CRUD + Swarm image upload (writes `ListingMetadata`).
- [ ] Order dashboard: watch `OrderFunded`, pull + decrypt PSS shipping address.
- [ ] Mark shipped / handle disputes.
