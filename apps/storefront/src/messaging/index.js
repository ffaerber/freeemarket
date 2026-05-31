/**
 * Encrypted shipping-address delivery — clean boundary + STUB.
 *
 * This is the single integration point for the private-address flow described
 * in CLAUDE.md §5. The storefront checkout calls `sendEncryptedAddress(...)`
 * after `market.buy(...)` funds the escrow and emits `OrderFunded(orderId,…)`.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * REAL FLOW — now backed by `@freemarket/messaging` (packages/messaging).
 * This stub delegates to that library's `sendShippingAddress(...)` once the
 * three runtime prerequisites below are wired; until then it returns the stub
 * result so the checkout UX still works with no Bee node configured.
 *
 *   1. Resolve the seller's ECIES public key. Sellers publish it via SwarmChat's
 *      `ContactRegistry.register()`; look it up by `seller` address rather than
 *      duplicating a key on-chain in Marketplace. (Pass it as `sellerPublicKey`.)
 *   2. `@freemarket/messaging` builds `{ orderId, name, address }` and
 *      ECIES-encrypts it to the seller's key (eciesjs — MetaMask's native
 *      eth_decrypt / eth_getEncryptionPublicKey are DEPRECATED).
 *   3. It seals a signed envelope (the buyer's wallet `signMessage`) so the
 *      seller can verify the sender == on-chain `order.buyer`.
 *   4. It delivers over Swarm PSS + the seller's feed via `BeeTransport`,
 *      stamped with a short-lived postage batch so the ciphertext self-expires.
 *
 * STILL TO WIRE to flip this from stub → live (all three required):
 *   - seller ECIES public key resolution via ContactRegistry,
 *   - a configured full Bee node + postage batch (`BeeTransport`),
 *   - the buyer wallet's `signMessage` (already available via wagmi/viem).
 *
 * Caveat (CLAUDE.md §5): PSS requires BOTH parties to run a full Bee node, not
 * a gateway — this is the main UX friction. The `beeUrl` passed in must point
 * at such a node for the real implementation.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * @typedef {Object} SendEncryptedAddressArgs
 * @property {string|number|bigint} orderId  On-chain order id from OrderFunded.
 * @property {string} seller                  Seller address (ContactRegistry key lookup).
 * @property {string} [sellerPubKey]          Seller's PSS/ECIES public key, if already resolved.
 * @property {{ name: string, address: string }} address  Buyer's shipping details (plaintext, client-side only).
 * @property {string} beeUrl                   Bee node base URL (must be a full node for real PSS).
 *
 * @typedef {Object} SendEncryptedAddressResult
 * @property {boolean} delivered  Whether the address was actually delivered.
 * @property {boolean} stub       True while this is the stub implementation.
 * @property {string} [topic]     PSS topic / feed reference (real impl only).
 *
 * @param {SendEncryptedAddressArgs} args
 * @returns {Promise<SendEncryptedAddressResult>}
 */
export async function sendEncryptedAddress({
  orderId,
  seller,
  sellerPubKey,
  address,
  beeUrl,
}) {
  // --- Input validation (kept identical to the real boundary's contract). ---
  if (orderId === undefined || orderId === null || `${orderId}` === '') {
    throw new Error('sendEncryptedAddress: orderId is required');
  }
  if (!seller || typeof seller !== 'string') {
    throw new Error('sendEncryptedAddress: seller address is required');
  }
  if (!address || !address.name || !address.address) {
    throw new Error(
      'sendEncryptedAddress: address must include { name, address }',
    );
  }
  if (!beeUrl || typeof beeUrl !== 'string') {
    throw new Error('sendEncryptedAddress: beeUrl is required');
  }

  // TODO(messaging): delegate to `@freemarket/messaging`'s sendShippingAddress
  // once a Bee node + postage batch (BeeTransport), the seller's ECIES public
  // key (ContactRegistry), and the buyer wallet `signMessage` are wired here.
  // The library is built and tested; this is the remaining app-side glue. The
  // call shape is a superset of this function's args. See CLAUDE.md §5 and §10.
  console.info(
    '[messaging:STUB] would ECIES-encrypt shipping address and send over Swarm PSS',
    {
      orderId: `${orderId}`,
      seller,
      sellerPubKey: sellerPubKey ? '(provided)' : '(would resolve via ContactRegistry)',
      beeUrl,
      // NOTE: never log the plaintext address in the real impl; shown masked here.
      address: { name: address.name, address: '«redacted»' },
    },
  );

  // Simulate network/encryption latency so the checkout UX matches reality.
  await new Promise((resolve) => setTimeout(resolve, 900));

  return { delivered: false, stub: true };
}
