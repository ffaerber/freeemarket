# FreeMarket Contracts

Foundry project for the shared `Marketplace` escrow + listings contract — the
single source of truth for all shops on Gnosis Chain.

- `src/Marketplace.sol` — built, compiles clean (~6.9KB). **Unaudited.**
- `test/` — Foundry suite: unit, fuzz, and invariant tests (40 tests).
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

## TODO

- [ ] Decide identity model — possibly strip `encryptionPubKey`/`shippingRef`
      in favor of SwarmChat `ContactRegistry` (CLAUDE.md §4, §5).
- [ ] Deploy script with confirmed token address.
- [ ] Fork test against real Gnosis USDC (optional).
- [ ] Audit before handling real funds.
