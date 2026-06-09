# Forking FreeMarket — adding VAT, fees & business compliance

FreeMarket's mainline is deliberately a **small, plain peer-to-peer market**:
no platform fee, no VAT, no business overhead. It's meant for individuals
exchanging small physical goods — a stall selling fruit, potatoes, jam, honey —
where the whole point is that two people trade directly and the operator takes
nothing.

That default won't fit everyone. A registered business reselling goods, or a
market operating where VAT must be charged and remitted, has real compliance
needs. **Because the whole stack is open source, the intended path is: fork it,
run your own contract, and add exactly what your situation requires.** This
guide shows the simplest way to do each common addition, and exactly which files
to touch.

> ⚠️ **Not legal or tax advice.** This document points at *where to make changes*
> in the code. Whether you must charge VAT, register a business, report under
> DAC7, or restrict certain goods depends on your jurisdiction and role. Talk to
> a lawyer/accountant before handling real funds. The contract is also
> **unaudited** (see `CLAUDE.md` §11).

---

## 0. The fastest fork: just run your own market

You don't have to change any code to run an independent market. Each deployment
is a standalone contract that **you** own and arbitrate.

```sh
git clone <your-fork> && cd freemarket
# deploy your own Marketplace (you become the owner/arbiter):
#   see contracts/script/Deploy.s.sol + docs/DEPLOY.md
```

- You pick the accepted tokens (`TOKENS` env) and you are the dispute arbiter
  (`OWNER` env). See [`contracts/README.md`](../contracts/README.md).
- Storefront + CMS point at your contract address via their `.env`
  (`VITE_MARKETPLACE_ADDRESS`).
- No fee, no VAT — money flows 100% buyer → seller.

Everything below is **optional**, layered on top of that.

---

## 1. Adding VAT

There are two levels, depending on what you actually need. **For most small
markets, Option A is enough and needs no contract change.**

### Option A — VAT as a receipt/invoice line (off-chain, no contract change) ✅ recommended

For small physical goods, VAT is usually a *display & bookkeeping* concern, not
a separate on-chain money movement: the buyer pays one amount, and that amount is
shown as "X + VAT". The on-chain price is already the single escrowed total, so
you only need to **show the breakdown and record the seller's VAT identity**.

The repo already has a display-only price-breakdown mechanism you can extend —
`ListingMetadata.pricing` (`{ item, shipping }`, decimal strings that reconcile
against the authoritative on-chain price). Add a `vat` leg the same way:

