# FreeMarket Storefront

Config-driven, white-label storefront engine: one component renders radically
different shops purely from a config object. Clone + customize + deploy per shop
to its own ENS + Swarm.

`src/Storefront.jsx` is the demo template. See [CLAUDE.md §7](../../CLAUDE.md) for
the productionization plan (port to Vite + wagmi v2 + viem + bee-js, wire
on-chain reads and PSS checkout).

## TODO

- [ ] Port to the Vite + wagmi v2 + viem + bee-js stack.
- [ ] Replace mock `listings` with on-chain reads + Swarm metadata fetch.
- [ ] Wire checkout: `usdc.approve` → `market.buy` → encrypt address + PSS send.
- [ ] Replace glyph placeholders with Swarm-hosted images.
