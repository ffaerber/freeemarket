/**
 * Encrypted shipping-address RECEIVE/DECRYPT + tracking-code SEND — LIVE, backed
 * by `@freeemarket/messaging`, with a graceful STUB fallback when unconfigured.
 *
 * The merchant-side counterpart to the storefront's `sendEncryptedAddress(...)`.
 * The buyer encrypts + sends their address over Swarm PSS after `buy(...)` funds
 * the escrow; the CMS calls `receiveDecryptedAddress(...)` to pull and decrypt it
 * so the merchant can ship. After shipping, `sendShipmentUpdateFromCms(...)`
 * sends a tracking code back to the buyer (seller→buyer). (CLAUDE.md §5.)
 *
 * ──────────────────────────────────────────────────────────────────────────
 * LIVE FLOW (seller side):
 *   - receive: read the buyer→seller PSS topic / seller feed (BeeTransport),
 *     verify each signed envelope's signer == on-chain `order.buyer`, then
 *     ECIES-decrypt the ciphertext with the SELLER's PRIVATE key (eciesjs).
 *   - send tracking: resolve the BUYER's ECIES public key via ContactRegistry,
 *     ECIES-encrypt the update to it, seal an envelope signed by the SELLER's
 *     wallet, and deliver over PSS.
 *
 * GRACEFUL STUB: whenever a prerequisite is missing (no Bee node; no unlocked
 * private key for receive; no buyer pubkey / signer for send) the boundary
 * returns the original stub result shape so the dashboard keeps rendering.
 *
 * KEY CUSTODY (CLAUDE.md §5): the seller's ECIES DECRYPTION PRIVATE KEY belongs
 * to the merchant and lives ONLY on the merchant's machine. It is NEVER
 * committed, logged, or read from VITE_ env (that bakes it into the bundle).
 * The CMS unlocks it at RUNTIME via a password field (React/sessionStorage only)
 * and passes it here as `recipientPrivateKey`. Run the CMS LOCALLY so the key +
 * decrypted plaintext addresses never leave the merchant's computer. PSS also
 * requires a FULL Bee node (not a gateway) on both ends.
 * ──────────────────────────────────────────────────────────────────────────
 */
import {
  BeeTransport,
  receiveShippingAddress,
  sendShipmentUpdate,
} from '@freeemarket/messaging';
import { resolvePublicKey } from '../lib/contactRegistry.js';
import { CONTACT_REGISTRY } from '../config.js';

/**
 * Build a `SignDigest` for `@freeemarket/messaging` from a wagmi/viem wallet
 * client (the SELLER's wallet). The library signs the envelope digest as a raw
 * EIP-191 personal message; viem's `signMessage({ message: { raw } })` matches.
 *
 * @param {import('viem').WalletClient} walletClient
 * @param {string} account  the signing account (the seller).
 * @returns {(digestHex: string) => Promise<string>}
 */
export function makeSignDigest(walletClient, account) {
  return (digestHex) =>
    walletClient.signMessage({ account, message: { raw: digestHex } });
}

/**
 * SELLER side: read + decrypt the buyer's shipping address for `orderId`.
 *
 * @param {Object} args
 * @param {string|number|bigint} args.orderId
 * @param {string} args.seller  the connected merchant (recipient — reads own mailbox).
 * @param {string} args.buyer   expected sender (order.buyer) to verify against.
 * @param {string} [args.recipientPrivateKey]  seller's ECIES private key (local keystore only).
 * @param {string} args.beeUrl
 * @param {string} [args.postageBatchId]  not strictly needed for receive.
 * @returns {Promise<{ decrypted: boolean, stub: boolean, address: object|null, rejected?: number }>}
 */
