/**
 * Tests for the schema validators. Run with `npm test` (node:test via tsx).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertListingMetadata,
  assertShopProfile,
  isListingMetadata,
  isShopProfile,
  SchemaValidationError,
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
