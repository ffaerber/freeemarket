/**
 * Pricing-breakdown helpers (shared by CMS + storefront).
 *
 * The listing's ON-CHAIN `price` is the single amount actually escrowed and paid
 * via `buy()` — it ALREADY INCLUDES shipping. The optional `ListingMetadata.
 * pricing` ({ item, shipping }) is a DISPLAY-ONLY breakdown of that total. This
 * module reconciles the breakdown against the authoritative on-chain price so
 * the storefront can itemize "item + shipping = total" without ever showing a
 * misleading number.
 *
 * IMPORTANT — DISPLAY ONLY, NOT FINANCIAL SETTLEMENT. The math here uses simple
 * fixed-point string arithmetic for rendering. The authoritative amount the
 * buyer pays is always the on-chain `price` (a smallest-unit integer); never
 * settle anything from these helpers.
 *
 * FLAT shipping: shipping is one figure per listing/variant, NOT per-region. The
 * contract never sees the destination country (it's inside the off-chain
 * encrypted address; CLAUDE.md §5), so a per-region shipping fee cannot be
 * charged on-chain.
 */
import type { PricingBreakdown } from './index.js';

/** Internal: parse a decimal string into a {neg, int, frac-padded} or null. */
function parseDecimal(s: string): { neg: boolean; digits: bigint; scale: number } | null {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  const m = /^(-?)([0-9]+)(?:\.([0-9]+))?$/.exec(t);
  if (!m) return null;
  const neg = m[1] === '-';
  const intPart = m[2];
  const fracPart = m[3] ?? '';
  const scale = fracPart.length;
  const digits = BigInt(intPart + fracPart || '0');
  return { neg, digits, scale };
}

/** Internal: subtract b from a (both decimal strings), clamped at >= 0, as a
 * decimal string with the larger of the two scales. Returns null on bad input. */
function subClampZero(a: string, b: string): string | null {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  if (!pa || !pb) return null;
  const scale = Math.max(pa.scale, pb.scale);
  const av = pa.digits * 10n ** BigInt(scale - pa.scale) * (pa.neg ? -1n : 1n);
  const bv = pb.digits * 10n ** BigInt(scale - pb.scale) * (pb.neg ? -1n : 1n);
  let diff = av - bv;
  if (diff < 0n) diff = 0n; // clamp negatives (display-only; never negative ship)
  return formatScaled(diff, scale);
}

/** Internal: render a non-negative scaled bigint back to a decimal string. */
function formatScaled(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();
  const s = value.toString().padStart(scale + 1, '0');
  const int = s.slice(0, s.length - scale);
  const frac = s.slice(s.length - scale).replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

export interface NormalizedPricing {
  /** Base item cost as a decimal string in token units. */
  item: string;
  /** Shipping cost (included in the on-chain price) as a decimal string. */
  shipping: string;
  /** True when a non-zero shipping figure was derived (worth itemizing). */
  hasShipping: boolean;
}

/**
 * Reconcile a `pricing` breakdown against the authoritative on-chain price.
 *
 * The on-chain `priceFormatted` (a decimal string in the token's units) is ALWAYS
 * authoritative — it's the real escrowed total. The returned `{ item, shipping }`
 * always sums (for display) to that price, so we never render a total the buyer
 * isn't actually paying. Resolution order (item is the anchor leg):
 *
 *   - `pricing.item` present ⇒ keep item; shipping = price − item (clamped ≥ 0).
 *       This holds EVEN IF `pricing.shipping` is also present but disagrees: we
 *       TRUST the on-chain price and re-derive shipping = price − item, so a stale
 *       or wrong breakdown can never show a shipping figure that doesn't reconcile.
 *   - else `pricing.shipping` present ⇒ keep shipping; item = price − shipping.
 *   - else (no/empty pricing) ⇒ item = price, shipping = "0", hasShipping=false.
 *
 * DISPLAY ONLY — never settle anything from this.
 *
 * @param pricing the optional metadata breakdown ({ item?, shipping? })
 * @param priceFormatted the authoritative on-chain price as a decimal string
 */
export function shippingFromPricing(
  pricing: PricingBreakdown | undefined | null,
  priceFormatted: string,
): NormalizedPricing {
  const price = typeof priceFormatted === 'string' ? priceFormatted.trim() : '';
  // Fallback when the on-chain price isn't a clean decimal we can do math on.
  const priceOk = parseDecimal(price) != null;
  if (!priceOk) {
    return { item: price || '0', shipping: '0', hasShipping: false };
  }

  const ship = pricing?.shipping;
  const itm = pricing?.item;

  if (itm != null && parseDecimal(itm)) {
    // Item is the anchor: shipping is whatever's left of the on-chain price.
    // If `ship` is also present but item + ship ≠ price, we IGNORE `ship` and
    // re-derive it from the authoritative price — never show a non-reconciling sum.
    const shipping = subClampZero(price, itm) ?? '0';
    const hasShipping = parseDecimal(shipping)!.digits !== 0n;
    return { item: itm, shipping, hasShipping };
  }

  if (ship != null && parseDecimal(ship)) {
    // Only shipping given: item = price − shipping (trust the on-chain total).
    const item = subClampZero(price, ship) ?? price;
    const hasShipping = parseDecimal(ship)!.digits !== 0n;
    return { item, shipping: ship, hasShipping };
  }

  // No usable breakdown ⇒ the whole price is the item, no shipping line.
  return { item: price, shipping: '0', hasShipping: false };
}
