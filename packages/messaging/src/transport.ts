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
import { Bee } from '@ethersphere/bee-js';
import { keccak256, toHex, type Address } from 'viem';
import type { Envelope, MessageKind } from './envelope.js';

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
  return keccak256(toHex(`freemarket:v1:${direction}:order:${orderId}`));
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
   * The recipient's feed owner address, needed to read/write the
   * store-and-forward feed. For writing the caller supplies a feed signer
   * out-of-band (the recipient's own node), so BeeTransport writes via PSS only
   * by default and reads the recipient feed when an owner is known.
   */
  feedOwner?: Address;
}

const PSS_TARGET_PREFIX = ''; // broadcast prefix; recipient pubkey targeting is optional.

/**
 * Real transport over `@ethersphere/bee-js`. Requires a writeable full Bee node
 * + postage batch (same caveat as the CMS). Kept thin; not exercised in CI
 * because it needs live infrastructure.
 *
 * NOTE on feeds: a per-recipient feed is owned + signed by the RECIPIENT's node.
 * A sender cannot write to someone else's feed, so the store-and-forward write
 * is performed by the recipient's own infra (or a shared mailbox feed the
 * recipient owns). Here `send` does the PSS push; `receive` reads the recipient
 * feed when `feedOwner` is configured. Wire feed writes in the app that owns the
 * feed key.
 */
export class BeeTransport implements Transport {
  private readonly bee: Bee;
  private readonly postageBatchId: string;
  private readonly feedOwner?: Address;

  constructor(opts: BeeTransportOptions) {
    this.bee = new Bee(opts.beeUrl);
    this.postageBatchId = opts.postageBatchId;
    this.feedOwner = opts.feedOwner;
  }

  async send(
    topic: string,
    _recipient: Address,
    envelope: Envelope,
  ): Promise<{ pss?: boolean; feedRef?: string }> {
    const data = new TextEncoder().encode(JSON.stringify(envelope));
    // PSS push to the order/direction topic for live delivery.
    await this.bee.pssSend(this.postageBatchId, topic, PSS_TARGET_PREFIX, data);
    return { pss: true };
  }

  async receive(topic: string, opts: ReceiveOptions): Promise<Envelope[]> {
    // Store-and-forward read: the recipient feed is owned by `recipient`.
    const owner = this.feedOwner ?? opts.recipient;
    try {
      const reader = this.bee.makeFeedReader('sequence', topic, owner);
      const latest = await reader.download();
      const bytes = await this.bee.downloadData(latest.reference);
      const envelope = JSON.parse(new TextDecoder().decode(bytes)) as Envelope;
      return [envelope];
    } catch {
      // No feed update yet (offline recipient with nothing buffered).
      return [];
    }
  }
}
