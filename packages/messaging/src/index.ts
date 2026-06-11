/**
 * @freeemarket/messaging — bidirectional encrypted messaging over Swarm PSS.
 *
 * Implements the CLAUDE.md §5 private-message flow in BOTH directions, on the
 * SAME machinery (ECIES encrypt → signed envelope → PSS + feed delivery):
 *
 *   1. BUYER → SELLER — the shipping address `{ orderId, name, address }`, sent
 *      after `buy()` funds escrow and emits `OrderFunded(orderId, …, buyer, …)`.
 *      The seller verifies the envelope's signer == on-chain `order.buyer`.
 *
 *   2. SELLER → BUYER — a shipment update / TRACKING CODE
 *      `{ orderId, carrier?, trackingCode?, note? }`, sent after the seller
 *      ships. The buyer verifies the envelope's signer == on-chain `order.seller`.
 *
 * Each payload is ECIES-encrypted to the RECIPIENT's public key (eciesjs — NOT
 * MetaMask's deprecated eth_decrypt, see CLAUDE.md §3), wrapped in a signed
 * envelope so the receiver can cryptographically bind the message to the
 * expected on-chain counterparty, then delivered over PSS AND written to the
 * recipient's feed for store-and-forward. Decryption uses the recipient's
 * PRIVATE key.
 *
 * On-chain verification semantics (the security-critical invariant):
 *   - shipping-address: signed by BUYER,  received by SELLER (expectedFrom=buyer)
 *   - shipment-update:  signed by SELLER, received by BUYER  (expectedFrom=seller)
 *
 * These high-level functions REPLACE the app stubs
 * (apps/storefront/src/messaging, apps/cms/src/messaging); their argument shapes
 * are a superset of those stubs so swap-in is a near-one-file change.
 */
import type { Address, Hex } from 'viem';
import { encryptJson, decryptJson } from './crypto.js';
import {
  sealEnvelope,
  openEnvelope,
  ciphertextBytes,
  type Envelope,
} from './envelope.js';
import type { SignDigest } from './envelope.js';
import {
  assertShippingAddress,
  assertShipmentUpdate,
  type ShippingAddress,
  type ShipmentUpdate,
} from './messages.js';
import {
  topicForOrder,
  directionForKind,
  type Transport,
} from './transport.js';

export * from './crypto.js';
export * from './envelope.js';
export * from './messages.js';
export * from './transport.js';

