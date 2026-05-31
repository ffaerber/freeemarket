/**
 * Unit tests for the pure helpers in deploy-frontend.mjs.
 *
 * These cover the load-bearing, no-I/O pieces: the EIP-1577 Swarm contenthash
 * encoder (the value that ends up on mainnet ENS) and its round-trip. No Bee
 * node, no chain, no secrets needed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  encodeSwarmContenthash,
  decodeSwarmContenthash,
  stripHex,
  ethLimoUrl,
} from './deploy-frontend.mjs';

// A known 32-byte Swarm reference (any 64-hex string works as a feed manifest).
const FEED_MANIFEST =
  'd1f25a870a7bb7d6d4fd91c0b0a0d4d98b5c6e2f3a4b5c6d7e8f9a0b1c2d3e4f';

// Known-vector: EIP-1577 swarm contenthash = multicodec prefix `e40101fa011b20`
// (swarm-ns + swarm-manifest CIDv1 + keccak-256/32) followed by the 32-byte ref.
const EXPECTED_CONTENTHASH = '0xe40101fa011b20' + FEED_MANIFEST;

test('encodeSwarmContenthash produces the EIP-1577 swarm contenthash (known vector)', () => {
  const ch = encodeSwarmContenthash(FEED_MANIFEST);
  assert.equal(ch, EXPECTED_CONTENTHASH);
  assert.ok(ch.startsWith('0x'), 'contenthash must be 0x-prefixed');
  assert.ok(ch.startsWith('0xe40101fa011b20'), 'must carry the swarm multicodec prefix');
});

test('encodeSwarmContenthash accepts a 0x-prefixed reference', () => {
  assert.equal(encodeSwarmContenthash('0x' + FEED_MANIFEST), EXPECTED_CONTENTHASH);
});

test('encode → decode round-trips back to the feed manifest', () => {
  const ch = encodeSwarmContenthash(FEED_MANIFEST);
  assert.equal(decodeSwarmContenthash(ch), FEED_MANIFEST);
});

test('encodeSwarmContenthash rejects a non-32-byte reference', () => {
  assert.throws(() => encodeSwarmContenthash('deadbeef'), /32-byte hex/);
  assert.throws(() => encodeSwarmContenthash('zz'.repeat(32)), /32-byte hex/);
});

test('stripHex strips a leading 0x (and is a no-op otherwise)', () => {
  assert.equal(stripHex('0xABCD'), 'ABCD');
  assert.equal(stripHex('ABCD'), 'ABCD');
});

test('ethLimoUrl builds the gateway URL and trims a trailing dot', () => {
  assert.equal(ethLimoUrl('shop.eth'), 'https://shop.eth.limo');
  assert.equal(ethLimoUrl('shop.eth.'), 'https://shop.eth.limo');
});
