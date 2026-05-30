# FreeMarket Contracts

Foundry project for the shared `Marketplace` escrow + listings contract — the
single source of truth for all shops on Gnosis Chain.

- `src/Marketplace.sol` — built, compiles clean. Pure escrow + listings: seller
  keys and encrypted shipping addresses are off-chain (see Identity model below).
  **Unaudited.**
- `test/` — Foundry suite: unit, fuzz, and invariant tests (39 tests, all passing).
- `script/` — deploy script (TODO; set USDC/xDAI token address per build step 4).

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
- [ ] Deploy script with confirmed token address.
- [ ] Fork test against real Gnosis USDC (optional).
- [ ] Audit before handling real funds.
