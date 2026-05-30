# FreeMarket Contracts

Foundry project for the shared `Marketplace` escrow + listings contract — the
single source of truth for all shops on Gnosis Chain.

- `src/Marketplace.sol` — built, compiles clean (~6.9KB). **Unaudited, untested.**
- `test/` — Foundry suite (TODO; see [CLAUDE.md §9](../CLAUDE.md) build step 2).
- `script/` — deploy script (TODO; set USDC/xDAI token address per build step 4).

## Setup

```sh
forge install OpenZeppelin/openzeppelin-contracts
forge build
forge test
```

## TODO

- [ ] Test suite: happy paths, escrow release, timeout, dispute, fees, fuzz, invariants.
- [ ] Decide identity model — possibly strip `encryptionPubKey`/`shippingRef`
      in favor of SwarmChat `ContactRegistry` (CLAUDE.md §4, §5).
- [ ] Deploy script with confirmed token address.
- [ ] Audit before handling real funds.