/** Result of a send: which paths delivered + the topic used. */
export interface SendResult {
  delivered: boolean;
  stub: false;
  topic: string;
  pss?: boolean;
  feedRef?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// BUYER → SELLER : shipping address (CLAUDE.md §5, steps 2–4)
// ───────────────────────────────────────────────────────────────────────────

/** Args for {@link sendShippingAddress} (superset of the storefront stub). */
export interface SendShippingAddressArgs {
  orderId: string;
  /** On-chain buyer (msg.sender of `buy`) — signs the envelope. */
  buyer: Address;
  /** On-chain seller — the recipient; address is encrypted to their key. */
  seller: Address;
  /** Seller's ECIES public key (resolved via ContactRegistry). */
  sellerPublicKey: Hex;
  /** The plaintext shipping details (client-side only, never logged). */
  address: { name: string; address: string };
  /** Signs the envelope digest as the BUYER (viem account / wallet / raw key). */
  signMessage: SignDigest;
  transport: Transport;
}

/**
 * Encrypt the shipping address to the seller's key, seal an envelope SIGNED BY
 * THE BUYER, and deliver it to the seller on the buyer→seller topic.
 */
export async function sendShippingAddress(
  args: SendShippingAddressArgs,
): Promise<SendResult> {
  const payload: ShippingAddress = {
    orderId: args.orderId,
    name: args.address.name,
    address: args.address.address,
  };
  assertShippingAddress(payload);

  const ciphertext = encryptJson(args.sellerPublicKey, payload);
  const envelope = await sealEnvelope(
    {
      kind: 'shipping-address',
      orderId: args.orderId,
      from: args.buyer,
      to: args.seller,
      ciphertext,
    },
    args.signMessage,
  );
  const topic = topicForOrder(args.orderId, directionForKind('shipping-address'));
  const res = await args.transport.send(topic, args.seller, envelope);
  return { delivered: true, stub: false, topic, ...res };
}

/** Args for {@link receiveShippingAddress} (superset of the CMS stub). */
export interface ReceiveShippingAddressArgs {
  orderId: string;
  /** Expected sender — the on-chain `order.buyer` to verify against. */
  buyer: Address;
  /** The seller (recipient) — whose mailbox we read. */
  seller: Address;
  /** The SELLER's ECIES private key (local keystore only — never committed). */
  recipientPrivateKey: Hex;
  transport: Transport;
}

/** Result of receiving a shipping address. */
export interface ReceiveShippingAddressResult {
  decrypted: boolean;
  stub: false;
  address: ShippingAddress | null;
  /** Envelopes seen but rejected (bad signer / wrong sender). */
  rejected: number;
}

/**
 * SELLER side: read the buyer→seller topic, verify each envelope's signer ==
 * `buyer` (rejecting forgeries), ECIES-decrypt the first valid one with the
 * seller's PRIVATE key, and validate it as a ShippingAddress.
 */
export async function receiveShippingAddress(
  args: ReceiveShippingAddressArgs,
): Promise<ReceiveShippingAddressResult> {
  const topic = topicForOrder(args.orderId, directionForKind('shipping-address'));
  const envelopes = await args.transport.receive(topic, { recipient: args.seller });
  let rejected = 0;
  for (const envelope of envelopes) {
    if (envelope.kind !== 'shipping-address' || envelope.orderId !== args.orderId) {
      rejected++;
      continue;
    }
    const { ok } = await openEnvelope(envelope, { expectedFrom: args.buyer });
    if (!ok) {
      rejected++;
      continue;
    }
    try {
      const payload = decryptJson<unknown>(
        args.recipientPrivateKey,
        ciphertextBytes(envelope),
      );
      return {
        decrypted: true,
        stub: false,
        address: assertShippingAddress(payload),
        rejected,
      };
    } catch {
      rejected++;
    }
  }
  return { decrypted: false, stub: false, address: null, rejected };
}

// ───────────────────────────────────────────────────────────────────────────
// SELLER → BUYER : shipment update / tracking code (symmetric counterpart)
// ───────────────────────────────────────────────────────────────────────────

/** Args for {@link sendShipmentUpdate} (seller→buyer tracking code). */
export interface SendShipmentUpdateArgs {
  orderId: string;
  /** On-chain buyer — the recipient; update is encrypted to their key. */
  buyer: Address;
  /** On-chain seller — signs the envelope. */
  seller: Address;
  /** Buyer's ECIES public key (resolved via ContactRegistry). */
  buyerPublicKey: Hex;
  /** Tracking code / carrier / note. */
  update: Omit<ShipmentUpdate, 'orderId'>;
  /** Signs the envelope digest as the SELLER. */
  signMessage: SignDigest;
  transport: Transport;
}

/**
 * Encrypt the shipment update to the buyer's key, seal an envelope SIGNED BY THE
 * SELLER, and deliver it to the buyer on the seller→buyer topic. This is the
 * first-class, symmetric counterpart to {@link sendShippingAddress}.
 */
export async function sendShipmentUpdate(
  args: SendShipmentUpdateArgs,
): Promise<SendResult> {
  const payload: ShipmentUpdate = { orderId: args.orderId, ...args.update };
  assertShipmentUpdate(payload);

  const ciphertext = encryptJson(args.buyerPublicKey, payload);
  const envelope = await sealEnvelope(
    {
      kind: 'shipment-update',
      orderId: args.orderId,
      from: args.seller,
      to: args.buyer,
      ciphertext,
    },
    args.signMessage,
  );
  const topic = topicForOrder(args.orderId, directionForKind('shipment-update'));
  const res = await args.transport.send(topic, args.buyer, envelope);
  return { delivered: true, stub: false, topic, ...res };
}

/** Args for {@link receiveShipmentUpdate} (buyer side). */
export interface ReceiveShipmentUpdateArgs {
  orderId: string;
  /** The buyer (recipient) — whose mailbox we read. */
  buyer: Address;
  /** Expected sender — the on-chain `order.seller` to verify against. */
  seller: Address;
  /** The BUYER's ECIES private key. */
  recipientPrivateKey: Hex;
  transport: Transport;
}

/** Result of receiving a shipment update. */
export interface ReceiveShipmentUpdateResult {
  decrypted: boolean;
  stub: false;
  update: ShipmentUpdate | null;
  rejected: number;
}

/**
 * BUYER side: read the seller→buyer topic, verify each envelope's signer ==
 * `seller` (rejecting forgeries), ECIES-decrypt the first valid one with the
 * buyer's PRIVATE key, and validate it as a ShipmentUpdate.
 */
export async function receiveShipmentUpdate(
  args: ReceiveShipmentUpdateArgs,
): Promise<ReceiveShipmentUpdateResult> {
  const topic = topicForOrder(args.orderId, directionForKind('shipment-update'));
  const envelopes = await args.transport.receive(topic, { recipient: args.buyer });
  let rejected = 0;
  for (const envelope of envelopes) {
    if (envelope.kind !== 'shipment-update' || envelope.orderId !== args.orderId) {
      rejected++;
      continue;
    }
    const { ok } = await openEnvelope(envelope, { expectedFrom: args.seller });
    if (!ok) {
      rejected++;
      continue;
    }
    try {
      const payload = decryptJson<unknown>(
        args.recipientPrivateKey,
        ciphertextBytes(envelope),
      );
      return {
        decrypted: true,
        stub: false,
        update: assertShipmentUpdate(payload),
        rejected,
      };
    } catch {
      rejected++;
    }
  }
  return { decrypted: false, stub: false, update: null, rejected };
}

/** Re-export the {@link Envelope} type at top level for convenience. */
export type { Envelope };
