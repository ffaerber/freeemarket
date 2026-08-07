/**
 * BeeTransport regression tests.
 *
 * These do NOT need a Bee node: they assert on the argument validation bee-js
 * performs BEFORE it opens a socket. The bug they guard against is a PSS target
 * prefix that bee-js rejects outright — which made every live send throw
 * `TypeError: AddressPrefix not valid hex string` before any request, while the
 * InMemoryTransport-based suites stayed green.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import {
  BeeTransport,
  DEFAULT_PSS_TARGET,
  sealEnvelope,
  topicForOrder,
  type Envelope,
  type SignDigest,
} from '../src/index.js';

/** A node URL nothing is listening on, so we fail at connect, not at validation. */
const DEAD_NODE = 'http://127.0.0.1:1';

function signerFor(pk: Hex): { address: Address; sign: SignDigest } {
  const account = privateKeyToAccount(pk);
  return {
    address: account.address,
    sign: (digestHex: Hex) => account.signMessage({ message: { raw: digestHex } }),
  };
}

async function anEnvelope(): Promise<{ envelope: Envelope; to: Address }> {
  const buyer = signerFor(generatePrivateKey());
  const seller = signerFor(generatePrivateKey());
  const envelope = await sealEnvelope(
    {
      kind: 'shipping-address',
      orderId: '1',
      from: buyer.address,
      to: seller.address,
      ciphertext: '0xab',
    },
    buyer.sign,
  );
  return { envelope, to: seller.address };
}

test('DEFAULT_PSS_TARGET is a target Bee actually accepts', () => {
  // Non-empty (bee-js's isHexString regex requires >= 1 char), pure hex,
  // even-length (Bee hex-decodes it server-side), and within the 6-char cap.
  assert.ok(DEFAULT_PSS_TARGET.length > 0, 'must not be empty');
  assert.ok(/^[0-9a-f]+$/i.test(DEFAULT_PSS_TARGET), 'must be pure hex');
  assert.equal(DEFAULT_PSS_TARGET.length % 2, 0, 'must be whole bytes');
  assert.ok(DEFAULT_PSS_TARGET.length <= 6, 'must be within PSS_TARGET_HEX_LENGTH_MAX');
});

test('send() reaches the network instead of failing argument validation', async () => {
  const { envelope, to } = await anEnvelope();
  const transport = new BeeTransport({
    beeUrl: DEAD_NODE,
    postageBatchId: 'f'.repeat(64),
  });

  await assert.rejects(
    () => transport.send(topicForOrder('1', 'buyer-to-seller'), to, envelope),
    (err: Error) => {
      // The regression: bee-js rejecting the target prefix before any request.
      assert.doesNotMatch(
        err.message,
        /AddressPrefix/i,
        `send() failed argument validation, not the network: ${err.message}`,
      );
      return true;
    },
  );
});

test('an explicit recipient overlay is trimmed to a target Bee accepts', async () => {
  const { envelope, to } = await anEnvelope();
  const transport = new BeeTransport({
    beeUrl: DEAD_NODE,
    postageBatchId: 'f'.repeat(64),
    // A full 32-byte overlay: far longer than the 6-hex cap, so it must be
    // trimmed rather than passed through (which bee-js would reject).
    targetOverlay: `0x${'ab'.repeat(32)}`,
  });

  await assert.rejects(
    () => transport.send(topicForOrder('1', 'buyer-to-seller'), to, envelope),
    (err: Error) => {
      assert.doesNotMatch(err.message, /AddressPrefix/i, err.message);
      return true;
    },
  );
});

test('receive() with nothing buffered resolves empty rather than throwing', async () => {
  const transport = new BeeTransport({
    beeUrl: DEAD_NODE,
    postageBatchId: 'f'.repeat(64),
  });
  const seller = signerFor(generatePrivateKey());
  const got = await transport.receive(topicForOrder('1', 'buyer-to-seller'), {
    recipient: seller.address,
  });
  assert.deepEqual(got, []);
});
