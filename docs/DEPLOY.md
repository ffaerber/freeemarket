# FreeeMarket — Per-shop Deploy Pipeline (Swarm + ENS)

How to put one shop's storefront on Swarm and point its ENS name at it. This is
CLAUDE.md §8 / build step #7, implemented as a real, runnable script:
[`scripts/deploy-frontend.mjs`](../scripts/deploy-frontend.mjs).

Each shop is its own static build + Swarm address + ENS name, all reading the
**same** shared `Marketplace` escrow contract on Gnosis Chain (filtered by the
shop's seller address). The contract stays on Gnosis; only the storefront lives
on Swarm/ENS.

## What the pipeline does

```
  vite build (shop env baked in)        ── step 1 (optional, BUILD=1)
        │  dist/
        ▼
  upload dist/ to Swarm as a website    ── step 2  → content reference
  collection (index + error document)
        │
        ▼
  write a Swarm FEED (owned by your      ── step 3  → FEED MANIFEST (stable)
  feed key) → points at the content
        │
        ▼
  encode bzz://<feedManifest> as an      ── step 4  → ENS contenthash
  EIP-1577 contenthash → set on mainnet
  ENS  *or*  print it (default)
```

**Why a feed manifest, not the raw content hash?** ENS points at the *feed
manifest*, which is a **stable address** derived from `(feed owner, topic)`. To
update the site you just re-write the feed (step 3) to point at a new upload —
the feed manifest doesn't change, so **ENS is touched exactly once** (first
deploy) and never again. Pointing ENS at a raw content hash would force a
mainnet tx on every update.

## Prerequisites

| Need | Why | Notes |
|---|---|---|
| A **full Bee node** (writeable) | Uploads + feed writes need write access | NOT a gateway. Default `http://localhost:1633`. Freedom Browser bundles one. |
| A **funded postage batch** ("stamp") | Pays for the upload + feed chunks | Buy via your Bee node; pass as `POSTAGE_BATCH_ID`. Per-node; keep out of git. |
| A **Swarm feed key** | Signs feed updates; its owner+topic defines the stable address | 0x + 64 hex. **Separate from any wallet/ENS key.** Whoever holds it controls future site updates — back it up. Runtime-only; never commit/log. |
| An **ENS name** you own on mainnet | The `shopname.eth` the site resolves at | ENS is on **mainnet** regardless of the escrow chain. |
| (live set only) A **mainnet ETH key** | Pays gas for the `setContenthash` tx | The name's controller / resolver manager. Runtime-only; never commit/log. |
| (live set only) A **mainnet RPC** | Sends the tx | `ENS_RPC_URL`. |

Install the pipeline's deps once:

```sh
cd scripts && npm install
```

## Environment

All config is env (mirrors `contracts/script/Deploy.s.sol`). Full reference in
the [script header](../scripts/deploy-frontend.mjs).

**Build (step 1):**

| Var | Default | Purpose |
|---|---|---|
| `BUILD` | unset | `1` ⇒ run `npm run build` in the storefront first. Else use a prebuilt `DIST_DIR`. |
| `STOREFRONT_DIR` | `../apps/storefront` | Storefront app dir (relative to `scripts/`). |
| `DIST_DIR` | `<STOREFRONT_DIR>/dist` | Prebuilt dist to upload. |
| `VITE_*` | — | Any `VITE_`-prefixed var is passed through to the build and **baked in** (per-shop config: `VITE_MARKETPLACE_ADDRESS`, `VITE_SELLER`, `VITE_RPC_URL`, `VITE_BEE_URL`, `VITE_CONTACT_REGISTRY`, `VITE_POSTAGE_BATCH_ID`, …). |

**Swarm (steps 2–3):**

| Var | Default | Purpose |
|---|---|---|
| `BEE_URL` | `http://localhost:1633` | Writeable **full** Bee node base URL. |
| `POSTAGE_BATCH_ID` | — (**required**) | Funded postage batch for the upload + feed. |
| `FEED_PRIVATE_KEY` (or `FEED_SIGNER`) | — (**required**) | Swarm feed owner key. Runtime-only; never commit/log. |
| `FEED_TOPIC` | `freeemarket-storefront` | Feed topic label. Keep constant across redeploys of one shop (same owner+topic = same stable address). |

**ENS (step 4):**

