/**
 * Tests for the schema validators. Run with `npm test` (node:test via tsx).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertListingMetadata,
  assertShopProfile,
  canShipTo,
  describeShippingPolicy,
  isListingMetadata,
  isShopProfile,
  REGION_PRESETS,
  resolveShippingCountries,
  SchemaValidationError,
  shippingFromPricing,
  type ListingMetadata,
  type ShopProfile,
} from '../src/index.js';

const validTheme: ShopProfile['theme'] = {
  bg: '#fff',
  surface: '#f4f4f4',
  text: '#111',
  muted: '#888',
  accent: '#e63946',
  accent2: '#457b9d',
  border: '#ddd',
  radius: '12px',
  display: 'Georgia, serif',
  body: 'Inter, sans-serif',
};

const validShop: ShopProfile = {
  version: 1,
  name: 'Fruit Stand',
  ens: 'fruit.eth',
  tagline: 'Fresh daily',
  theme: validTheme,
};

const validListing: ListingMetadata = {
  version: 1,
  title: 'Strawberry jam',
  variant: '100 g jar',
  description: 'Sweet and local.',
  images: ['ref1', 'ref2'],
  category: 'preserves',
  attributes: { weight: '100g' },
};

test('isShopProfile accepts a valid profile', () => {
  assert.equal(isShopProfile(validShop), true);
});

test('isShopProfile rejects missing name', () => {
  const { name, ...rest } = validShop;
  assert.equal(isShopProfile(rest), false);
});

test('isShopProfile accepts a profile WITHOUT a theme (storefront is static)', () => {
  const { theme, ...themeless } = validShop;
  assert.equal(isShopProfile(themeless), true);
});

test('isShopProfile rejects wrong version', () => {
  assert.equal(isShopProfile({ ...validShop, version: 2 }), false);
});

test('isShopProfile rejects incomplete theme', () => {
  const { accent, ...partialTheme } = validTheme;
  assert.equal(isShopProfile({ ...validShop, theme: partialTheme }), false);
});

test('isShopProfile rejects unknown top-level keys', () => {
  assert.equal(isShopProfile({ ...validShop, evil: true }), false);
});

test('isListingMetadata accepts a valid listing', () => {
  assert.equal(isListingMetadata(validListing), true);
});

test('isListingMetadata accepts minimal listing', () => {
  assert.equal(
    isListingMetadata({ version: 1, title: 'X', images: [] }),
    true,
  );
});

test('isListingMetadata rejects missing images', () => {
  const { images, ...rest } = validListing;
  assert.equal(isListingMetadata(rest), false);
});

test('isListingMetadata rejects non-string image refs', () => {
  assert.equal(
    isListingMetadata({ ...validListing, images: [1, 2] }),
    false,
  );
});

test('isListingMetadata rejects a price field (price is on-chain)', () => {
  assert.equal(isListingMetadata({ ...validListing, price: 1000000 }), false);
});

test('assertShopProfile returns the value when valid', () => {
  assert.equal(assertShopProfile(validShop), validShop);
});

test('assertShopProfile throws SchemaValidationError when invalid', () => {
  assert.throws(
    () => assertShopProfile({ version: 1 }),
    (err: unknown) => err instanceof SchemaValidationError && err.errors.length > 0,
  );
});

test('assertListingMetadata throws on invalid input', () => {
  assert.throws(() => assertListingMetadata({}), SchemaValidationError);
});

// --- payment hint (multi-token) ---

test('isListingMetadata accepts a full payment hint', () => {
  assert.equal(
    isListingMetadata({
      ...validListing,
      payment: {
        token: '0xddafbb505ad214d7b80b1f830fccc89b60fb7a83',
        symbol: 'USDC',
        decimals: 6,
      },
    }),
    true,
  );
});

test('isListingMetadata accepts a payment hint with only the token', () => {
  assert.equal(
    isListingMetadata({
      ...validListing,
      payment: { token: '0x0000000000000000000000000000000000000001' },
    }),
    true,
  );
});

test('isListingMetadata rejects a payment hint missing the token', () => {
  assert.equal(
    isListingMetadata({ ...validListing, payment: { symbol: 'USDC' } }),
    false,
  );
});

test('isListingMetadata rejects non-numeric payment decimals', () => {
  assert.equal(
    isListingMetadata({
      ...validListing,
      payment: { token: '0xabc', decimals: 'six' },
    }),
    false,
  );
});

test('isListingMetadata rejects unknown keys in the payment hint', () => {
  assert.equal(
    isListingMetadata({
      ...validListing,
      payment: { token: '0xabc', chainId: 100 },
    }),
    false,
  );
});

// --- pricing breakdown (display-only split of the on-chain price) ---

test('isListingMetadata accepts a listing with a pricing breakdown', () => {
  assert.equal(
    isListingMetadata({
      ...validListing,
      pricing: { item: '10.00', shipping: '3.00' },
    }),
    true,
  );
});

test('isListingMetadata accepts a pricing breakdown with only item', () => {
  assert.equal(
    isListingMetadata({ ...validListing, pricing: { item: '10' } }),
    true,
  );
});

test('isListingMetadata: omitting pricing still validates (backward compat)', () => {
  // validListing has no pricing field at all.
  assert.equal(isListingMetadata(validListing), true);
  assert.equal(isListingMetadata({ version: 1, title: 'X', images: [] }), true);
});

test('isListingMetadata rejects a non-numeric shipping string', () => {
  assert.equal(
    isListingMetadata({ ...validListing, pricing: { shipping: 'free' } }),
    false,
  );
});

test('isListingMetadata rejects unknown keys in the pricing breakdown', () => {
  assert.equal(
    isListingMetadata({
      ...validListing,
      pricing: { item: '10', region: 'EU' },
    }),
    false,
  );
});

test('shippingFromPricing: item + shipping reconcile to the on-chain price', () => {
  const r = shippingFromPricing({ item: '10', shipping: '3' }, '13');
  assert.equal(r.item, '10');
  assert.equal(r.shipping, '3');
  assert.equal(r.hasShipping, true);
});

test('shippingFromPricing: only item ⇒ shipping derived from the price', () => {
  const r = shippingFromPricing({ item: '10' }, '13');
  assert.equal(r.item, '10');
  assert.equal(r.shipping, '3');
  assert.equal(r.hasShipping, true);
});

test('shippingFromPricing: no breakdown ⇒ whole price is the item, no shipping', () => {
  const r = shippingFromPricing({}, '13');
  assert.equal(r.item, '13');
  assert.equal(r.shipping, '0');
  assert.equal(r.hasShipping, false);
});

test('shippingFromPricing: mismatch trusts the on-chain price (item anchors)', () => {
  // item + shipping = 15 ≠ 13; trust on-chain, re-derive shipping = 13 − 10 = 3.
  const r = shippingFromPricing({ item: '10', shipping: '5' }, '13');
  assert.equal(r.item, '10');
  assert.equal(r.shipping, '3');
  assert.equal(r.hasShipping, true);
});

test('shippingFromPricing: only shipping ⇒ item derived from the price', () => {
  const r = shippingFromPricing({ shipping: '3' }, '13');
  assert.equal(r.item, '10');
  assert.equal(r.shipping, '3');
  assert.equal(r.hasShipping, true);
});

// --- product variant grouping (off-chain) ---

test('isListingMetadata accepts productId + variantLabel + variantOf', () => {
  assert.equal(
    isListingMetadata({
      ...validListing,
      productId: 'sunny-strawberries',
      variantLabel: '100 g jar',
      variantOf: 'Strawberries',
    }),
    true,
  );
});

test('isListingMetadata: grouping fields are optional (omitting still validates)', () => {
  const { productId, variantLabel, variantOf, ...rest } = {
    ...validListing,
    productId: 'p',
    variantLabel: 'v',
    variantOf: 'o',
  } as ListingMetadata & { productId?: string; variantLabel?: string; variantOf?: string };
  assert.equal(isListingMetadata(rest), true);
  // and a minimal listing without any grouping fields is still valid
  assert.equal(isListingMetadata({ version: 1, title: 'X', images: [] }), true);
});

test('isListingMetadata rejects a non-string productId', () => {
  assert.equal(isListingMetadata({ ...validListing, productId: 42 }), false);
});

// --- shipping-region policy (off-chain, advisory) ---

test('isShopProfile accepts a valid shipping policy', () => {
  assert.equal(
    isShopProfile({
      ...validShop,
      shipping: {
        mode: 'allowlist',
        regions: ['EU'],
        countries: ['US'],
        note: 'Ships within 3 days',
      },
    }),
    true,
  );
});

test('isShopProfile: omitting shipping still validates (backward compat)', () => {
  assert.equal(isShopProfile(validShop), true);
  // explicit absence is also fine
  const { ens, ...minimal } = validShop;
  assert.equal(isShopProfile(minimal), true);
});

test('isShopProfile rejects a shipping policy missing mode', () => {
  assert.equal(
    isShopProfile({ ...validShop, shipping: { countries: ['US'] } }),
    false,
  );
});

test('isShopProfile rejects a bad shipping mode', () => {
  assert.equal(
    isShopProfile({ ...validShop, shipping: { mode: 'only-eu' } }),
    false,
  );
});

test('isShopProfile rejects lowercase country codes', () => {
  assert.equal(
    isShopProfile({ ...validShop, shipping: { mode: 'allowlist', countries: ['de'] } }),
    false,
  );
});

test('isShopProfile rejects 3-letter country codes', () => {
  assert.equal(
    isShopProfile({ ...validShop, shipping: { mode: 'blocklist', countries: ['USA'] } }),
    false,
  );
});

test('isShopProfile rejects unknown keys in the shipping policy', () => {
  assert.equal(
    isShopProfile({ ...validShop, shipping: { mode: 'worldwide', evil: true } }),
    false,
  );
});

// --- region resolver / canShipTo logic ---

test('canShipTo: worldwide allows anything (incl. empty country)', () => {
  const p = { mode: 'worldwide' as const };
  assert.equal(canShipTo(p, 'US'), true);
  assert.equal(canShipTo(p, 'DE'), true);
  assert.equal(canShipTo(p, ''), true);
  // No policy at all ⇒ worldwide.
  assert.equal(canShipTo(undefined, 'US'), true);
});

test('canShipTo: allowlist EU allows DE, rejects US', () => {
  const p = { mode: 'allowlist' as const, regions: ['EU'] };
  assert.equal(canShipTo(p, 'DE'), true);
  assert.equal(canShipTo(p, 'US'), false);
});

test('canShipTo: blocklist [US] rejects US, allows DE', () => {
  const p = { mode: 'blocklist' as const, countries: ['US'] };
  assert.equal(canShipTo(p, 'US'), false);
  assert.equal(canShipTo(p, 'DE'), true);
});

test('canShipTo: regions expand (EU includes FR; case-insensitive country)', () => {
  const p = { mode: 'allowlist' as const, regions: ['EU'] };
  assert.equal(canShipTo(p, 'FR'), true);
  assert.equal(canShipTo(p, 'fr'), true);
  assert.ok(REGION_PRESETS.EU.includes('FR'));
});

test('resolveShippingCountries unions countries + region expansions', () => {
  const { mode, allowed } = resolveShippingCountries({
    mode: 'allowlist',
    regions: ['US'],
    countries: ['JP'],
  });
  assert.equal(mode, 'allowlist');
  assert.equal(allowed?.has('US'), true);
  assert.equal(allowed?.has('JP'), true);
  assert.equal(allowed?.has('DE'), false);
});

test('describeShippingPolicy summarizes into human text', () => {
  assert.equal(describeShippingPolicy(undefined), 'Worldwide');
  assert.equal(describeShippingPolicy({ mode: 'worldwide' }), 'Worldwide');
  assert.equal(
    describeShippingPolicy({ mode: 'allowlist', regions: ['EU'], countries: ['US'] }),
    'EU & US',
  );
  assert.equal(
    describeShippingPolicy({ mode: 'blocklist', countries: ['RU', 'BY'] }),
    'Worldwide except RU, BY',
  );
});
