# FreeMarket — Project Spec

A decentralized, multi-vendor marketplace (an "open eBay") where anyone can run their own shop, sell physical goods, and get paid in stablecoins through on-chain escrow. Built on Gnosis Chain + Ethereum Swarm.

This document is a handoff brief: drop it into the repo (e.g. as `CLAUDE.md` or `docs/SPEC.md`) so Claude Code has full context to continue the build.

---

## 1. Vision

- **Multi-vendor.** Anyone registers a shop and lists items — like eBay/Shopify, but permissionless. The fruit seller and the car-parts seller share nothing except the backend.
- **Shared backend, independent storefronts.** One smart contract is the source of truth for all shops. Each shop runs its own customizable storefront.
- **Trustless payment.** Buyers pay USDC into escrow; funds release to the seller only on delivery confirmation (or timeout), with a dispute path.
- **Private shipping.** Addresses are end-to-end encrypted to the seller and never appear on-chain in plaintext.

---

## 2. Architecture — Headless Commerce

Three layers around one shared spine:

| Layer | What it is | Per-shop? | Status |
|---|---|---|---|
| **Smart contract** (`Marketplace`) | Listings, escrow, orders, disputes. Single source of truth on Gnosis. | No — shared by all shops | Built, compiles clean. Untested/unaudited. |
| **Storefront** | Customer-facing, themeable SPA. Reads the contract, filtered by shop's seller address. | Yes — one deploy per shop, own ENS + Swarm | Demo template built |
| **CMS / admin** | Merchant back-office: create listings, upload images to Swarm, fulfill orders, decrypt shipping addresses. Talks only to contract + Swarm + PSS, so it's generic. | No — one shared app (ideally run locally for address privacy) | Built (`apps/cms`) — shop registration, listing CRUD + Swarm image upload, order dashboard (claim/dispute/resolve). PSS messaging wired live to `@freemarket/messaging` (decrypt address + send tracking), gated on ContactRegistry + Bee node + local key, graceful stub fallback. |

The layers interoperate through a **shared Swarm JSON schema** (see §6). That schema is the real platform contract: the CMS writes it, any storefront reads it.

```
                ┌─────────────────────────────┐
   buyers ─────▶│  Storefront (per shop)      │
                │  freemarket-themed SPA      │──┐
                └─────────────────────────────┘  │ reads
                ┌─────────────────────────────┐  │ writes
   merchant ───▶│  CMS / Admin (shared)       │──┤
                └─────────────────────────────┘  │
                ┌─────────────────────────────┐  ▼
                │  Marketplace contract       │  Gnosis Chain
                │  + Swarm (metadata/images)  │  + Swarm
                │  + PSS (encrypted addresses)│  + SwarmChat ContactRegistry
                └─────────────────────────────┘
```

---

## 3. Tech Stack & Key Decisions

| Choice | Decision | Why |
|---|---|---|
| Chain | **Gnosis Chain** (ID 100) | Aligns with SwarmChat; cheap xDAI gas; native xDAI is a USD stable. |
| Payment token | USDC on Gnosis **or** xDAI — *OPEN* | xDAI is native + stable; USDC needs bridged-token address confirmed. |
| Hosting | **Swarm + ENS contenthash** | Decentralized static hosting; resolve via `name.eth.limo`. |
| Naming | **`freemarket.eth`** (pending availability check) | 10 chars = $5/yr ENS tier. ENS lives on **mainnet** regardless of contract chain. |
| Messaging | **Swarm PSS via SwarmChat** | Reuse existing `ContactRegistry` + `lib/` messaging stack for encrypted addresses. |
| Encryption | **ECIES** (`eciesjs`) | MetaMask's native `eth_decrypt`/`eth_getEncryptionPublicKey` are deprecated — do not use. |
| Frontend | React + Vite + wagmi v2 + viem + `@ethersphere/bee-js` | Matches SwarmChat's stack. |

### Rejected approaches (and why)
- **x402 (Coinbase HTTP payments)** — great for digital goods / AI-agent payments, but it settles immediately over HTTP. Physical goods need held escrow + delivery confirmation, so it's the wrong tool here.
- **Seaport / thirdweb MarketplaceV3** — battle-tested but atomic-swap (token ↔ payment in one tx). A contract can't move a physical item, so no off-the-shelf marketplace fits; a custom escrow contract is required.

---

## 4. Smart Contract — `Marketplace.sol`

