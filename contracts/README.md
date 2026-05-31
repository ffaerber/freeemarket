# FreeMarket Contracts

Foundry project for the shared `Marketplace` escrow + listings contract — the
single source of truth for all shops on Gnosis Chain.

- `src/Marketplace.sol` — built, compiles clean. Pure escrow + listings: seller
  keys and encrypted shipping addresses are off-chain (see Identity model below).
  **Unaudited.**
- `test/` — Foundry suite: unit, fuzz, and invariant tests (57 tests, all passing).
- `script/Deploy.s.sol` — deploys `Marketplace` and seeds the accepted-token
  allowlist (multi-token; see Deploy below).

## Setup

The web/CI sandbox blocks `foundryup` and `binaries.soliditylang.org`, so a
helper script fetches the toolchain + libs from GitHub instead:

```sh
./setup-toolchain.sh                       # installs forge, solc 0.8.20, libs
export PATH="$HOME/.foundry/bin:$PATH"
forge test --offline
```

On an unrestricted machine the usual flow also works:

```sh
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.1.0
forge test
```

## Tests

- `test/Marketplace.t.sol` — unit + revert coverage: shops, listings, buy/escrow,
  confirm, timeout, disputes, fee math, admin, reentrancy guard.
- `test/MarketplaceFuzz.t.sol` — fuzz: fee conservation (`payout + fee == amount`)
  and the timeout boundary.
- `test/invariant/` — handler-driven escrow-solvency invariant: the contract's
  USDC balance always equals open escrow + accrued fees.
- `test/mocks/` — `MockUSDC` (6-dp) and `ReentrantToken` (reentrancy probe).

## Deploy

`script/Deploy.s.sol` deploys the contract and seeds the owner-curated
accepted-token allowlist. The contract hardcodes no token — the choice lives in
the script (and can be changed later via `setTokenAccepted`). Config is via env,
all optional:

| Env | Meaning | Default |
|---|---|---|
| `TOKENS` | comma-separated ERC-20 addresses to seed the allowlist | Gnosis WXDAI + bridged USDC |
| `OWNER` | arbiter/owner (disputes, fees, allowlist) | the broadcasting address |

The platform fee starts at 0; the owner sets it post-deploy via `setFeeBps`.

```sh
# Dry run (no broadcast) — prints the resolved plan + a simulated address
forge script script/Deploy.s.sol:Deploy

# Deploy to Gnosis Chain (id 100)
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.gnosischain.com \
  --private-key $PRIVATE_KEY --broadcast

# Explicit config
TOKENS=0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d OWNER=0xYourArbiter \
  forge script script/Deploy.s.sol:Deploy --rpc-url ... --broadcast
```

Canonical Gnosis token addresses are documented as constants in the script
(WXDAI 18-dp, bridged USDC 6-dp, and USDC.e as an alternative).

## Identity model (decided: delegate to SwarmChat)

Build step §9.3 is resolved in favor of **delegating keys + messaging to
SwarmChat** (CLAUDE.md §5). The contract is therefore pure escrow + listings:

- `registerShop(bytes32 metadata)` — no on-chain encryption key. Sellers publish
  their ECIES key via SwarmChat's `ContactRegistry`.
- `buy(uint256 listingId)` — no `shippingRef`. The buyer sends their
  ECIES-encrypted address to the seller over PSS, stamped with a short-lived
  Swarm postage batch so the ciphertext self-expires after fulfillment. The
  seller correlates it to an order via the `OrderFunded(orderId, …, buyer, …)`
  event.

This keeps no address — and no pointer to one — on the public chain, and trims
the contract surface ahead of audit.

## TODO

- [x] Decide identity model — delegated to SwarmChat `ContactRegistry` + PSS;
      `encryptionPubKey`/`shippingRef` stripped (CLAUDE.md §9.3).
- [x] Multi-token escrow — owner-curated `acceptedTokens` allowlist + per-listing
      token choice (CLAUDE.md §9.4).
- [x] Deploy script (`script/Deploy.s.sol`) — seeds the allowlist; no hardcoded
      token.
- [ ] Fork test against real Gnosis USDC/WXDAI (optional).
- [ ] Audit before handling real funds.
