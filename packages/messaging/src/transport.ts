/**
 * Swarm PSS + per-recipient feed transport for signed envelopes.
 *
 * Delivery is dual-path (CLAUDE.md §5, steps 3–4):
 *   - PSS send for live, push delivery to an online recipient node.
 *   - Per-recipient Swarm feed write for store-and-forward, so an OFFLINE
 *     recipient still picks the message up later.
 *
 * The transport is an INJECTABLE interface so the crypto + envelope + message
 * flows are unit-testable without a live Bee node ({@link InMemoryTransport}).
 * The real {@link BeeTransport} needs a writeable full Bee node + a postage
 * batch and therefore can't run in CI here — it's kept thin and clearly
 * structured for activation in the apps.
 */
import { Bee, Utils } from '@ethersphere/bee-js';
import { keccak256, toHex, type Address } from 'viem';
import type { Envelope, MessageKind } from './envelope.js';

/** Trims an overlay address to the longest PSS target prefix Bee accepts. */
const { makeMaxTarget } = Utils;

/** Direction of a message, used to derive distinct topics per flow. */
export type Direction = 'buyer-to-seller' | 'seller-to-buyer';

/** Map a message kind to its direction (kept in one place). */
export function directionForKind(kind: MessageKind): Direction {
  return kind === 'shipping-address' ? 'buyer-to-seller' : 'seller-to-buyer';
}

/**
 * Deterministic PSS/feed topic for an order + direction. Distinct topics keep
 * buyer→seller and seller→buyer traffic from cross-contaminating, so a receiver
 * polling one direction never sees the other's messages.
 */
export function topicForOrder(orderId: string, direction: Direction): string {
  return keccak256(toHex(`freeemarket:v1:${direction}:order:${orderId}`));
}

/** Options for a {@link Transport.receive} poll. */
export interface ReceiveOptions {
  /** The address whose mailbox we're reading (the recipient). */
  recipient: Address;
  /** Optional cap on how many envelopes to return. */
  limit?: number;
}

/**
 * Pluggable transport. Implementations must, on `send`, deliver the envelope to
 * BOTH the PSS topic and the recipient's feed; on `receive`, return envelopes
 * addressed to `recipient` on `topic`.
 */
export interface Transport {
  /** Deliver an envelope to `recipient` on `topic`. Returns optional refs. */
  send(
    topic: string,
    recipient: Address,
    envelope: Envelope,
  ): Promise<{ pss?: boolean; feedRef?: string }>;
  /** Fetch envelopes waiting for `recipient` on `topic`. */
  receive(topic: string, opts: ReceiveOptions): Promise<Envelope[]>;
}

// ───────────────────────────────────────────────────────────────────────────
// InMemoryTransport — for tests and local round-trips (no Bee node needed).
// ───────────────────────────────────────────────────────────────────────────

/**
 * In-memory queue keyed by `topic` + lowercased `recipient`. Exercises full
 * send→receive round-trips for BOTH directions without a node. Not for
 * production: nothing here crosses a process boundary or expires.
 */
export class InMemoryTransport implements Transport {
  private readonly mailboxes = new Map<string, Envelope[]>();

  private key(topic: string, recipient: Address): string {
    return `${topic}::${recipient.toLowerCase()}`;
  }

  async send(
    topic: string,
    recipient: Address,
    envelope: Envelope,
  ): Promise<{ pss?: boolean; feedRef?: string }> {
    const key = this.key(topic, recipient);
    const box = this.mailboxes.get(key) ?? [];
    box.push(envelope);
    this.mailboxes.set(key, box);
    return { pss: true, feedRef: `mem:${key}:${box.length}` };
  }

