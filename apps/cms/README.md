# FreeMarket CMS / Admin

Shared merchant back-office — **one app for all shops**. The merchant connects
their own wallet and that address *is* their seller address (no per-shop build,
unlike the storefront). It talks only to the Marketplace contract on Gnosis +
Swarm + (stubbed) PSS. Same stack as the storefront: Vite + React + wagmi v2 +
viem + @tanstack/react-query + @ethersphere/bee-js + lucide-react +
@freemarket/schema.

See [CLAUDE.md §2 and §9](../../CLAUDE.md).

> **Run this LOCALLY.** The shipping-address decryption flow (CLAUDE.md §5) uses
> the merchant's ECIES private key. Running the CMS on your own machine keeps
> that key — and the decrypted plaintext addresses — off any server.

## Run

```bash
# From the repo root, the shared schema ships a prebuilt dist; if it's missing:
#   (cd packages/schema && npm install && npm run build)

cd apps/cms
npm install
cp .env.example .env   # then edit (see vars below)
npm run dev            # local dev server
npm run build          # production build → dist/
npm run preview        # serve the production build
```

`npm run build` succeeds with **no contract or Bee node** — when unconfigured it
renders the admin shell with a banner explaining what to set.

## Environment variables

Only `VITE_`-prefixed vars are exposed to the client. **Never** put secrets here
— and the merchant's ECIES decryption private key must **never** be committed or
placed in env (it lives only in a local keystore; see §5).

| Var | Required | Default | Notes |
|---|---|---|---|
| `VITE_MARKETPLACE_ADDRESS` | for any on-chain use | — | Shared Marketplace escrow contract on Gnosis (id 100). Unset ⇒ **Unconfigured mode** (shell renders, reads/writes disabled). |
| `VITE_RPC_URL` | no | `https://rpc.gnosischain.com` | Gnosis JSON-RPC endpoint. |
| `VITE_BEE_URL` | for uploads | `http://localhost:1633` | Bee node base URL. Used for reads **and writes**. **Writes need a real, writeable Bee node — NOT a public gateway** (gateways reject uploads). Get one via Bee or the Freedom Browser bundle. |
| `VITE_POSTAGE_BATCH_ID` | for uploads | — | Swarm postage batch ("stamp") that pays for storage (CLAUDE.md §5). Unset ⇒ uploads disabled + an in-UI warning. Create one with `bee.createPostageBatch(amount, depth)` (helper in `src/lib/swarmWrite.js`) or the Bee API / Swarm dashboard, then paste the batch id. Not a secret, but per-node. |
| `VITE_KNOWN_TOKENS` | no | — | Optional comma-separated accepted-token addresses to seed the listing token picker. Each is still verified against the on-chain `acceptedTokens` allowlist before use. |

## Features (tabs)

- **Shop** — register/update your `ShopProfile` (name, ens, tagline, blurb,
  logo/banner, the 10 white-label theme tokens). Validated with
  `assertShopProfile`, uploaded to Swarm, then `registerShop(bytes32)`.
- **Listings** — create + edit listings. Pick an accepted token (verified +
  decimals read on-chain, never hardcoded; price entered in human units →
  `parseUnits`), upload images to Swarm, assemble + validate `ListingMetadata`
  (with the `payment` hint), upload it, then `createListing` /
  `updateListing` (incl. active toggle).
- **Orders** — escrow dashboard from `OrderFunded` logs (seller == you) + live
  `orders(orderId)` state, token-formatted amounts. Per order:
  - **Decrypt shipping address** — calls the PSS receive/decrypt boundary
    (**stubbed**; see below).
  - **claimAfterTimeout** (when the auto-release window has elapsed),
    **openDispute**, and arbiter-only **resolveDispute** (shown only when your
    wallet == contract `owner()`).
  - **Mark shipped** — **off-chain, localStorage-only** memo. There is **no
    on-chain shipped state**; the real release signal is the buyer's
    `confirmReceipt` or the timeout.

## Status (CLAUDE.md build step #6)

- [x] Shop registration (`registerShop`).
- [x] Listing CRUD + Swarm image upload (writes `ListingMetadata`).
- [x] Order dashboard: watch `OrderFunded`, surface state, decrypt action.
- [x] Handle disputes (open / arbiter-resolve) + `claimAfterTimeout`.
- [x] Mark shipped (off-chain local memo — no on-chain shipped state).
- [ ] **PSS decrypt is STUBBED** at a clean boundary (`src/messaging/index.js`,
      `receiveDecryptedAddress`). Swapping in `@freemarket/messaging` (ported
      SwarmChat `lib/`) is a one-file change. Until then it returns
      `{ decrypted: false, stub: true }`.
