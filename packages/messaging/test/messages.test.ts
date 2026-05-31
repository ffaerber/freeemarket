/**
 * Message-payload validator tests.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isShippingAddress,
  assertShippingAddress,
  isShipmentUpdate,
  assertShipmentUpdate,
  MessageValidationError,
} from '../src/messages.js';

test('isShippingAddress accepts a complete address', () => {
  assert.equal(
    isShippingAddress({ orderId: '1', name: 'Ada', address: '1 Main St' }),
    true,
  );
});

test('isShippingAddress rejects missing/empty fields', () => {
  assert.equal(isShippingAddress({ orderId: '1', name: 'Ada' }), false);
  assert.equal(isShippingAddress({ orderId: '', name: 'Ada', address: 'x' }), false);
  assert.equal(isShippingAddress(null), false);
});

test('assertShippingAddress throws on bad input', () => {
  assert.throws(() => assertShippingAddress({}), MessageValidationError);
});

test('isShipmentUpdate accepts a tracking code', () => {
  assert.equal(
    isShipmentUpdate({ orderId: '1', carrier: 'DHL', trackingCode: 'JD123' }),
    true,
  );
});

test('isShipmentUpdate accepts a note-only update', () => {
  assert.equal(isShipmentUpdate({ orderId: '1', note: 'handed to courier' }), true);
});

test('isShipmentUpdate rejects an update with nothing actionable', () => {
  assert.equal(isShipmentUpdate({ orderId: '1' }), false);
});

test('isShipmentUpdate rejects non-string fields', () => {
  assert.equal(isShipmentUpdate({ orderId: '1', trackingCode: 123 }), false);
});

test('assertShipmentUpdate throws on bad input', () => {
  assert.throws(() => assertShipmentUpdate({ orderId: '1' }), MessageValidationError);
});
