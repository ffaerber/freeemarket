/**
 * ECIES encryption primitives for FreeeMarket private messages.
 *
 * IMPORTANT (CLAUDE.md §3): this uses ECIES via `eciesjs` — NOT MetaMask's
 * native `eth_decrypt` / `eth_getEncryptionPublicKey`, which are DEPRECATED and
 * must not be used. The keypair here is a standalone secp256k1 ECIES keypair
 * (the same curve as Ethereum keys, but used for encryption, not signing).
 * Senders encrypt to the recipient's PUBLIC key; only the recipient's PRIVATE
 * key can decrypt.
 *
 * Key custody (CLAUDE.md §5): the private key belongs to the recipient and must
 * never be committed, logged, or shipped to a browser env. The CMS is meant to
 * run locally precisely so the merchant private key + decrypted plaintext never
 * leave the merchant's machine.
 */
import {
  PrivateKey,
  PublicKey,
  encrypt as eciesEncrypt,
  decrypt as eciesDecrypt,
} from 'eciesjs';
import { bytesToHex, hexToBytes, keccak256, type Hex } from 'viem';

/** A standalone ECIES (secp256k1) keypair, hex-encoded with `0x` prefix. */
export interface KeyPair {
  /** secp256k1 private key — KEEP SECRET. 32-byte hex (`0x…`). */
  privateKey: Hex;
  /** secp256k1 public key — share freely (e.g. via ContactRegistry). Hex (`0x…`). */
  publicKey: Hex;
}

/**
 * Generate a fresh ECIES keypair. In production the recipient generates this
 * once and publishes `publicKey` via SwarmChat's `ContactRegistry.register()`;
 * `privateKey` is backed up to a local keystore (never committed/logged).
 */
export function generateKeyPair(): KeyPair {
  const sk = new PrivateKey();
  return {
    privateKey: bytesToHex(sk.secret),
    // Uncompressed public key (65 bytes) — eciesjs accepts both forms.
    publicKey: bytesToHex(sk.publicKey.toBytes(false)),
  };
}

/** Derive the public key for a given ECIES private key. */
export function publicKeyFromPrivate(privateKey: Hex): Hex {
  const sk = new PrivateKey(hexToBytes(privateKey));
  return bytesToHex(sk.publicKey.toBytes(false));
}

/**
 * Ethereum-style address derived from an ECIES public key.
 *
 * This is what closes the store-and-forward loop (CLAUDE.md §5). A Swarm feed
 * is owned by an Ethereum address, and the SENDER writes the feed (the
 * recipient can't — they don't have the message). So the reader needs the
 * sender's feed-owner address. It cannot be the sender's WALLET address: a
 * browser wallet never exports the private key `makeFeedWriter` requires.
 *
 * Instead both sides key off the ECIES keypair that already exists for this
 * flow: the sender signs the feed with their ECIES private key, and the reader
 * derives the same address from the sender's ECIES PUBLIC key — which it has
 * already fetched from the ContactRegistry to do encryption. No new registry
 * field, no extra key to publish.
 *
 * ECIES keys are secp256k1, same as Ethereum keys, so the derivation is the
 * standard one: keccak256 of the 64-byte uncompressed public key (0x04 prefix
 * stripped), last 20 bytes.
 *
 * NOTE ON KEY REUSE: this uses one keypair for both encryption and feed
 * signing, which is a deliberate trade of strict key separation for not having
 * to publish and discover a second key. The feed signature only authenticates
 * feed chunks the sender authored; message authenticity is carried
 * independently by the signed envelope (which the WALLET signs), so a feed
 * forgery cannot impersonate a counterparty — `openEnvelope` still rejects it.
 */
export function addressFromPublicKey(publicKey: Hex): Hex {
  let bytes = hexToBytes(publicKey);
  // Accept compressed (33 bytes) by normalizing through eciesjs first.
  if (bytes.length === 33) {
    bytes = PublicKey.fromHex(bytesToHex(bytes).slice(2)).toBytes(false);
  }
  if (bytes.length === 65) bytes = bytes.slice(1); // drop the 0x04 prefix
  if (bytes.length !== 64) {
    throw new Error(
      `addressFromPublicKey: expected a 33/64/65-byte secp256k1 key, got ${bytes.length}`,
    );
  }
  return `0x${keccak256(bytesToHex(bytes)).slice(-40)}` as Hex;
}

/**
 * ECIES-encrypt `bytes` to `recipientPublicKey`. Returns the ciphertext as a
 * `Uint8Array` (ephemeral pubkey + IV + tag + body, per eciesjs). Uses
 * `Uint8Array` throughout (no Node `Buffer`) so it bundles for the browser apps.
 */
export function encrypt(recipientPublicKey: Hex, bytes: Uint8Array): Uint8Array {
  return new Uint8Array(eciesEncrypt(hexToBytes(recipientPublicKey), bytes));
}

/**
 * ECIES-decrypt `ciphertext` with the recipient's PRIVATE key. Throws if the
 * key is wrong or the ciphertext is corrupt/tampered (eciesjs MAC check).
 */
export function decrypt(privateKey: Hex, ciphertext: Uint8Array): Uint8Array {
  return new Uint8Array(eciesDecrypt(hexToBytes(privateKey), ciphertext));
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Convenience: JSON-stringify a value and ECIES-encrypt the UTF-8 bytes. */
export function encryptJson(recipientPublicKey: Hex, value: unknown): Uint8Array {
  return encrypt(recipientPublicKey, encoder.encode(JSON.stringify(value)));
}

/** Convenience: ECIES-decrypt and JSON-parse. Type is unchecked — validate after. */
export function decryptJson<T = unknown>(privateKey: Hex, ciphertext: Uint8Array): T {
  return JSON.parse(decoder.decode(decrypt(privateKey, ciphertext))) as T;
}

/** Hex helpers re-exported so consumers don't need a direct viem dep just for this. */
export { bytesToHex, hexToBytes };
