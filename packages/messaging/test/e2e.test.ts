/**
 * End-to-end flow tests over InMemoryTransport (no Bee node), exercising both
 * directions and forgery / cross-direction isolation.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import type { Address, Hex } from 'viem';
import {
  generateKeyPair,
  InMemoryTransport,
  sendShippingAddress,
  receiveShippingAddress,
  sendShipmentUpdate,
  receiveShipmentUpdate,
  type SignDigest,
} from '../src/index.js';

function signerFor(pk: Hex): { address: Address; sign: SignDigest } {
  const account = privateKeyToAccount(pk);
  return {
    address: account.address,
    sign: (digestHex: Hex) => account.signMessage({ message: { raw: digestHex } }),
  };
}

/** A buyer + seller fixture: Ethereum signing keys + ECIES encryption keys. */
function fixture() {
  return {
    buyer: signerFor(generatePrivateKey()),
    seller: signerFor(generatePrivateKey()),
    buyerEcies: generateKeyPair(),
    sellerEcies: generateKeyPair(),
    transport: new InMemoryTransport(),
    orderId: '7',
  };
}

test('BUYER → SELLER: shipping address round-trips', async () => {
  const f = fixture();
  const address = { name: 'Ada Lovelace', address: '1 Analytical Engine Way' };
  const sent = await sendShippingAddress({
    orderId: f.orderId,
    buyer: f.buyer.address,
    seller: f.seller.address,
    sellerPublicKey: f.sellerEcies.publicKey,
    address,
    signMessage: f.buyer.sign,
    transport: f.transport,
  });
  assert.equal(sent.delivered, true);

  const got = await receiveShippingAddress({
    orderId: f.orderId,
    buyer: f.buyer.address,
    seller: f.seller.address,
    recipientPrivateKey: f.sellerEcies.privateKey,
    transport: f.transport,
  });
  assert.equal(got.decrypted, true);
  assert.deepEqual(got.address, { orderId: f.orderId, ...address });
});

test('BUYER → SELLER: a forged sender (not order.buyer) is rejected', async () => {
  const f = fixture();
  const attacker = signerFor(generatePrivateKey());
  // Attacker seals an envelope claiming to be the buyer but signs with their key.
  await sendShippingAddress({
    orderId: f.orderId,
    buyer: attacker.address, // envelope.from = attacker; receiver expects f.buyer
    seller: f.seller.address,
    sellerPublicKey: f.sellerEcies.publicKey,
    address: { name: 'Mallory', address: 'evil' },
    signMessage: attacker.sign,
    transport: f.transport,
  });
  const got = await receiveShippingAddress({
    orderId: f.orderId,
    buyer: f.buyer.address, // the real on-chain buyer
    seller: f.seller.address,
    recipientPrivateKey: f.sellerEcies.privateKey,
    transport: f.transport,
  });
  assert.equal(got.decrypted, false);
  assert.equal(got.address, null);
  assert.equal(got.rejected, 1);
});

test('SELLER → BUYER: shipment update / tracking code round-trips', async () => {
  const f = fixture();
  const update = { carrier: 'DHL', trackingCode: 'JD0123456789', note: 'left porch' };
  const sent = await sendShipmentUpdate({
    orderId: f.orderId,
    buyer: f.buyer.address,
    seller: f.seller.address,
    buyerPublicKey: f.buyerEcies.publicKey,
    update,
    signMessage: f.seller.sign,
    transport: f.transport,
  });
  assert.equal(sent.delivered, true);

  const got = await receiveShipmentUpdate({
    orderId: f.orderId,
    buyer: f.buyer.address,
    seller: f.seller.address,
    recipientPrivateKey: f.buyerEcies.privateKey,
    transport: f.transport,
  });
  assert.equal(got.decrypted, true);
  assert.deepEqual(got.update, { orderId: f.orderId, ...update });
});

test('SELLER → BUYER: a forged sender (not order.seller) is rejected', async () => {
  const f = fixture();
  const attacker = signerFor(generatePrivateKey());
  await sendShipmentUpdate({
    orderId: f.orderId,
    buyer: f.buyer.address,
    seller: attacker.address,
    buyerPublicKey: f.buyerEcies.publicKey,
    update: { trackingCode: 'FAKE' },
    signMessage: attacker.sign,
    transport: f.transport,
  });
  const got = await receiveShipmentUpdate({
    orderId: f.orderId,
    buyer: f.buyer.address,
    seller: f.seller.address, // the real on-chain seller
    recipientPrivateKey: f.buyerEcies.privateKey,
    transport: f.transport,
  });
  assert.equal(got.decrypted, false);
  assert.equal(got.update, null);
});

test('cross-direction isolation: a shipping address is not picked up as a shipment update', async () => {
  const f = fixture();
  await sendShippingAddress({
    orderId: f.orderId,
    buyer: f.buyer.address,
    seller: f.seller.address,
    sellerPublicKey: f.sellerEcies.publicKey,
    address: { name: 'Ada', address: '1 Main St' },
    signMessage: f.buyer.sign,
    transport: f.transport,
  });
  // Buyer polling the shipment-update direction must see nothing.
  const got = await receiveShipmentUpdate({
    orderId: f.orderId,
    buyer: f.buyer.address,
    seller: f.seller.address,
    recipientPrivateKey: f.buyerEcies.privateKey,
    transport: f.transport,
  });
  assert.equal(got.decrypted, false);
  assert.equal(got.update, null);
  assert.equal(got.rejected, 0); // distinct topic → nothing even arrives
});