  async receive(topic: string, opts: ReceiveOptions): Promise<Envelope[]> {
    const box = this.mailboxes.get(this.key(topic, opts.recipient)) ?? [];
    const out = box.slice();
    return typeof opts.limit === 'number' ? out.slice(0, opts.limit) : out;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// BeeTransport — real Swarm PSS + feed store-and-forward.
// ───────────────────────────────────────────────────────────────────────────

/** Construction options for {@link BeeTransport}. */
export interface BeeTransportOptions {
  /** Base URL of a writeable FULL Bee node (NOT a gateway — PSS needs a node). */
  beeUrl: string;
  /** Postage batch id stamping uploads. Use a SHORT-LIVED batch so ciphertext self-expires post-fulfillment (CLAUDE.md §5). */
  postageBatchId: string;
  /**
   * Feed owner to READ the store-and-forward feed from. Defaults to the
   * `recipient` passed to {@link BeeTransport.receive}. Set this when the feed
   * is written by someone other than the recipient (see `feedSigner`).
   */
  feedOwner?: Address;
  /**
   * Swarm FEED SIGNER (a 32-byte private key, or a bee-js `Signer`) enabling
   * `send` to ALSO write the envelope to a feed — the only delivery path that
   * survives an offline recipient. This is a Swarm feed key, SEPARATE from the
   * wallet key that signs the envelope: `makeFeedWriter` needs a raw key, and a
   * browser wallet never exports one. When omitted, `send` is PSS-only (see the
   * delivery-model note on the class).
   */
  feedSigner?: Uint8Array | string;
  /**
   * The RECIPIENT's Swarm OVERLAY address (hex, no `0x`), if known. PSS routes
   * toward an overlay prefix, so supplying it targets the message at the
   * recipient's actual neighbourhood instead of the wide default prefix. This is
   * a Swarm node identity — NOT an Ethereum address — so it can only come from
   * the recipient out-of-band. See {@link DEFAULT_PSS_TARGET}.
   */
  targetOverlay?: string;
  /**
   * Milliseconds to hold a PSS listen window open inside `receive`. Default 0
   * (disabled) because an on-demand listen only catches messages that arrive
   * DURING the window — it cannot replay a message the sender already pushed.
   * Use {@link BeeTransport.subscribe} for the correct persistent-listener
   * pattern; this is only a convenience for a live hand-off.
   */
  pssTimeoutMs?: number;
}

/**
 * Default PSS target prefix.
 *
 * Bee routes a PSS message toward nodes whose OVERLAY address starts with this
 * prefix, and bee-js requires a non-empty hex string of at most
 * `PSS_TARGET_HEX_LENGTH_MAX` (6) chars — an empty string throws
 * `TypeError: AddressPrefix not valid hex string` before any request is made.
 * `'00'` is the widest prefix Bee's API accepts (one byte; Bee hex-decodes the
 * target, so odd-length prefixes are rejected server-side).
 *
 * A one-byte prefix is a WIDE net, not a precise address: pass `targetOverlay`
 * whenever the recipient's overlay is known so delivery is actually targeted.
 */
export const DEFAULT_PSS_TARGET = '00';

/** Decode a feed/PSS payload into an Envelope, or null if it isn't one. */
function parseEnvelope(bytes: Uint8Array): Envelope | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Envelope;
    return value && typeof value === 'object' && 'sig' in value ? value : null;
  } catch {
    return null;
  }
}

/**
 * Real transport over `@ethersphere/bee-js`. Requires a writeable full Bee node
 * + postage batch (same caveat as the CMS). Not exercised in CI — it needs live
 * infrastructure — so the delivery model is spelled out here instead.
 *
 * DELIVERY MODEL (read this before relying on it):
 *
 *   - `send` ALWAYS does the PSS push. PSS is a PUSH channel: it reaches a node
 *     that is subscribed to the topic AT THAT MOMENT. There is no replay.
 *   - `send` ALSO writes the envelope to a Swarm feed when `feedSigner` is
 *     configured. This is the ONLY path that survives an offline recipient, and
 *     it is what `receive` reads back.
 *   - `receive` reads the feed (owner = `feedOwner ?? recipient`), and
 *     optionally holds a short PSS listen window when `pssTimeoutMs > 0`.
 *
 * So for a message to be readable LATER — the actual product flow, where the
 * seller opens the CMS hours after the buyer checked out — a feed write must
 * happen. Either configure `feedSigner` on the sender, or run a persistent
 * listener on the recipient's node via {@link BeeTransport.subscribe} that
 * writes what it hears into a feed the recipient owns. With neither, `send` and
 * `receive` cannot meet except by coincidence of timing.
 */
