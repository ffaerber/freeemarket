/**
 * Encrypted shipping-address RECEIVE + DECRYPT — clean boundary + STUB.
 *
 * This is the merchant-side counterpart to the storefront's
 * `sendEncryptedAddress(...)` (apps/storefront/src/messaging/index.js). The
 * buyer encrypts and sends their address over Swarm PSS after `buy(...)` funds
 * the escrow; the CMS order dashboard calls `receiveDecryptedAddress(...)` to
 * pull and decrypt it so the merchant can ship (CLAUDE.md §5).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * REAL FLOW (to implement when @freemarket/messaging — the ported SwarmChat
 * lib/ — lands; see packages/messaging in CLAUDE.md §10):
 *
 *   1. Listen on the PSS topic for this seller (and/or read the seller's
 *      per-recipient Swarm feed, the store-and-forward mailbox SwarmChat writes
 *      to) for an envelope tagged with `orderId`.
 *   2. Verify the SIGNED envelope (SwarmChat `lib/envelope.ts`): the recovered
 *      signer MUST equal the on-chain `order.buyer` for this `orderId`. Reject
 *      anything else — this is what binds an incoming address to a paid order.
 *   3. ECIES-DECRYPT the ciphertext with the SELLER's PRIVATE key using
 *      `eciesjs` (MetaMask's native eth_decrypt / eth_getEncryptionPublicKey
 *      are DEPRECATED — do not use them).
 *   4. Return `{ decrypted: true, stub: false, address: { name, address } }`.
 *
 * KEY CUSTODY (CLAUDE.md §5 caveats): the decryption PRIVATE KEY belongs to the
 * merchant and lives ONLY on the merchant's machine. It must NEVER be committed,
 * logged, or placed in client env. This is exactly why the CMS is meant to run
 * LOCALLY: the private key + the decrypted plaintext addresses never leave the
 * merchant's computer. Lose the key → addresses become unreadable; back it up
 * and support rotation. The real impl will load it from a local keystore the
 * merchant unlocks — not from anything in this repo.
 *
 * PSS also requires a FULL Bee node (not a gateway) on both ends — `beeUrl`
 * must point at such a node for the real implementation.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * @typedef {Object} ReceiveDecryptedAddressArgs
 * @property {string|number|bigint} orderId  On-chain order id (from OrderFunded).
 * @property {string} seller                  Connected merchant/seller address.
 * @property {string} buyer                    Expected sender (order.buyer) to verify against.
 * @property {string} beeUrl                   Bee node base URL (must be a full node for real PSS).
 *
 * @typedef {Object} ReceiveDecryptedAddressResult
 * @property {boolean} decrypted  Whether an address was actually decrypted.
 * @property {boolean} stub       True while this is the stub implementation.
 * @property {{ name: string, address: string } | null} address  Decrypted address, or null.
 *
 * @param {ReceiveDecryptedAddressArgs} args
 * @returns {Promise<ReceiveDecryptedAddressResult>}
 */
export async function receiveDecryptedAddress({
  orderId,
  seller,
  buyer,
  beeUrl,
}) {
  // --- Input validation (kept identical to the real boundary's contract). ---
  if (orderId === undefined || orderId === null || `${orderId}` === '') {
    throw new Error('receiveDecryptedAddress: orderId is required');
  }
  if (!seller || typeof seller !== 'string') {
    throw new Error('receiveDecryptedAddress: seller address is required');
  }
  if (!buyer || typeof buyer !== 'string') {
    throw new Error('receiveDecryptedAddress: buyer address is required');
  }
  if (!beeUrl || typeof beeUrl !== 'string') {
    throw new Error('receiveDecryptedAddress: beeUrl is required');
  }

  // TODO(messaging): replace this stub with the real PSS/feed read → envelope
  // signature verification (sender == order.buyer) → ECIES-decrypt with the
  // SELLER's private key, as described above. This is a one-file swap once
  // @freemarket/messaging (packages/messaging, ported from SwarmChat lib/) is
  // available. See CLAUDE.md §5 and §10.
  console.info(
    '[messaging:STUB] would read PSS/feed, verify signed envelope sender == order.buyer, then ECIES-decrypt with the merchant private key',
    {
      orderId: `${orderId}`,
      seller,
      buyer,
      beeUrl,
      privateKey: '(never logged; loaded from a local keystore in the real impl)',
    },
  );

  // Simulate network/decryption latency so the dashboard UX matches reality.
  await new Promise((resolve) => setTimeout(resolve, 700));

  return { decrypted: false, stub: true, address: null };
}
