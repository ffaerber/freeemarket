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
  addressFromPublicKey,
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

/**
 * A transport that models BeeTransport's FEED semantics rather than a mailbox:
 * `send` files the envelope under the SENDER's feed-owner address, and
 * `receive` only finds it if the reader points at that same owner. This is the
 * offline / store-and-forward path — the one that carries a message when the
 * recipient wasn't listening at send time.
 */
class FeedTransport {
  constructor(senderFeedOwner) {
    this.senderFeedOwner = senderFeedOwner.toLowerCase();
    this.feeds = new Map();
  }
  async send(topic, _recipient, envelope) {
    this.feeds.set(`${topic}::${this.senderFeedOwner}`, envelope);
    return { pss: true, feedRef: 'feed:1' };
  }
  async receive(topic, opts) {
    if (!opts.feedOwner) return []; // no owner ⇒ no feed read (PSS-only)
    const hit = this.feeds.get(`${topic}::${opts.feedOwner.toLowerCase()}`);
    return hit ? [hit] : [];
  }
}

test('offline hand-off: seller reads the address from the BUYER-owned feed', async () => {
  const f = fixture();
  // The buyer signs the feed with their ECIES key, so the feed owner is the
  // address derived from that keypair.
  const transport = new FeedTransport(addressFromPublicKey(f.buyerEcies.publicKey));

  await sendShippingAddress({
    orderId: f.orderId,
    buyer: f.buyer.address,
    seller: f.seller.address,
    sellerPublicKey: f.sellerEcies.publicKey,
    address: { name: 'Ada Lovelace', address: '1 Analytical Engine Way' },
    signMessage: f.buyer.sign,
    transport,
  });

  // Without the sender's public key there is no feed to point at — the seller
  // finds nothing, which is exactly the bug this wiring fixes.
  const blind = await receiveShippingAddress({
    orderId: f.orderId,
    buyer: f.buyer.address,
    seller: f.seller.address,
    recipientPrivateKey: f.sellerEcies.privateKey,
    transport,
  });
  assert.equal(blind.decrypted, false, 'no feedOwner ⇒ nothing found');

  // With it, the seller locates the buyer's feed and decrypts.
  const got = await receiveShippingAddress({
    orderId: f.orderId,
    buyer: f.buyer.address,
    seller: f.seller.address,
    recipientPrivateKey: f.sellerEcies.privateKey,
    senderPublicKey: f.buyerEcies.publicKey,
    transport,
  });
  assert.equal(got.decrypted, true);
  assert.equal(got.address.name, 'Ada Lovelace');
});

test('offline hand-off: buyer reads tracking from the SELLER-owned feed', async () => {
  const f = fixture();
  const transport = new FeedTransport(addressFromPublicKey(f.sellerEcies.publicKey));

  await sendShipmentUpdate({
    orderId: f.orderId,
    buyer: f.buyer.address,
    seller: f.seller.address,
    buyerPublicKey: f.buyerEcies.publicKey,
    update: { carrier: 'DHL', trackingCode: 'JD014600003651' },
    signMessage: f.seller.sign,
    transport,
  });

  const got = await receiveShipmentUpdate({
    orderId: f.orderId,
    buyer: f.buyer.address,
    seller: f.seller.address,
    recipientPrivateKey: f.buyerEcies.privateKey,
    senderPublicKey: f.sellerEcies.publicKey,
    transport,
  });
  assert.equal(got.decrypted, true);
  assert.equal(got.update.trackingCode, 'JD014600003651');

  // A reader pointed at the WRONG feed owner (here: its own) finds nothing.
  const wrongFeed = await receiveShipmentUpdate({
    orderId: f.orderId,
    buyer: f.buyer.address,
    seller: f.seller.address,
    recipientPrivateKey: f.buyerEcies.privateKey,
    senderPublicKey: f.buyerEcies.publicKey,
    transport,
  });
  assert.equal(wrongFeed.decrypted, false);
});
