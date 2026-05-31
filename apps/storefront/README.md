# FreeMarket Storefront

Config-driven, white-label storefront engine: one component renders radically
different shops from a shop profile + listings. Clone + configure env + deploy
per shop to its own ENS + Swarm.

This is the **real** app (CLAUDE.md build step #5): Vite + React + wagmi v2 +
viem + `@tanstack/react-query` + `@ethersphere/bee-js`. It reads listings
on-chain (filtered by the shop's seller address), fetches each listing's
metadata from Swarm, and runs a real escrow checkout
(`approve` → `market.buy`). The encrypted-shipping-address-over-PSS step is
wired to a clean boundary that is currently **stubbed** (see below).

## Run

```bash
npm install
cp .env.example .env   # then fill in for a real shop (see table)
npm run dev            # dev server
npm run build          # production build → dist/
npm run preview        # serve the built app
```

`npm install` + `npm run build` succeed out of the box. With no env set, the app
runs in **DEMO MODE** (see below) so the build/preview render a sample shop.

## Environment

Only `VITE_`-prefixed vars are exposed to the client. Never commit secrets
(private keys, postage-batch IDs) — this is a public static app.

| Var | Required | Default | Purpose |
|---|---|---|---|
| `VITE_MARKETPLACE_ADDRESS` | for real path | — | Shared `Marketplace` escrow contract on Gnosis (id 100). |
| `VITE_SELLER` | for real path | — | This shop's seller address. Listings are filtered to those created by it. |
| `VITE_RPC_URL` | no | `https://rpc.gnosischain.com` | Gnosis Chain JSON-RPC endpoint. |
| `VITE_BEE_URL` | no | `https://api.gateway.ethswarm.org` | Swarm Bee/gateway base for metadata + images. **PSS requires a full Bee node** (e.g. `http://localhost:1633`), not a gateway. |
| `VITE_SHOP_METADATA` | no | — | Optional `bytes32`/ref override for the shop profile; short-circuits the on-chain `shops(seller)` read. |

### DEMO MODE

When **both** `VITE_MARKETPLACE_ADDRESS` and `VITE_SELLER` are unset, the app
renders a clearly-labeled ported sample shop (no chain or Bee node needed), so
`build`/`preview` always show something. The moment those two vars are set, the
**real on-chain path is the default** — demo data is never mixed into a
configured shop, and checkout is disabled in demo mode.

## Architecture

- `src/wagmi.js` — wagmi v2 config: Gnosis chain, injected connector, HTTP transport.
- `src/config.js` — env-driven config + DEMO_MODE + ported demo shop / fallback theme.
- `src/abi/` — minimal viem ABIs for `Marketplace` and ERC-20.
- `src/lib/swarm.js` — `fetchSwarmJson` / `fetchShopProfile` / `fetchListingMetadata` (bee-js `downloadData`, validated with `@freemarket/schema`), `swarmImageUrl`.
- `src/hooks/useShop.js` — `shops(seller).metadata` → Swarm `ShopProfile`.
- `src/hooks/useListings.js` — `ListingCreated` logs → `listings(id)` → ERC-20 `decimals()`/`symbol()` → Swarm `ListingMetadata`. Prices format via `formatUnits` (decimals read per-token; never hardcoded — falls back to the metadata `payment` hint, then 18).
- `src/checkout/Checkout.jsx` — real `approve` (if needed) → `buy(listingId)` → parse `OrderFunded` for `orderId` → encrypted-address boundary.
- `src/messaging/index.js` — `sendEncryptedAddress(...)`: the single PSS integration point. **Stubbed** (returns `{ delivered: false, stub: true }`) pending `@freemarket/messaging`; see the file's JSDoc + CLAUDE.md §5 for the real ECIES → signed-envelope → Swarm PSS + recipient-feed flow.
- `src/Storefront.jsx` / `src/ui.jsx` — the ported white-label engine (theme tokens, hero, grid, product modal), now data-driven.

### `@freemarket/schema` resolution

Imported via `"@freemarket/schema": "file:../../packages/schema"`. That package
exposes a built `dist/index.js` through its `exports` field, so Vite resolves
the JS runtime validators (`isShopProfile`, `isListingMetadata`) directly — no
TS source import needed. (If you edit the schema, run its `npm run build`.)

### bee-js under Vite

`@ethersphere/bee-js` imports Node builtins (`stream`, `fs`, `path`) and expects
a `Buffer`/`global` runtime. `vite.config.js` uses `vite-plugin-node-polyfills`
to provide these so the browser build bundles cleanly. We only call bee-js's
`downloadData` path, but Rollup resolves all of its static imports at build time.

## TODO

- [x] Port to the Vite + wagmi v2 + viem + bee-js stack.
- [x] Replace mock `listings` with on-chain reads + Swarm metadata fetch.
- [x] Wire checkout: `usdc.approve` → `market.buy`. Encrypt address + PSS send is **stubbed** at `src/messaging/index.js` pending `@freemarket/messaging` (CLAUDE.md §5).
- [x] Replace glyph placeholders with Swarm-hosted images (with emoji fallback).
