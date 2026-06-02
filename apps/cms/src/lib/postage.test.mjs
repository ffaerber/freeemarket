/**
 * Unit tests for the PURE helpers in postage.js (docs/POSTAGE.md).
 *
 * Run: node --test apps/cms/src/lib/postage.test.mjs
 *
 * Only the pure helpers are covered — the Bee wrappers (list/get/create/top-up/
 * dilute/ensure) need a live writeable Bee node and aren't exercised in CI, same
 * posture as packages/messaging's BeeTransport.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BATCH_PRESETS,
  formatDuration,
  classifyHealth,
  normalizeBatch,
  findUsableByLabel,
} from './postage.js';

test('presets: storage is durable+mutable+larger, messaging is ephemeral+smaller', () => {
  const { storage, messaging } = BATCH_PRESETS;
  // Both mutable so they can be topped up / reused.
  assert.equal(storage.immutable, false);
  assert.equal(messaging.immutable, false);
  // Storage outlives + outsizes messaging.
  assert.ok(storage.depth > messaging.depth, 'storage depth > messaging depth');
  assert.ok(BigInt(storage.amount) > BigInt(messaging.amount), 'storage amount > messaging');
  // Messaging respects Bee's minimum usable depth (17).
  assert.ok(messaging.depth >= 17, 'messaging depth >= 17 (Bee minimum)');
  // Distinct labels so auto-create can tell them apart on one node.
  assert.notEqual(storage.label, messaging.label);
});

test('formatDuration: days/hours/minutes/seconds + edge cases', () => {
  assert.equal(formatDuration(-1), 'unlimited');
  assert.equal(formatDuration(0), 'expired');
  assert.equal(formatDuration(-50), 'expired');
  assert.equal(formatDuration(NaN), 'expired');
  assert.equal(formatDuration(45), '45s');
  assert.equal(formatDuration(120), '2m');
  assert.equal(formatDuration(3600), '1h');
  assert.equal(formatDuration(3660), '1h 1m');
  assert.equal(formatDuration(86400), '1d');
  assert.equal(formatDuration(90000), '1d 1h'); // 25h
  assert.equal(formatDuration(86400 * 3), '3d');
});

test('classifyHealth: thresholds + unlimited + expired', () => {
  assert.equal(classifyHealth(-1), 'ok'); // unlimited
  assert.equal(classifyHealth(0), 'expired');
  assert.equal(classifyHealth(-5), 'expired');
  assert.equal(classifyHealth(3600), 'critical'); // < 1d
  assert.equal(classifyHealth(86399), 'critical');
  assert.equal(classifyHealth(86400 * 3), 'warn'); // < 7d
  assert.equal(classifyHealth(604799), 'warn');
  assert.equal(classifyHealth(604800), 'ok'); // >= 7d
  assert.equal(classifyHealth(86400 * 30), 'ok');
  // Custom thresholds.
  assert.equal(classifyHealth(100, { criticalSeconds: 50 }), 'warn');
  assert.equal(classifyHealth(10, { criticalSeconds: 50 }), 'critical');
});

test('normalizeBatch: plain bee-js v7-ish shape', () => {
  const b = normalizeBatch({
    batchID: '1234abcd',
    depth: 20,
    bucketDepth: 16,
    amount: '500000000',
    immutableFlag: false,
    batchTTL: 604800,
    utilization: 8,
    usable: true,
    label: 'freemarket-storage',
    exists: true,
  });
  assert.equal(b.batchID, '1234abcd');
  assert.equal(b.depth, 20);
  assert.equal(b.amount, '500000000');
  assert.equal(b.immutable, false);
  assert.equal(b.ttlSeconds, 604800);
  assert.equal(b.usable, true);
  assert.equal(b.label, 'freemarket-storage');
  // usage derived: utilization 8 / 2^(20-16)=16 ⇒ 0.5
  assert.equal(b.usage, 0.5);
});

test('normalizeBatch: typed wrappers (toHex/toSeconds/usage field) + immutable alias', () => {
  const b = normalizeBatch({
    batchID: { toHex: () => 'deadbeef' },
    depth: 18,
    bucketDepth: 16,
    amount: { toPLURString: () => '999' },
    immutable: true,
    duration: { toSeconds: () => 123456 },
    usage: 0.25,
    usable: true,
    label: 'x',
  });
  assert.equal(b.batchID, 'deadbeef');
  assert.equal(b.amount, '999');
  assert.equal(b.immutable, true);
  assert.equal(b.ttlSeconds, 123456);
  assert.equal(b.usage, 0.25); // explicit field wins over derivation
});

test('normalizeBatch: usage clamps to [0,1] and bad input ⇒ null', () => {
  // utilization beyond capacity clamps to 1.
  const over = normalizeBatch({ depth: 17, bucketDepth: 16, utilization: 999 });
  assert.equal(over.usage, 1);
  assert.equal(normalizeBatch(null), null);
  assert.equal(normalizeBatch('nope'), null);
});

test('findUsableByLabel: matches usable+existing label only', () => {
  const batches = [
    normalizeBatch({ batchID: 'a', label: 'freemarket-storage', usable: false, exists: true }),
    normalizeBatch({ batchID: 'b', label: 'other', usable: true, exists: true }),
    normalizeBatch({ batchID: 'c', label: 'freemarket-storage', usable: true, exists: true }),
  ];
  assert.equal(findUsableByLabel(batches, 'freemarket-storage').batchID, 'c');
  assert.equal(findUsableByLabel(batches, 'missing'), null);
  assert.equal(findUsableByLabel([], 'x'), null);
});