| Var | Default | Purpose |
|---|---|---|
| `ENS_NAME` | — | e.g. `shopname.eth`. Needed to print the namehash + `.eth.limo` URL; required for a live set. |
| `ENS_RPC_URL` | — | Mainnet RPC. Live set only. |
| `ENS_PRIVATE_KEY` | — | Mainnet controller key with ETH. Live set only. Runtime-only; never commit/log. |
| `ENS_RESOLVER` | resolved on-chain | Explicit resolver override. |
| `CONFIRM_MAINNET` | unset | **Opt-in gate.** Without `=1`, the script is **print-only** even if a key + RPC are present. |

## Dry-run / print-only (the default — recommended first pass)

No mainnet tx is ever broadcast. The script uploads to Swarm, updates the feed,
and **prints** the contenthash + exact instructions to set ENS yourself.

```sh
cd scripts
POSTAGE_BATCH_ID=<64-hex> \
FEED_PRIVATE_KEY=0x<64-hex> \
ENS_NAME=shopname.eth \
BEE_URL=http://localhost:1633 \
VITE_MARKETPLACE_ADDRESS=0xYourMarketplace \
VITE_SELLER=0xYourShopSeller \
BUILD=1 \
  node deploy-frontend.mjs
```

Or via Make (from the repo root):

```sh
make deploy-frontend-build \
  POSTAGE_BATCH_ID=<64-hex> FEED_PRIVATE_KEY=0x<64-hex> ENS_NAME=shopname.eth \
  VITE_MARKETPLACE_ADDRESS=0x.. VITE_SELLER=0x..
```

(`make deploy-frontend` is the same but expects a prebuilt `DIST_DIR` — no build.)

Then take the printed `contenthash` and set it in the
[ENS manager](https://app.ens.domains/) → your name → Records → Content Hash,
or call `resolver.setContenthash(namehash, contenthash)` from a wallet you
control.

## Live ENS set (explicit opt-in)

Only when you want the script to broadcast the mainnet `setContenthash` tx for
you. Requires the three ENS vars **and** `CONFIRM_MAINNET=1`:

```sh
cd scripts
POSTAGE_BATCH_ID=<64-hex> FEED_PRIVATE_KEY=0x<64-hex> ENS_NAME=shopname.eth \
ENS_RPC_URL=https://your-mainnet-rpc ENS_PRIVATE_KEY=0x<mainnet-key> \
CONFIRM_MAINNET=1 \
VITE_MARKETPLACE_ADDRESS=0x.. VITE_SELLER=0x.. BUILD=1 \
  node deploy-frontend.mjs
```

The script resolves the name's resolver on-chain (or honours `ENS_RESOLVER`),
sends `setContenthash(namehash, contenthash)`, and waits for the receipt.

## Verify

After the contenthash is set and DNS/ENS propagation has settled, the shop is
live at:

```
https://shopname.eth.limo
```

(`name.eth.limo` is a public ENS gateway that reads the contenthash and serves
the Swarm site.) You can also check the record in the ENS manager, or resolve it
with any ENS-aware wallet/browser.

## Update flow

To ship a new version of the storefront:

1. Re-run the **same command** (same `FEED_PRIVATE_KEY` + `FEED_TOPIC`).
2. Step 2 uploads the new `dist/`; step 3 re-writes the feed to point at it.
3. The **feed manifest is unchanged**, so the ENS contenthash still resolves —
   **no mainnet tx, no ENS change.** The new site is live once the feed update
   propagates.

## Security notes

- **No secrets in git.** `POSTAGE_BATCH_ID`, `FEED_PRIVATE_KEY`, and
  `ENS_PRIVATE_KEY` are **runtime env only**. The script never logs key values —
  it only prints derived addresses and acknowledges a key is "set — redacted".
  `.env`/`.env.*` are git-ignored.
- **Mainnet is opt-in.** The default is print-only. A live `setContenthash` tx
  requires `ENS_RPC_URL` + `ENS_PRIVATE_KEY` **and** `CONFIRM_MAINNET=1` — the
  script never broadcasts by accident.
- **Feed key custody.** Whoever holds `FEED_PRIVATE_KEY` controls future updates
  to this shop's storefront. Back it up; treat it like a deploy key.
- **The escrow contract is unaudited** — see CLAUDE.md §11 before handling real
  funds.
