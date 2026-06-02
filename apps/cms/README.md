# FreeMarket CMS / Admin

Shared merchant back-office — **one app for all shops**. The merchant connects
their own wallet and that address *is* their seller address (no per-shop build,
unlike the storefront). It talks only to the Marketplace contract on Gnosis +
Swarm + live PSS (via `@freemarket/messaging`). Same stack as the storefront: Vite + React + wagmi v2 +
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
| `VITE_STORAGE_BATCH_ID` | for uploads | falls back to `VITE_POSTAGE_BATCH_ID` | **Durable** Swarm postage batch ("stamp") stamping product image + metadata uploads, kept alive as long as the shop is live. Unset (and no fallback) ⇒ uploads disabled + an in-UI warning. Create/manage it in the **Storage** tab. Not a secret, but per-node. |
| `VITE_MESSAGING_BATCH_ID` | for tracking send | falls back to `VITE_POSTAGE_BATCH_ID` | **Short-lived** batch stamping PSS shipment-update sends, so the ciphertext self-expires after fulfillment (CLAUDE.md §5). |
| `VITE_POSTAGE_BATCH_ID` | legacy | — | Single-batch fallback for both of the above (back-compat). See [docs/POSTAGE.md](../../docs/POSTAGE.md). |
| `VITE_KNOWN_TOKENS` | no | — | Optional comma-separated accepted-token addresses to seed the listing token picker. Each is still verified against the on-chain `acceptedTokens` allowlist before use. |
| `VITE_CONTACT_REGISTRY` | for tracking send | — | SwarmChat `ContactRegistry` address — resolves the **buyer's** ECIES public key when sending a shipment-update / tracking code (seller→buyer, CLAUDE.md §5). Unset / no entry ⇒ tracking-send falls back to a stub. Reading the buyer's **address** does NOT need this — only your unlocked private key. Confirm the registry ABI/selector in `src/lib/contactRegistry.js`. |

> **The merchant's ECIES decryption PRIVATE KEY is intentionally NOT an env var.**
> Putting it in `VITE_*` would bake it into the client bundle. Instead, unlock it
> at runtime via the **"Unlock decryption key"** field in the Orders tab — it is
> held only in React state (optionally this tab's `sessionStorage`, never
> `localStorage` by default), never logged, never sent anywhere. Run the CMS
> locally so the key + decrypted plaintext addresses never leave your machine.

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
  - **Unlock decryption key** — paste your ECIES private key (runtime-only,
    local; see the note above) to enable address decryption.
  - **Decrypt shipping address** — **live** PSS receive + ECIES decrypt via
    `@freemarket/messaging`: reads the buyer→seller topic, verifies the signed
    envelope's signer == this order's buyer, decrypts with your unlocked key.
    Graceful stub when the key / a full Bee node is missing.
  - **Send tracking code** — **live** seller→buyer shipment update: resolve the
    buyer's key via ContactRegistry, encrypt the `{ carrier?, trackingCode?,
    note? }`, sign with your wallet, deliver over PSS. Stub when unconfigured.
  - **claimAfterTimeout** (when the auto-release window has elapsed),
    **openDispute**, and arbiter-only **resolveDispute** (shown only when your
    wallet == contract `owner()`).
  - **Mark shipped** — **off-chain, localStorage-only** memo. There is **no
    on-chain shipped state**; the real release signal is the buyer's
    `confirmReceipt` or the timeout.
- **Storage** — Swarm postage-batch manager (`src/lib/postage.js`). Shows the
  **durable storage** batch and the **ephemeral messaging** batch — each with
  depth, usage, remaining duration + a health badge — and offers **Create**,
  **Top up** (extend TTL), and **Add capacity** (dilute depth). Batches are
  bought/topped up from the **Bee node's BZZ wallet** (not MetaMask). Pure
  sizing/health helpers are unit-tested (`src/lib/postage.test.mjs`); see
  [docs/POSTAGE.md](../../docs/POSTAGE.md).

## Status (CLAUDE.md build step #6)

- [x] Shop registration (`registerShop`).
- [x] Listing CRUD + Swarm image upload (writes `ListingMetadata`).
- [x] Order dashboard: watch `OrderFunded`, surface state, decrypt action.
- [x] Handle disputes (open / arbiter-resolve) + `claimAfterTimeout`.
- [x] Mark shipped (off-chain local memo — no on-chain shipped state).
- [x] **PSS messaging wired live** at `src/messaging/index.js`:
      `receiveDecryptedAddress` (decrypt the buyer's address with your unlocked
      ECIES key) and `sendShipmentUpdateFromCms` (send a tracking code back to
      the buyer, encrypted to their ContactRegistry key + signed by your wallet),
      both delegating to `@freemarket/messaging`. `BeeTransport` is constructed
      only behind the config gate; private key unlocked at runtime, never
      committed/env'd. Graceful stub (`{ stub: true }`) when unconfigured. Real
      PSS needs a full Bee node on both ends.
