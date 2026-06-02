/**
 * Encrypted shipping-address delivery + buyer-side tracking read — LIVE, backed
 * by `@freemarket/messaging`, with a graceful STUB fallback when unconfigured.
 *
 * This is the single integration point for the private-message flow described in
 * CLAUDE.md §5. The storefront checkout calls `sendEncryptedAddress(...)` after
 * `market.buy(...)` funds the escrow and emits `OrderFunded(orderId,…)`; a small
 * "track order" panel calls `receiveTracking(...)` to read the seller's reply.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * LIVE FLOW (buyer → seller, shipping address):
 *   1. Resolve the seller's ECIES public key — passed in, else looked up via
 *      SwarmChat's `ContactRegistry` (src/lib/contactRegistry.js) by `seller`.
 *   2. `@freemarket/messaging` builds `{ orderId, name, address }` and
 *      ECIES-encrypts it to the seller's key (eciesjs — MetaMask's native
 *      eth_decrypt / eth_getEncryptionPublicKey are DEPRECATED, CLAUDE.md §3).
 *   3. It seals a signed envelope (the buyer's wallet `signMessage`) so the
 *      seller can verify the sender == on-chain `order.buyer`.
 *   4. It delivers over Swarm PSS via `BeeTransport`, stamped with a short-lived
 *      postage batch so the ciphertext self-expires (CLAUDE.md §5).
 *
 * GRACEFUL STUB: the moment ANY of {seller public key, Bee node URL, postage
 * batch} is missing, the app is "unconfigured" and the boundary returns the old
 * stub result `{ delivered:false, stub:true }` (logging WHICH prerequisite is
 * missing — NEVER the plaintext address). The checkout UX works in both cases.
 *
 * Caveat (CLAUDE.md §5): PSS requires BOTH parties to run a FULL Bee node (not a
 * gateway) — the main UX friction. `beeUrl` must point at such a node for live.
 * ──────────────────────────────────────────────────────────────────────────
 */
import {
  BeeTransport,
  sendShippingAddress,
  receiveShipmentUpdate,
} from '@freemarket/messaging';
import { resolvePublicKey } from '../lib/contactRegistry.js';
import { CONTACT_REGISTRY } from '../config.js';

/**
 * Build a `SignDigest` for `@freemarket/messaging` from a wagmi/viem wallet
 * client. The library signs the envelope digest as a raw EIP-191 personal
 * message; viem's `signMessage({ message: { raw } })` produces exactly that.
 *
 * @param {import('viem').WalletClient} walletClient  connected wallet client.
 * @param {string} account  the signing account (the buyer here).
 * @returns {(digestHex: string) => Promise<string>}
 */
export function makeSignDigest(walletClient, account) {
  return (digestHex) =>
    walletClient.signMessage({ account, message: { raw: digestHex } });
}

/**
 * Send the buyer's shipping address to the seller, encrypted over Swarm PSS.
 *
 * @param {Object} args
 * @param {string|number|bigint} args.orderId  On-chain order id from OrderFunded.
 * @param {string} args.buyer    On-chain buyer (signs the envelope).
 * @param {string} args.seller   On-chain seller (recipient / ContactRegistry key lookup).
 * @param {{ name: string, address: string, country?: string }} args.address  Plaintext (client-side only, never logged). The optional ISO `country` is folded into the encrypted address line so the seller sees the destination (still OFF-CHAIN; CLAUDE.md §5).
 * @param {import('viem').PublicClient} [args.publicClient]  for ContactRegistry key resolution.
 * @param {(digestHex: string) => Promise<string>} [args.signMessage]  buyer's EIP-191 signer.
 * @param {string} args.beeUrl   Bee node base URL (must be a full node for real PSS).
 * @param {string} [args.postageBatchId]  postage batch stamping the PSS upload.
 * @param {string} [args.sellerPublicKey]  seller ECIES key, if already resolved.
 * @returns {Promise<{ delivered: boolean, stub: boolean, topic?: string }>}
 */
