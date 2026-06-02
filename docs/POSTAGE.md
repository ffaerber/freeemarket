# Postage Stamps — Storage vs Messaging (Swarm batch management)

> Status: **built** (config split + auto-create + seller TTL monitor/top-up).
> Companion to [CLAUDE.md §5](../CLAUDE.md) (encrypted shipping) and
> [DEPLOY.md](DEPLOY.md) (per-shop site upload).

Swarm charges for storage up front via a **postage batch** ("stamp"). A batch is
a prepaid credit: you buy it once on a full Bee node and every upload (a chunk)
is stamped against it. Two numbers define a batch:

| Parameter | Meaning | Drives |
|---|---|---|
| `depth` | capacity = `2^depth` chunks (a chunk ≈ 4 KB) | **how much** data fits |
| `amount` | per-chunk balance, in PLUR (1 BZZ = 1e16 PLUR) | **how long** the data lives (TTL) |

TTL is `amount ÷ current-storage-price` blocks; you extend it by **topping up**
(adding `amount`) and grow capacity by **diluting** (raising `depth`). A batch
also has an `immutableFlag`: immutable batches can't be over-written but are
cheaper to reason about; mutable batches can be reused.

## Why FreeMarket needs *two* batches

The app stamps two very different kinds of data, with **opposite lifetimes**:

| Purpose | What | Who pays | Wanted lifetime | Batch |
|---|---|---|---|---|
| **Storage** | Product images + listing/shop metadata JSON | **Seller** (CMS) | **Long** — alive as long as the shop is live; topped up over time | durable, larger `depth`, high `amount` |
| **Messaging** | ECIES-encrypted shipping address (buyer→seller) and tracking code (seller→buyer) over PSS | buyer **and** seller | **Short** — the ciphertext should *self-expire after fulfillment* (CLAUDE.md §5) | ephemeral, small `depth`, low `amount` |

Originally a single `VITE_POSTAGE_BATCH_ID` was reused for both — a design
conflict, because one batch can't be both "long-lived for product images" and
"short-lived so messages self-expire." They are now **separate batches**:

- `VITE_STORAGE_BATCH_ID` — durable storage (CMS uploads).
- `VITE_MESSAGING_BATCH_ID` — short-lived PSS messages (storefront + CMS).

**Backward compatible:** both fall back to the legacy `VITE_POSTAGE_BATCH_ID`
when their specific var is unset, so existing single-batch setups keep working
(they just don't get the self-expiry benefit). Set the two specific vars to opt
into the split.

### Buyer vs seller asymmetry

- **Buyer (storefront)** only needs a *messaging* batch — small + short — to
  *send* the address. Reading the seller's tracking reply needs **no** batch
  (it reads a feed). So the buyer's footprint is tiny and ephemeral.
- **Seller (CMS)** needs *both*: a durable *storage* batch for images/metadata
  **and** a *messaging* batch to send the tracking code back.

## What the app manages for you

`apps/cms/src/lib/postage.js` is the batch-management module (the CMS **Storage**
tab is its UI). It is intentionally split into **pure helpers** (unit-tested,
no Bee node) and **thin Bee wrappers** (activated against a live node):

- **Sizing presets** — `BATCH_PRESETS.storage` (durable, mutable, larger) and
  `BATCH_PRESETS.messaging` (ephemeral, small). Defaults are conservative
  starting points; tune `amount`/`depth` for your shop's catalog size and the
  current Swarm storage price.
- **Auto-create on demand** — `ensureBatch(bee, purpose, configured)` returns a
  usable batch id: it reuses `configured` if it's still usable, otherwise scans
  existing node batches for a usable match by label, otherwise **buys** one with
  the purpose's preset. Nothing is bought implicitly during normal app flow —
  only when the operator clicks **Create** in the Storage tab (buying spends the
  Bee node's BZZ).
- **Lifecycle (seller)** — the Storage tab reads each batch (`getBatch`), shows
  remaining **duration / capacity / usage** with a health badge
  (`classifyHealth`: ok / warn / critical / expired), and offers **Top up**
  (extend TTL) and **Add capacity** (dilute `depth`) so the seller keeps product
  content alive.

### Who actually pays

Postage is bought by the **Bee node's own BZZ wallet** via the node API — *not*
the connected MetaMask wallet (that's only for Gnosis escrow). So batch
create/top-up/dilute are node calls with no on-chain signature; fund the Bee
node's wallet with **xBZZ** (Gnosis) beforehand. Because buying spends real
funds, every write in the Storage tab is behind an explicit button + confirm.

## Configuration

| Var | App | Purpose |
|---|---|---|
| `VITE_STORAGE_BATCH_ID` | CMS | Durable batch for image/metadata uploads. Falls back to `VITE_POSTAGE_BATCH_ID`. |
| `VITE_MESSAGING_BATCH_ID` | CMS + storefront | Short-lived batch for PSS messages. Falls back to `VITE_POSTAGE_BATCH_ID`. |
| `VITE_POSTAGE_BATCH_ID` | CMS + storefront | **Legacy** single batch; used as the fallback for both of the above. |
| `VITE_BEE_URL` | both | Writeable **full** Bee node (not a gateway) — required to buy/manage batches and for PSS. |

None of these are secrets (a batch id is a storage-credit reference, not a key),
but they are **per-node**: a batch only exists on the node that bought it.

## Caveats

- A batch only works on the node that owns it — buyer and seller each manage
  their own.
- TTL is relative to the **current** storage price; if the price rises, a batch
  drains faster. The Storage tab's health badge is a snapshot — check it before
  a long catalog push.
- bee-js's `PostageBatch` shape has shifted across versions; the Bee wrappers in
  `postage.js` read fields defensively (`normalizeBatch`) so a minor field
  rename doesn't break the UI. These wrappers can't run in CI (they need a live
  node) — only the pure helpers are unit-tested (`postage.test.mjs`).