export class BeeTransport implements Transport {
  private readonly bee: Bee;
  private readonly postageBatchId: string;
  private readonly feedOwner?: Address;
  private readonly feedSigner?: Uint8Array | string;
  private readonly target: string;
  private readonly pssTimeoutMs: number;

  constructor(opts: BeeTransportOptions) {
    this.bee = new Bee(opts.beeUrl);
    this.postageBatchId = opts.postageBatchId;
    this.feedOwner = opts.feedOwner;
    this.feedSigner = opts.feedSigner;
    // makeMaxTarget trims an overlay to the longest prefix Bee accepts (6 hex).
    this.target = opts.targetOverlay
      ? makeMaxTarget(opts.targetOverlay.replace(/^0x/i, ''))
      : DEFAULT_PSS_TARGET;
    this.pssTimeoutMs = opts.pssTimeoutMs ?? 0;
  }

  async send(
    topic: string,
    _recipient: Address,
    envelope: Envelope,
  ): Promise<{ pss?: boolean; feedRef?: string }> {
    const data = new TextEncoder().encode(JSON.stringify(envelope));

    // 1. PSS push — live delivery to a currently-subscribed recipient node.
    await this.bee.pssSend(this.postageBatchId, topic, this.target, data);

    // 2. Feed write — store-and-forward, so an OFFLINE recipient can still read
    //    it later. Only possible with a raw Swarm feed key (see `feedSigner`).
    let feedRef: string | undefined;
    if (this.feedSigner) {
      const upload = await this.bee.uploadData(this.postageBatchId, data);
      const writer = this.bee.makeFeedWriter('sequence', topic, this.feedSigner);
      const update = await writer.upload(this.postageBatchId, upload.reference);
      feedRef = update.reference.toString();
    }

    return { pss: true, feedRef };
  }

  async receive(topic: string, opts: ReceiveOptions): Promise<Envelope[]> {
    const out: Envelope[] = [];

    // 1. Store-and-forward read: whoever owns the feed for this topic.
    const owner = this.feedOwner ?? opts.recipient;
    try {
      const reader = this.bee.makeFeedReader('sequence', topic, owner);
      const latest = await reader.download();
      const bytes = await this.bee.downloadData(latest.reference);
      const envelope = parseEnvelope(bytes);
      if (envelope) out.push(envelope);
    } catch {
      // No feed update yet (nothing buffered for this topic).
    }

    // 2. Optional live PSS window. Off by default — it only catches messages
    //    that arrive WHILE we wait, so it cannot recover an earlier push.
    if (this.pssTimeoutMs > 0) {
      try {
        const data = await this.bee.pssReceive(topic, this.pssTimeoutMs);
        const envelope = parseEnvelope(data);
        if (envelope) out.push(envelope);
      } catch {
        // Timed out with nothing on the wire — normal.
      }
    }

    return typeof opts.limit === 'number' ? out.slice(0, opts.limit) : out;
  }

  /**
   * Persistent PSS listener — the CORRECT way to receive pushed messages.
   *
   * `receive` is a poll; PSS is a push, so a node must already be subscribed
   * when the sender fires. Run this for the lifetime of the recipient's app (or
   * a small always-on service beside their Bee node) and persist what it hears.
   *
   * @returns an unsubscribe handle; call `cancel()` to stop listening.
   */
  subscribe(
    topic: string,
    handler: (envelope: Envelope) => void,
  ): { cancel: () => void } {
    const sub = this.bee.pssSubscribe(topic, {
      onMessage: (message) => {
        const envelope = parseEnvelope(message);
        if (envelope) handler(envelope);
      },
      onError: () => {
        /* transport-level error; the caller re-subscribes if it cares */
      },
    });
    return { cancel: () => sub.cancel() };
  }
}
