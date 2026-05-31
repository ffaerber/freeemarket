/**
 * Signed envelope binding an encrypted message to its sender.
 *
 * The ciphertext alone proves nothing about WHO sent it. The envelope wraps the
 * ciphertext and is signed by the sender's Ethereum key, so the receiver can
 * recover the signer and REQUIRE it equals the expected on-chain counterparty:
 *
 *   - buyer → seller (shipping address): seller requires signer == order.buyer
 *   - seller → buyer (shipment update):  buyer  requires signer == order.seller
 *
 * This `openEnvelope(..., { expectedFrom })` check is the security-critical step
 * (CLAUDE.md §5, step 3): it binds an incoming message to a paid, on-chain order.
 *
 * Signing uses viem's personal-message scheme (`hashMessage` / EIP-191), which
 * any viem account or browser wallet can produce via `signMessage`, and which we
 * recover with `recoverAddress`. We inject the signer as a function so the same
 * code works with a wallet in the apps and a raw key in tests.
 */
import {
  keccak256,
  hashMessage,
  recoverAddress,
  getAddress,
  toHex,
  bytesToHex,
  hexToBytes,
  type Address,
  type Hex,
} from 'viem';

/** Message kinds. Distinct kinds keep the two directions from cross-contaminating. */
export type MessageKind = 'shipping-address' | 'shipment-update';

/** The signed wire object delivered over PSS and the recipient feed. */
export interface Envelope {
  version: 1;
  kind: MessageKind;
  /** On-chain sender address (the party the receiver verifies against). */
  from: Address;
  /** On-chain recipient address. */
  to: Address;
  /** On-chain order id this message belongs to (stringified uint). */
  orderId: string;
  /** ECIES ciphertext, hex-encoded (`0x…`). */
  ciphertext: Hex;
  /** EIP-191 signature over the canonical digest, hex-encoded. */
  sig: Hex;
}

/** A function that signs a 32-byte digest (hex) and returns a signature (hex). */
export type SignDigest = (digestHex: Hex) => Promise<Hex>;

/**
 * Canonical, collision-resistant digest of the envelope's signed fields. Binding
 * version+kind+orderId+from+to+ciphertext means tampering with ANY of them (e.g.
 * replaying a ciphertext under a different orderId, or swapping the kind) breaks
 * the signature.
 */
export function envelopeDigest(fields: {
  version: 1;
  kind: MessageKind;
  orderId: string;
  from: Address;
  to: Address;
  ciphertext: Hex;
}): Hex {
  const canonical = JSON.stringify([
    fields.version,
    fields.kind,
    fields.orderId,
    getAddress(fields.from),
    getAddress(fields.to),
    fields.ciphertext,
  ]);
  return keccak256(toHex(canonical));
}

/** Input to {@link sealEnvelope} (everything except the signature). */
export interface SealInput {
  kind: MessageKind;
  orderId: string;
  from: Address;
  to: Address;
  /** Ciphertext as bytes or hex. */
  ciphertext: Uint8Array | Hex;
}

function toCiphertextHex(ct: Uint8Array | Hex): Hex {
  return typeof ct === 'string' ? ct : bytesToHex(ct);
}

/**
 * Build and sign an envelope. `signMessage` must sign the digest as a personal
 * message (EIP-191) — exactly what viem's `account.signMessage({ message })` and
 * browser wallets do. The digest is passed as a raw hex string.
 */
export async function sealEnvelope(input: SealInput, signMessage: SignDigest): Promise<Envelope> {
  const ciphertext = toCiphertextHex(input.ciphertext);
  const digest = envelopeDigest({
    version: 1,
    kind: input.kind,
    orderId: input.orderId,
    from: input.from,
    to: input.to,
    ciphertext,
  });
  const sig = await signMessage(digest);
  return {
    version: 1,
    kind: input.kind,
    from: getAddress(input.from),
    to: getAddress(input.to),
    orderId: input.orderId,
    ciphertext,
    sig,
  };
}

/** Result of {@link openEnvelope}. */
export interface OpenResult {
  /** True iff the recovered signer matched `expectedFrom`. */
  ok: boolean;
  /** The address recovered from the signature (whatever it was). */
  recoveredAddress: Address;
}

/**
 * Recover the signer and REQUIRE it equals `expectedFrom` (the on-chain
 * counterparty). Returns `{ ok, recoveredAddress }`; never throws on a bad
 * signature — callers branch on `ok`.
 */
export async function openEnvelope(
  envelope: Envelope,
  opts: { expectedFrom: Address },
): Promise<OpenResult> {
  const digest = envelopeDigest({
    version: envelope.version,
    kind: envelope.kind,
    orderId: envelope.orderId,
    from: envelope.from,
    to: envelope.to,
    ciphertext: envelope.ciphertext,
  });
  let recoveredAddress: Address;
  try {
    recoveredAddress = await recoverAddress({
      hash: hashMessage({ raw: digest }),
      signature: envelope.sig,
    });
  } catch {
    return { ok: false, recoveredAddress: '0x0000000000000000000000000000000000000000' };
  }
  const ok =
    getAddress(recoveredAddress) === getAddress(opts.expectedFrom) &&
    // Defence-in-depth: the envelope's own `from` must also match what we expect.
    getAddress(envelope.from) === getAddress(opts.expectedFrom);
  return { ok, recoveredAddress: getAddress(recoveredAddress) };
}

/** Boolean convenience wrapper over {@link openEnvelope}. */
export async function verifyEnvelope(
  envelope: Envelope,
  opts: { expectedFrom: Address },
): Promise<boolean> {
  return (await openEnvelope(envelope, opts)).ok;
}

/** Decode an envelope's ciphertext field back to bytes for decryption. */
export function ciphertextBytes(envelope: Envelope): Uint8Array {
  return hexToBytes(envelope.ciphertext);
}