export async function sendEncryptedAddress({
  orderId,
  buyer,
  seller,
  address,
  publicClient,
  signMessage,
  beeUrl,
  postageBatchId,
  sellerPublicKey,
}) {
  // --- Input validation (kept identical to the original boundary's contract). ---
  if (orderId === undefined || orderId === null || `${orderId}` === '') {
    throw new Error('sendEncryptedAddress: orderId is required');
  }
  if (!seller || typeof seller !== 'string') {
    throw new Error('sendEncryptedAddress: seller address is required');
  }
  if (!address || !address.name || !address.address) {
    throw new Error('sendEncryptedAddress: address must include { name, address }');
  }

  // Resolve the seller's ECIES public key: passed in, else via ContactRegistry.
  let pubKey = sellerPublicKey || null;
  if (!pubKey && publicClient) {
    pubKey = await resolvePublicKey(publicClient, CONTACT_REGISTRY, seller);
  }

  // Prerequisite gate: only go LIVE when ALL of {pubkey, bee node, batch, signer}
  // are present. Otherwise fall back to the stub so checkout still completes.
  const missing = [];
  if (!pubKey) missing.push('seller ECIES public key (ContactRegistry unset or no entry)');
  if (!beeUrl) missing.push('Bee node URL (VITE_BEE_URL)');
  if (!postageBatchId) missing.push('messaging postage batch (VITE_MESSAGING_BATCH_ID / VITE_POSTAGE_BATCH_ID)');
  if (typeof signMessage !== 'function') missing.push('buyer wallet signer');

  if (missing.length > 0) {
    // NEVER log the plaintext address.
    console.info(
      '[messaging:STUB] encrypted-address delivery skipped — unconfigured prerequisites:',
      missing.join('; '),
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    return { delivered: false, stub: true };
  }

  // LIVE: BeeTransport is constructed ONLY behind the config gate above.
  const transport = new BeeTransport({ beeUrl, postageBatchId });
  const result = await sendShippingAddress({
    orderId: `${orderId}`,
    buyer,
    seller,
    sellerPublicKey: pubKey,
    // Fold the destination country into the address text so the seller sees it
    // (the messaging lib's ShippingAddress is { name, address }). Still entirely
    // OFF-CHAIN inside the ECIES-encrypted payload (CLAUDE.md §5).
    address: {
      name: address.name,
      address: address.country
        ? `${address.address}\n${address.country}`
        : address.address,
    },
    signMessage,
    transport,
  });
  return { delivered: true, stub: false, topic: result.topic };
}

/**
 * Buyer side of seller→buyer: read the tracking code / shipment update the seller
 * sent for `orderId`, decrypting with the buyer's own unlocked ECIES private key.
 *
 * The private key is unlocked LOCALLY at runtime (never committed/env'd) — same
 * keystore caveat as the CMS. When the key or Bee node is missing, returns a stub.
 *
 * @param {Object} args
 * @param {string|number|bigint} args.orderId
 * @param {string} args.buyer    the buyer (recipient) — reads their own mailbox.
 * @param {string} args.seller   expected sender (order.seller) to verify against.
 * @param {string} [args.recipientPrivateKey]  buyer's ECIES private key (local only).
 * @param {string} args.beeUrl
 * @returns {Promise<{ decrypted: boolean, stub: boolean, update: object|null, rejected?: number }>}
 */
export async function receiveTracking({
  orderId,
  buyer,
  seller,
  recipientPrivateKey,
  beeUrl,
}) {
  if (orderId === undefined || orderId === null || `${orderId}` === '') {
    throw new Error('receiveTracking: orderId is required');
  }
  if (!buyer || typeof buyer !== 'string') {
    throw new Error('receiveTracking: buyer address is required');
  }
  if (!seller || typeof seller !== 'string') {
    throw new Error('receiveTracking: seller address is required');
  }

  const missing = [];
  if (!recipientPrivateKey) missing.push('buyer ECIES private key (unlock locally)');
  if (!beeUrl) missing.push('Bee node URL (VITE_BEE_URL)');
  if (missing.length > 0) {
    console.info(
      '[messaging:STUB] tracking read skipped — unconfigured prerequisites:',
      missing.join('; '),
    );
    return { decrypted: false, stub: true, update: null };
  }

  const transport = new BeeTransport({ beeUrl, postageBatchId: '' });
  const result = await receiveShipmentUpdate({
    orderId: `${orderId}`,
    buyer,
    seller,
    recipientPrivateKey,
    transport,
  });
  return {
    decrypted: result.decrypted,
    stub: false,
    update: result.update,
    rejected: result.rejected,
  };
}