1. **Schema** — extend the types + breakdown helper:
   - `packages/schema/src/index.ts` — add `vat?: string` to `PricingBreakdown`,
     and (for the seller's tax identity) add optional `vatId?: string` /
     `businessName?: string` / `businessAddress?: string` to `ShopProfile`.
   - `packages/schema/src/pricing.ts` — `shippingFromPricing()` re-derives
     shipping as `price − item`; if you itemize VAT, decide whether `item` is
     VAT-inclusive or VAT-exclusive and reconcile the same way (the on-chain
     `price` stays authoritative — never show a total the buyer isn't paying).
   - `packages/schema/src/schemas.ts` — mirror the new fields in the JSON Schema
     so validation accepts them.
2. **CMS** — let the seller enter their VAT ID + the VAT rate/amount:
   - `apps/cms/src/sections/ListingsSection.jsx` (per-listing pricing inputs)
   - the shop form (where `ShopProfile` is edited) for the VAT ID / business info.
3. **Storefront** — render the VAT line on the product modal + checkout/receipt,
   next to the existing "item + shipping = total" itemization.

Because the on-chain price is unchanged, this is purely additive and backward
compatible: listings without VAT fields render exactly as before.

**Limit of this approach:** it *displays and records* VAT; it does not *collect*
VAT into a separate account or remit it. For a tiny market that invoices and
self-reports, that's typically what's wanted.

### Option B — collect VAT/a fee on-chain (contract change)

If you need a cut actually withheld on-chain (a platform fee, or VAT routed to a
separate wallet for remittance), you need to change `Marketplace.sol`.

**The mainline removed exactly this surface on purpose** (commit
`2e8f984`, "Remove platform fee"). So the single simplest way to get a working,
tested fee mechanism back is to **revert that commit in your fork**:

```sh
git revert 2e8f984      # restores feeBps + setFeeBps + withdrawFees + the
                        # split in _release + events + the full fee test suite
```

That gives you an owner-set basis-points fee (capped at 10%), per-token
fee accounting (`accruedFees`), and an owner `withdrawFees(token, to)` — all
already covered by tests. Then rename/repurpose it as "VAT" and point the
withdrawal at your tax-remittance wallet.

If you'd rather hand-roll the minimal change instead of reverting, the seam is
one function — `_release` in `contracts/src/Marketplace.sol`:

```solidity
// mainline (no fee): seller gets 100%
function _release(uint256 orderId, Order storage o) internal {
    o.state = OrderState.Completed;
    uint256 payout = o.amount;
    IERC20(o.token).safeTransfer(o.seller, payout);
    emit OrderCompleted(orderId, payout);
}

// fork (withhold a fee/VAT): add `uint16 public feeBps;` + an owner setter,
// `mapping(address => uint256) public accruedFees;`, and a withdraw path.
function _release(uint256 orderId, Order storage o) internal {
    o.state = OrderState.Completed;
    uint256 fee = (o.amount * feeBps) / 10_000;   // your VAT/fee rate
    uint256 payout = o.amount - fee;
    accruedFees[o.token] += fee;                  // held for remittance
    IERC20(o.token).safeTransfer(o.seller, payout);
    emit OrderCompleted(orderId, payout /*, fee */);
}
```

> **Caveat — a flat on-chain % is NOT full VAT compliance.** Real VAT is
> rate-by-jurisdiction and rate-by-good, and must be remitted to a tax
> authority. The contract can't see the buyer's country (the address is
> ECIES-encrypted off-chain; `CLAUDE.md` §5), so it can only withhold a flat
> rate. Treat on-chain withholding as a *collection* mechanism that still needs
> off-chain accounting and filing. Re-introducing a withdrawable balance also
> re-introduces operator custody of funds — reconsider the legal posture in
> `CLAUDE.md` §4 ("No platform fee") before doing this.

---

## 2. Other compliance levers already in the repo

You may not need to write anything for these — they already exist:

- **Restricting where you ship** (`ShopProfile.shipping`) — worldwide / allowlist
  / blocklist + region presets, an advisory checkout gate. Built into both apps;
  see `CLAUDE.md` §7 "Shipping-region gate" and `packages/schema/src/regions.ts`.
- **Disputes / refunds** — you (the owner) are the arbiter via
  `resolveDispute(orderId, refundBuyer)`. An un-shippable or non-compliant order
  can be refunded.
- **Circuit breaker** — `pause()` halts new buys/listings (intake only; it can
  never trap escrowed funds).
- **Token allowlist** — `setTokenAccepted` controls which ERC-20s settle.

## 3. Prohibited goods

The mainline listing layer is permissionless and on-chain — `createListing`
writes a listing anyone can fund, and there is **no on-chain delete** (only
`pause()` on intake and the seller's own `updateListing(..., active=false)`). If
you need to keep certain goods off your market (e.g. regulated items like
medicines), that enforcement lives in **your storefront/CMS**, not the contract:
a seller/listing blocklist your front-ends honor, plus your arbiter role to
refund anything that slips through. This is the main open gap for a
"compliant" fork — design it before you go live.

---

## 4. File map — where to change what

| Want to add… | Touch |
|---|---|
| Your own market (no code change) | `contracts/script/Deploy.s.sol`, app `.env`, [`docs/DEPLOY.md`](DEPLOY.md) |
| VAT on the receipt (off-chain) | `packages/schema/src/{index,pricing,schemas}.ts`, `apps/cms`, `apps/storefront` |
| VAT/fee withheld on-chain | `contracts/src/Marketplace.sol` (`_release` + fee state) — or `git revert 2e8f984` |
| Seller VAT ID / business info | `ShopProfile` in `packages/schema/src/index.ts` + the CMS shop form |
| Ship-to restrictions | already built — `ShopProfile.shipping` (`packages/schema/src/regions.ts`) |
| Prohibited-goods filtering | your `apps/storefront` + `apps/cms` (no contract support — see §3) |

---

Keep the core simple; fork for the rest. If you add something broadly useful and
non-mandatory, consider contributing it back as an *optional, off-by-default*
feature so the fruit-and-potatoes default stays friction-free.
