# FreeMarket Contracts

Foundry project for the shared `Marketplace` escrow + listings contract — the
single source of truth for all shops on Gnosis Chain.

- `src/Marketplace.sol` — built, compiles clean. Pure escrow + listings: seller
  keys and encrypted shipping addresses are off-chain (see Identity model below).
  **Unaudited.**
- `test/` — Foundry suite: unit, security, fuzz, and invariant tests (69 tests,
  all passing). See **Security hardening** below.
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
  confirm, timeout, disputes, full-payout/no-fee, admin, reentrancy guard.
- `test/MarketplaceSecurity.t.sol` — pre-audit hardening regressions (no-renounce
  + Ownable2Step, fee-on-transfer-safe escrow, allowlist re-check on buy, pausable
  intake). See **Security hardening** below.
- `test/MarketplaceFuzz.t.sol` — fuzz: full payout / no fee (`payout == amount`,
  contract retains nothing) and the timeout boundary.
- `test/invariant/` — handler-driven escrow-solvency invariant: the contract's
  USDC balance always equals open escrow exactly (no fee is ever retained).
- `test/mocks/` — `MockUSDC` (6-dp), `MockToken` (configurable decimals),
  `ReentrantToken` (reentrancy probe), and `FeeOnTransferToken` (1%-skimming token).

## Security hardening

A pre-audit hardening pass (`test/MarketplaceSecurity.t.sol`) covers four
mitigations baked into `Marketplace.sol`. The contract is **still unaudited** —
do not handle real funds until externally reviewed.

1. **Permanent arbiter.** `Ownable2Step` (2-step ownership transfer) +
   `renounceOwnership()` overridden to revert, so the sole dispute arbiter can
   never be removed and Disputed escrow can never lock.
2. **Fee-on-transfer-safe escrow.** `buy` records the actually-received amount
   (a `balanceOf` delta around the transfer), not the listed price, so a
   skimming token can't over-draw other orders' escrow. Proven against the
   `FeeOnTransferToken` mock.
3. **Allowlist re-check on `buy`.** De-listing a compromised token blocks new
   funding immediately; already-funded orders still settle on their snapshotted
   token.
4. **Pausable circuit breaker on intake only.** `pause()`/`unpause()` gate
   `buy`/`createListing` only — all settlement and exit paths stay callable
   while paused, so pausing can never trap funds.

## Deploy

`script/Deploy.s.sol` deploys the contract and seeds the owner-curated
accepted-token allowlist. The contract hardcodes no token — the choice lives in
the script (and can be changed later via `setTokenAccepted`). Config is via env,
all optional:

| Env | Meaning | Default |
|---|---|---|
| `TOKENS` | comma-separated ERC-20 addresses to seed the allowlist | Gnosis WXDAI + bridged USDC |
| `OWNER` | arbiter/owner (disputes, allowlist) | the broadcasting address |

There is **no platform fee**: every order settles 100% from buyer to seller. The
contract has no fee rate, no fee accounting, and no owner withdrawal path, so the
operator earns nothing from facilitating trades.

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
