/**
 * Signed-envelope tests: seal/open recover the signer, and the security-critical
 * expectedFrom + tamper checks reject forgeries.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import type { Hex } from 'viem';
import {
  sealEnvelope,
  openEnvelope,
  verifyEnvelope,
  type SignDigest,
} from '../src/envelope.js';

/** Build a digest signer backed by a raw key (mirrors a viem account/wallet). */
function signerFor(pk: Hex): { address: `0x${string}`; sign: SignDigest } {
  const account = privateKeyToAccount(pk);
  return {
    address: account.address,
    sign: (digestHex: Hex) => account.signMessage({ message: { raw: digestHex } }),
  };
}

test('seal → open recovers the signer and matches expectedFrom', async () => {
  const buyer = signerFor(generatePrivateKey());
  const seller = signerFor(generatePrivateKey());
  const env = await sealEnvelope(
    {
      kind: 'shipping-address',
      orderId: '42',
      from: buyer.address,
      to: seller.address,
      ciphertext: '0xdeadbeef',
    },
    buyer.sign,
  );
  const res = await openEnvelope(env, { expectedFrom: buyer.address });
  assert.equal(res.ok, true);
  assert.equal(res.recoveredAddress.toLowerCase(), buyer.address.toLowerCase());
});

test('open with the WRONG expectedFrom is rejected', async () => {
  const buyer = signerFor(generatePrivateKey());
  const seller = signerFor(generatePrivateKey());
  const env = await sealEnvelope(
    { kind: 'shipping-address', orderId: '42', from: buyer.address, to: seller.address, ciphertext: '0xab' },
    buyer.sign,
  );
  assert.equal(await verifyEnvelope(env, { expectedFrom: seller.address }), false);
});

test('tampering with the ciphertext invalidates the signature', async () => {
  const buyer = signerFor(generatePrivateKey());
  const seller = signerFor(generatePrivateKey());
  const env = await sealEnvelope(
    { kind: 'shipping-address', orderId: '42', from: buyer.address, to: seller.address, ciphertext: '0xab' },
    buyer.sign,
  );
  const tampered = { ...env, ciphertext: '0xcd' as Hex };
  assert.equal(await verifyEnvelope(tampered, { expectedFrom: buyer.address }), false);
});

test('tampering with the orderId invalidates the signature', async () => {
  const buyer = signerFor(generatePrivateKey());
  const seller = signerFor(generatePrivateKey());
  const env = await sealEnvelope(
    { kind: 'shipping-address', orderId: '42', from: buyer.address, to: seller.address, ciphertext: '0xab' },
    buyer.sign,
  );
  const tampered = { ...env, orderId: '43' };
  assert.equal(await verifyEnvelope(tampered, { expectedFrom: buyer.address }), false);
});

test('a garbage signature does not throw and is rejected', async () => {
  const buyer = signerFor(generatePrivateKey());
  const seller = signerFor(generatePrivateKey());
  const env = await sealEnvelope(
    { kind: 'shipping-address', orderId: '42', from: buyer.address, to: seller.address, ciphertext: '0xab' },
    buyer.sign,
  );
  const broken = { ...env, sig: '0x00' as Hex };
  const res = await openEnvelope(broken, { expectedFrom: buyer.address });
  assert.equal(res.ok, false);
});
