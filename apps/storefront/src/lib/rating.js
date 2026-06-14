/**
 * Pure helpers for the on-chain star ratings (CLAUDE.md §reviews).
 *
 * The contract stores per-seller aggregate tallies (`sellerRatings(seller)` →
 * count, qualitySum, deliverySum) so a storefront can show averages with one
 * read. These helpers turn the raw bigint tuple into rounded display numbers —
 * no on-chain math, no event scan.
 */

/** Round a number to one decimal place (e.g. 4.0, 4.3). */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Summarize a seller's aggregate rating tuple into display numbers.
 *
 * @param {readonly [bigint|number, bigint|number, bigint|number] | undefined} raw
 *        `sellerRatings(seller)` → [count, qualitySum, deliverySum].
 * @returns {{ count: number, avgQuality: number, avgDelivery: number, avgOverall: number }}
 *          Averages are 0 when there are no ratings (guard on `count > 0`).
 */
export function summarizeSellerRating(raw) {
  const count = raw ? Number(raw[0]) : 0;
  if (!count) return { count: 0, avgQuality: 0, avgDelivery: 0, avgOverall: 0 };
  const qualitySum = Number(raw[1]);
  const deliverySum = Number(raw[2]);
  const avgQuality = round1(qualitySum / count);
  const avgDelivery = round1(deliverySum / count);
  const avgOverall = round1((qualitySum + deliverySum) / (count * 2));
  return { count, avgQuality, avgDelivery, avgOverall };
}

/**
 * Split a 0–5 score into whole + half + empty star counts for rendering.
 * Rounds to the nearest half star.
 *
 * @param {number} value 0–5
 * @returns {{ full: number, half: number, empty: number }}
 */
export function starParts(value) {
  const clamped = Math.max(0, Math.min(5, Number(value) || 0));
  const halves = Math.round(clamped * 2); // 0..10 half-steps
  const full = Math.floor(halves / 2);
  const half = halves % 2;
  return { full, half, empty: 5 - full - half };
}
