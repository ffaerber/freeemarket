/**
 * ECIES crypto round-trip tests. Run with `npm test` (node:test via tsx).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateKeyPair,
  publicKeyFromPrivate,
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
} from '../src/crypto.js';

test('generateKeyPair returns hex private + public keys', () => {
  const { privateKey, publicKey } = generateKeyPair();
  assert.match(privateKey, /^0x[0-9a-f]{64}$/);
  assert.match(publicKey, /^0x[0-9a-f]{130}$/); // uncompressed 65-byte pubkey
  assert.equal(publicKeyFromPrivate(privateKey), publicKey);
});

test('ECIES encrypt → decrypt round-trips raw bytes', () => {
  const { privateKey, publicKey } = generateKeyPair();
  const msg = new TextEncoder().encode('ship to 1 Main St');
  const ct = encrypt(publicKey, msg);
  assert.notDeepEqual(ct, msg);
  assert.deepEqual(decrypt(privateKey, ct), msg);
});

test('encryptJson → decryptJson round-trips an object', () => {
  const { privateKey, publicKey } = generateKeyPair();
  const value = { orderId: '7', name: 'Ada', address: '1 Main St' };
  const ct = encryptJson(publicKey, value);
  assert.deepEqual(decryptJson(privateKey, ct), value);
});

test('decrypt with the WRONG key fails', () => {
  const a = generateKeyPair();
  const b = generateKeyPair();
  const ct = encrypt(a.publicKey, new TextEncoder().encode('secret'));
  assert.throws(() => decrypt(b.privateKey, ct));
});