Solidity ^0.8.20, OpenZeppelin v5 (`SafeERC20`, `ReentrancyGuard`, `Ownable`). Compiles clean. **Multi-token:** the owner curates an `acceptedTokens` allowlist; each listing picks one accepted ERC-20 and is priced in that token's smallest unit (decimals vary — USDC's 6 dp means 10 USDC = `10_000_000`; an 18-dp token uses `10 * 1e18`). The order snapshots its token at `buy` time, so settlement is unaffected if the allowlist later changes. Fees accrue per token.

**Order lifecycle:** `Funded → Completed | Refunded` (with `Disputed` as a branch).

| Function | Access | Purpose |
|---|---|---|
| `constructor(address[] initialTokens, owner)` | — | Seeds the accepted-token allowlist and sets the arbiter/owner. |
| `setTokenAccepted(token, accepted)` | owner | Add/remove an ERC-20 from the accepted-token allowlist. |
| `registerShop(bytes32 metadata)` | anyone | Create/update a shop. `metadata` = Swarm ref to shop profile. (Seller encryption key lives off-chain in SwarmChat — see §5.) |
| `createListing(address token, uint256 price, bytes32 metadata)` | shop owner | New listing priced in an accepted `token`; `metadata` = Swarm ref to item details/photos. |
| `updateListing(id, price, metadata, active)` | listing seller | Edit price/metadata/active. The settlement token is immutable after creation. |
| `buy(uint256 listingId)` | buyer | Pulls the listing's token into escrow (snapshotting it on the order). Needs prior `approve`. Encrypted address is sent off-chain over PSS, keyed by `orderId` (see §5). |
| `confirmReceipt(orderId)` | buyer | Releases escrow to seller (in the order's token). |
| `claimAfterTimeout(orderId)` | seller | Releases escrow after `autoReleasePeriod` (default 14d) if buyer is silent. |
| `openDispute(orderId)` | buyer or seller | Moves order to `Disputed`. |
| `resolveDispute(orderId, refundBuyer)` | owner (arbiter) | Refund buyer or pay seller. |
| `setFeeBps`, `setAutoReleasePeriod`, `withdrawFees(token, to)` | owner | Admin. Fee capped at 10%; fees are withdrawn per token. |

**Events:** `ShopRegistered`, `TokenAccepted(token, accepted)`, `ListingCreated(id, seller, token, price, metadata)`, `ListingUpdated`, `OrderFunded(orderId, listingId, buyer, seller, token, amount)`, `OrderCompleted`, `OrderRefunded`, `DisputeOpened`, `FeesWithdrawn(token, to, amount)`, plus admin events.

> **Decided (was open):** identity/keys are delegated to SwarmChat's `ContactRegistry` (§5). The `encryptionPubKey` field and the `shippingRef` argument have been removed, leaving the contract as **pure escrow + listings**. Encrypted addresses travel off-chain over PSS, stamped with a short-lived Swarm postage batch so the ciphertext self-expires after fulfillment.

---

## 5. Encrypted Shipping Addresses (via SwarmChat / PSS)

The hard part of a physical marketplace: getting the buyer's address to the seller privately. **Plaintext addresses must never go on-chain.**

Recommended flow, reusing SwarmChat:
1. **Key publishing** — sellers already publish a PSS public key via SwarmChat's `ContactRegistry.register()`. Reuse it instead of duplicating a key in `Marketplace`.
2. **Buyer pays** — `usdc.approve` → `market.buy(listingId)` on Gnosis. Funds escrowed.
3. **Buyer sends address** — encrypt `{ orderId, name, address }` to the seller's PSS key (ECIES), send over PSS using SwarmChat's `lib/transport.ts` + `envelope.ts`. The signed envelope lets the seller verify the sender == `order.buyer` on-chain.
4. **Offline delivery** — message is also written to the per-recipient Swarm feed (SwarmChat's store-and-forward), so an offline shop still receives it.
5. **Fulfillment** — CMS decrypts with the seller's private key, ships, buyer calls `confirmReceipt`, escrow releases.
6. **Tracking reply (seller → buyer)** — after shipping, the seller sends a tracking code `{ orderId, carrier?, trackingCode?, note? }` back to the buyer over the SAME machinery: ECIES-encrypted to the buyer's key, signed envelope (buyer verifies signer == `order.seller`), delivered over PSS + the buyer's feed.

> ✅ **Built:** `packages/messaging` (`@freemarket/messaging`) implements this flow **bidirectionally** — `sendShippingAddress`/`receiveShippingAddress` (buyer→seller) and `sendShipmentUpdate`/`receiveShipmentUpdate` (seller→buyer tracking) — with ECIES (eciesjs), signed envelopes (viem) carrying the on-chain sender check, and a pluggable transport (`BeeTransport` for real PSS+feeds, `InMemoryTransport` for tests).
>
> ✅ **Wired into both apps (live, gated):** the storefront and CMS messaging boundaries (`apps/storefront/src/messaging`, `apps/cms/src/messaging`) now delegate to `@freemarket/messaging` and go **live** when configured, with a **graceful stub fallback** when not:
> - **Counterparty ECIES key** is resolved on-chain via SwarmChat's **ContactRegistry** — a minimal viem ABI in `apps/<app>/src/lib/contactRegistry.js` (centralized for a one-line fix; the exact registry selector must be confirmed against the deployed SwarmChat registry), keyed by `VITE_CONTACT_REGISTRY`. Unset / no entry ⇒ unconfigured ⇒ stub.
> - **Transport** (`BeeTransport`) is constructed **only** behind the config gate — needs `VITE_BEE_URL` (a full Bee node, not a gateway) + `VITE_POSTAGE_BATCH_ID` (storefront sends, CMS replies).
> - **Private keys are unlocked LOCALLY at runtime, never committed/env'd:** the CMS has an "Unlock decryption key" field (React/sessionStorage only, never `localStorage` by default, never logged/sent) feeding the seller's ECIES key into `receiveShippingAddress`; the storefront's "Track order" panel takes the buyer's key the same way for `receiveShipmentUpdate`.
> - **Envelope signing** uses the connected wallet (`useWalletClient` → `signMessage({ message: { raw: digest } })`, EIP-191), so the seller verifies signer == `order.buyer` and the buyer verifies signer == `order.seller`.
>
> Both directions are live: storefront sends the shipping address + reads tracking; CMS decrypts the address + sends the tracking code. The real PSS transport still needs a full Bee node on both ends.

### Caveats (record these)
- **Both parties need a full Bee node** to use PSS (not a gateway). Freedom Browser bundles one. This is the main UX friction for casual buyers.
- **Key custody is on the merchant.** Lose the encryption private key → can't read addresses. Back it up; support rotation.
- **The transaction graph is public.** The address content is hidden, but "buyer X paid shop Y, amount Z, time T" is visible on-chain.

---

## 6. Shared Swarm Schema (TO DEFINE — highest priority)

Both CMS and storefront depend on this; pin it before building more clients. Draft:

```ts
// Pointed to by Shop.metadata (bytes32 Swarm ref)
interface ShopProfile {
  version: 1;
  name: string;
  ens?: string;
  tagline?: string;
  blurb?: string;
  logo?: string;      // Swarm ref
  banner?: string;    // Swarm ref
  theme: {            // white-label tokens (see Storefront.jsx)
    bg: string; surface: string; text: string; muted: string;
    accent: string; accent2: string; border: string; radius: string;
    display: string; body: string;
  };
}

// Pointed to by Listing.metadata (bytes32 Swarm ref)
interface ListingMetadata {
  version: 1;
  title: string;
  variant?: string;   // e.g. "100 g jar", "Front · ceramic"
  description?: string;
  images: string[];   // Swarm refs
  category?: string;
  attributes?: Record<string, string>;
  // price is ON-CHAIN (USDC 6-dp), not here
}
```

Deliver as a `packages/schema` with TS types + JSON Schema validation, shared by all clients.

---

## 7. Storefront (demo built → port to real stack)

`Storefront.jsx` is a config-driven white-label engine: one component renders radically different shops (a bright fruit stand vs a dark industrial parts shop) purely from a config object. That config is the customization surface — a merchant or an AI edits it, then deploys.

To productionize:
- Port to the Vite + wagmi v2 + viem + bee-js stack.
- Replace mock `listings` with on-chain reads (filter `ListingCreated`/`listings` by shop's seller address) + Swarm metadata fetch.
- Wire the checkout: `usdc.approve` → `market.buy` → encrypt address + PSS send (reuse SwarmChat `lib/`).
- Replace glyph placeholders with Swarm-hosted images.

---

## 8. Deploy Pipeline

Reuse SwarmChat's `make deploy-frontend` per shop:
1. Build the storefront.
2. Upload to Swarm (Bee node), get the **feed manifest hash** (not raw hash — lets future updates resolve without re-touching ENS).
3. Set the ENS `contenthash` on **mainnet** to the feed manifest.
4. Shop is live at `shopname.eth.limo`. Escrow contract stays on Gnosis.

---

## 9. Build Order / TODO

1. ~~**Schema** (`packages/schema`) — TS types + JSON Schema.~~ ✅ Done.
2. ~~**Contract tests** — Foundry suite (happy paths, escrow release, timeout, dispute, fees, fuzz, invariants).~~ ✅ Done (51 tests, incl. multi-token + deploy script).
3. ~~**Decide identity model** — delegate keys/comms to `ContactRegistry` + PSS, then strip `encryptionPubKey`/`shippingRef` from `Marketplace`.~~ ✅ Done — delegated to SwarmChat; contract is now pure escrow + listings.
4. ~~**Confirm token** — Gnosis USDC address or commit to xDAI; set in deploy script.~~ ✅ Done — replaced the single hardcoded token with an owner-curated `acceptedTokens` allowlist + per-listing token choice (multi-token escrow). The deploy script (`contracts/script/Deploy.s.sol`) seeds the allowlist — defaulting to Gnosis WXDAI + bridged USDC, overridable via the `TOKENS` env — and the owner can add/remove tokens later via `setTokenAccepted`. No single token is hardcoded.
5. **Storefront (real)** — port template, wire contract + Swarm + PSS.
6. ~~**CMS / admin** — shop registration, listing CRUD + Swarm image upload, order dashboard (watch `OrderFunded`, pull + decrypt PSS address), mark shipped, disputes.~~ ✅ Done (`apps/cms`) — built on the storefront's stack (Vite + wagmi v2 + viem + bee-js + `@freemarket/schema`). Shop registration (`registerShop`, schema-validated profile → Swarm), listing CRUD + Swarm image/metadata upload (per-listing accepted-token pick, decimals read on-chain via `parseUnits`), order dashboard (`OrderFunded` filtered by seller + live `orders()` state, `claimAfterTimeout`/`openDispute`/owner-only `resolveDispute`). Mark-shipped is an off-chain localStorage memo (no on-chain shipped state). PSS messaging is **wired live** to `@freemarket/messaging` (`receiveDecryptedAddress` decrypts the buyer's address with the merchant's locally-unlocked ECIES key; `sendShipmentUpdateFromCms` sends a tracking code back to the buyer), gated on ContactRegistry + a full Bee node + postage batch + the unlocked key, with a graceful stub fallback when unconfigured (see step 9 below).
7. **Deploy** — per-shop Swarm + ENS pipeline.
8. **Audit** — before any real funds on mainnet.
9. ~~**Messaging lib** (`packages/messaging`, `@freemarket/messaging`) — encrypted PSS messaging.~~ ✅ Done — **bidirectional**: buyer→seller shipping address AND seller→buyer tracking code, on shared machinery (ECIES via eciesjs + signed envelopes via viem with on-chain sender verification, `BeeTransport` for real PSS+feeds / `InMemoryTransport` for tests). Unit-tested (crypto round-trip, envelope tamper/forgery, both end-to-end flows, cross-direction isolation) without a Bee node. **Wired live into both apps** as a `file:` dep: storefront sends the shipping address + reads tracking; CMS decrypts the address + sends the tracking code — each delegating to the library when ContactRegistry (`VITE_CONTACT_REGISTRY`) + a full Bee node (`VITE_BEE_URL`) + postage batch (`VITE_POSTAGE_BATCH_ID`) + the locally-unlocked private key are present, and otherwise returning a graceful stub. `BeeTransport` is constructed only behind that gate; private keys are unlocked at runtime (never committed/env'd). Real PSS transport still needs a full Bee node (not a gateway).

---

## 10. Suggested Repo Structure (monorepo)

```
freemarket/
├── contracts/              # Foundry — Marketplace.sol, tests, deploy script
├── packages/
│   ├── schema/             # Shared TS types + JSON Schema (§6)
│   └── messaging/          # ✅ Built — `@freemarket/messaging`: ECIES + signed envelopes + PSS/feed transport (bidirectional)
├── apps/
│   ├── storefront/         # White-label Vite template (clone per shop)
│   └── cms/                # Merchant admin app
├── CLAUDE.md               # this spec
└── Makefile                # build / test / deploy (adapt from SwarmChat)
```

---

## 11. Known Constraints

- Contract is **unaudited** — do not handle real funds until tested + reviewed.
- Dispute arbiter is currently the contract owner (centralized). Upgrade path: Kleros-style decentralized arbitration plugged into `resolveDispute`.
- USDC is an admin-controlled token (can freeze addresses) — a frozen party can cause a transfer to revert. Not fixable at the contract level.
- Cross-shop search/browse needs an indexer (The Graph). Per-shop listing reads can use contract events directly.
- Existing artifacts to carry over: `Marketplace.sol`, `Storefront.jsx`.
