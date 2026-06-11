# FreeeMarket

A decentralized, multi-vendor marketplace (an "open eBay") where anyone can run
their own shop, sell physical goods, and get paid in stablecoins through on-chain
escrow. Built on Gnosis Chain + Ethereum Swarm.

See [`CLAUDE.md`](./CLAUDE.md) for the full project spec, architecture, and build order.

**Forking to add VAT / fees / business compliance?** The mainline is deliberately
fee-free and VAT-free (a small peer-to-peer market for fruit, potatoes & the
like). See [`docs/FORKING.md`](./docs/FORKING.md) for the simplest way to add
those in your own fork.

## Repo structure

```
freeemarket/
├── contracts/              # Foundry — Marketplace.sol, tests, deploy script
├── packages/
│   ├── schema/             # Shared TS types + JSON Schema (CLAUDE.md §6)
│   └── messaging/          # SwarmChat lib reuse (envelope, transport, feeds)
├── apps/
│   ├── storefront/         # White-label Vite template (clone per shop)
│   └── cms/                # Merchant admin app
├── CLAUDE.md               # full project spec
└── Makefile                # build / test / deploy
```

## Status

| Layer | Status |
|---|---|
| `Marketplace` contract | Pure escrow + listings. Foundry suite green (39 tests). **Unaudited.** |
| Storefront | Demo template (`apps/storefront/src/Storefront.jsx`). |
| Shared schema | TS types + JSON Schema validation (`packages/schema`). |
| CMS / admin | Not built. |

> **Identity model (§9.3) decided:** seller keys + encrypted shipping addresses
> are handled off-chain via SwarmChat (`ContactRegistry` + PSS), so the contract
> carries no `encryptionPubKey` / `shippingRef`. See `contracts/README.md`.

## Getting started

```sh
make help
```