export async function receiveDecryptedAddress({
  orderId,
  seller,
  buyer,
  recipientPrivateKey,
  beeUrl,
  postageBatchId,
}) {
  if (orderId === undefined || orderId === null || `${orderId}` === '') {
    throw new Error('receiveDecryptedAddress: orderId is required');
  }
  if (!seller || typeof seller !== 'string') {
    throw new Error('receiveDecryptedAddress: seller address is required');
  }
  if (!buyer || typeof buyer !== 'string') {
    throw new Error('receiveDecryptedAddress: buyer address is required');
  }

  const missing = [];
  if (!recipientPrivateKey) missing.push('merchant ECIES private key (unlock it locally)');
  if (!beeUrl) missing.push('Bee node URL (VITE_BEE_URL)');
  if (missing.length > 0) {
    // NEVER log the private key or the plaintext address.
    console.info(
      '[messaging:STUB] address decrypt skipped — unconfigured prerequisites:',
      missing.join('; '),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { decrypted: false, stub: true, address: null };
  }

  // BeeTransport built ONLY behind the config gate. `feedOwner` = seller so the
  // store-and-forward read targets the merchant's own recipient feed.
  const transport = new BeeTransport({
    beeUrl,
    postageBatchId: postageBatchId || '',
    feedOwner: seller,
  });
  const result = await receiveShippingAddress({
    orderId: `${orderId}`,
    buyer,
    seller,
    recipientPrivateKey,
    transport,
  });
  return {
    decrypted: result.decrypted,
    stub: false,
    address: result.address,
    rejected: result.rejected,
  };
}

/**
 * SELLER → BUYER: send a shipment update / tracking code for `orderId`,
 * encrypted to the buyer's ECIES key and signed by the seller's wallet.
 *
 * @param {Object} args
 * @param {string|number|bigint} args.orderId
 * @param {string} args.buyer    recipient (update encrypted to their key).
 * @param {string} args.seller   sender (signs the envelope).
 * @param {{ carrier?: string, trackingCode?: string, note?: string }} args.update
 * @param {string} [args.buyerPublicKey]  buyer ECIES key, if already resolved.
 * @param {import('viem').PublicClient} [args.publicClient]  for ContactRegistry lookup.
 * @param {(digestHex: string) => Promise<string>} [args.signMessage]  seller's EIP-191 signer.
 * @param {string} args.beeUrl
 * @param {string} [args.postageBatchId]  postage batch stamping the PSS upload.
 * @returns {Promise<{ delivered: boolean, stub: boolean, topic?: string }>}
 */
export async function sendShipmentUpdateFromCms({
  orderId,
  buyer,
  seller,
  update,
  buyerPublicKey,
  publicClient,
  signMessage,
  beeUrl,
  postageBatchId,
}) {
  if (orderId === undefined || orderId === null || `${orderId}` === '') {
    throw new Error('sendShipmentUpdateFromCms: orderId is required');
  }
  if (!buyer || typeof buyer !== 'string') {
    throw new Error('sendShipmentUpdateFromCms: buyer address is required');
  }
  if (!seller || typeof seller !== 'string') {
    throw new Error('sendShipmentUpdateFromCms: seller address is required');
  }
  if (!update || (!update.trackingCode && !update.carrier && !update.note)) {
    throw new Error('sendShipmentUpdateFromCms: update needs at least one of carrier/trackingCode/note');
  }

  // Resolve the buyer's ECIES public key: passed in, else via ContactRegistry.
  let pubKey = buyerPublicKey || null;
  if (!pubKey && publicClient) {
    pubKey = await resolvePublicKey(publicClient, CONTACT_REGISTRY, buyer);
  }

  const missing = [];
  if (!pubKey) missing.push('buyer ECIES public key (ContactRegistry unset or no entry)');
  if (!beeUrl) missing.push('Bee node URL (VITE_BEE_URL)');
  if (!postageBatchId) missing.push('postage batch (VITE_POSTAGE_BATCH_ID)');
  if (typeof signMessage !== 'function') missing.push('seller wallet signer');

  if (missing.length > 0) {
    console.info(
      '[messaging:STUB] tracking-code send skipped — unconfigured prerequisites:',
      missing.join('; '),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    return { delivered: false, stub: true };
  }

  const transport = new BeeTransport({ beeUrl, postageBatchId });
  const result = await sendShipmentUpdate({
    orderId: `${orderId}`,
    buyer,
    seller,
    buyerPublicKey: pubKey,
    update: {
      ...(update.carrier ? { carrier: update.carrier } : {}),
      ...(update.trackingCode ? { trackingCode: update.trackingCode } : {}),
      ...(update.note ? { note: update.note } : {}),
    },
    signMessage,
    transport,
  });
  return { delivered: true, stub: false, topic: result.topic };
}
