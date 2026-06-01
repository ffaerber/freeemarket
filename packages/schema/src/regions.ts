/**
 * Shipping-region policy logic — shared by the CMS (seller sets it) and the
 * storefront (shows it + gates checkout).
 *
 * IMPORTANT (CLAUDE.md §5): this is an ADVISORY policy, NOT enforced on-chain.
 * The buyer's address — including their country — is ECIES-encrypted and sent
 * OFF-CHAIN over Swarm PSS. The Marketplace contract never sees a country and a
 * buyer could lie, so the country cannot be enforced in escrow. The storefront
 * uses this to SHOW the policy and DISABLE checkout for excluded countries; the
 * existing dispute/refund path is the backstop if someone funds escrow anyway.
 *
 * Dependency-free on purpose: the region presets are hand-coded ISO 3166-1
 * alpha-2 country lists (no npm dep), so both apps import the SAME logic here.
 */

import type { ShippingPolicy } from './index.js';

/** EU member states (27) — ISO 3166-1 alpha-2, uppercase. */
const EU = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE',
];

/** EEA = EU + Iceland, Liechtenstein, Norway. */
const EEA = [...EU, 'IS', 'LI', 'NO'];

/**
 * Named region presets that EXPAND into individual country codes. Referenced by
 * `ShippingPolicy.regions`; both the CMS (preset checkboxes) and storefront
 * (gate) resolve through this single map so the lists never diverge.
 */
export const REGION_PRESETS: Record<string, string[]> = {
  EU,
  EEA,
  US: ['US'],
  NA: ['US', 'CA', 'MX'],
};

/** Human labels for the region presets (for UI). */
export const REGION_LABELS: Record<string, string> = {
  EU: 'European Union',
  EEA: 'European Economic Area',
  US: 'United States',
  NA: 'North America',
};

/**
 * Resolve a policy into its effective country set.
 *
 * @returns `{ mode, allowed }` where `allowed` is the union of explicit
 *   `countries` and every `regions` preset's expansion (uppercased), or `null`
 *   for `worldwide` (where the set is irrelevant — everything ships).
 */
export function resolveShippingCountries(
  policy?: ShippingPolicy | null,
): { mode: 'worldwide' | 'allowlist' | 'blocklist'; allowed: Set<string> | null } {
  // Absent/invalid policy ⇒ treat as worldwide (backward compatible: shops with
  // no policy ship everywhere).
  if (!policy || policy.mode === 'worldwide') {
    return { mode: 'worldwide', allowed: null };
  }
  const allowed = new Set<string>();
  for (const c of policy.countries ?? []) {
    if (typeof c === 'string' && c.trim()) allowed.add(c.trim().toUpperCase());
  }
  for (const r of policy.regions ?? []) {
    const expanded = REGION_PRESETS[r];
    if (expanded) for (const c of expanded) allowed.add(c);
  }
  return { mode: policy.mode, allowed };
}

/**
 * Can the shop ship to `countryCode` (ISO 3166-1 alpha-2)? Mode semantics:
 *   - worldwide → always true (countries/regions ignored).
 *   - allowlist → true ONLY if the country is in (countries ∪ expanded regions).
 *   - blocklist → true EXCEPT when the country is in that set.
 *
 * A missing/empty `countryCode` returns `false` for allow/block modes (we can't
 * confirm eligibility) but `true` for worldwide. Comparison is case-insensitive.
 */
export function canShipTo(
  policy: ShippingPolicy | null | undefined,
  countryCode: string | null | undefined,
): boolean {
  const { mode, allowed } = resolveShippingCountries(policy);
  if (mode === 'worldwide') return true;
  const code = (countryCode || '').trim().toUpperCase();
  if (!code) return false;
  const inSet = allowed!.has(code);
  return mode === 'allowlist' ? inSet : !inSet;
}

/**
 * Summarize a policy into short human text for a "Ships to: …" badge, e.g.
 * "Worldwide", "EU & US", "Worldwide except RU, BY". Pure + shared so the
 * storefront badge and any other client render identical copy.
 */
export function describeShippingPolicy(
  policy?: ShippingPolicy | null,
): string {
  if (!policy || policy.mode === 'worldwide') return 'Worldwide';

  // Prefer named regions in the human summary, then list explicit countries.
  const regionNames = (policy.regions ?? [])
    .filter((r) => REGION_PRESETS[r])
    .map((r) => r);
  const countries = (policy.countries ?? [])
    .map((c) => (c || '').trim().toUpperCase())
    .filter(Boolean);
  const parts = [...regionNames, ...countries];

  if (policy.mode === 'allowlist') {
    if (parts.length === 0) return 'Not currently shipping';
    return parts.join(' & ');
  }
  // blocklist
  if (parts.length === 0) return 'Worldwide';
  return `Worldwide except ${parts.join(', ')}`;
}
