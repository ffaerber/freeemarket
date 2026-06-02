/**
 * Swarm postage-batch MANAGEMENT for the CMS (docs/POSTAGE.md).
 *
 * FreeMarket stamps two kinds of data with OPPOSITE lifetimes:
 *   - STORAGE  — durable product images + metadata (alive as long as the shop).
 *   - MESSAGING — ephemeral PSS ciphertext (self-expires after fulfillment).
 *
 * This module is split in two on purpose:
 *   1. PURE helpers (sizing presets, duration/health formatting, defensive
 *      batch normalization) — no Bee import, unit-tested in postage.test.mjs.
 *   2. THIN Bee wrappers (list/get/create/top-up/dilute/ensure) that take a
 *      `bee` instance as a parameter — they need a LIVE writeable full Bee node
 *      and so can't run in CI (same posture as packages/messaging's BeeTransport).
 *
 * WHO PAYS: postage is bought by the Bee NODE's own BZZ wallet via the node API,
 * NOT the connected MetaMask wallet (that's only for Gnosis escrow). So create/
 * top-up/dilute are node calls with no on-chain signature — fund the node's
 * wallet with xBZZ first. Because they spend real funds, the Storage tab puts
 * every one behind an explicit button.
 */

// ───────────────────────────────────────────────────────────────────────────
// PURE: sizing presets
// ───────────────────────────────────────────────────────────────────────────

/**
 * Per-purpose batch sizing. `depth` sets capacity (2^depth chunks; Bee's minimum
 * usable depth is 17). `amount` is the per-chunk balance in PLUR and drives TTL
 * (amount ÷ current storage price). These are CONSERVATIVE starting points — the
 * real remaining duration is shown in the Storage tab after creation, and TTL is
 * relative to the live storage price, so tune them for your catalog + the market.
 *
 * - storage: larger capacity + high balance ⇒ durable; MUTABLE so it can be
 *   reused/topped up as the catalog grows.
 * - messaging: minimum capacity + low balance ⇒ cheap + short, so the encrypted
 *   ciphertext self-expires after fulfillment (CLAUDE.md §5).
 */
export const BATCH_PRESETS = {
  storage: {
    purpose: 'storage',
    label: 'freemarket-storage',
    depth: 22,
    amount: '2000000000',
    immutable: false,
    description: 'Durable — product images + metadata. Top up to keep the shop alive.',
  },
  messaging: {
    purpose: 'messaging',
    label: 'freemarket-messaging',
    depth: 17,
    amount: '200000000',
    immutable: false,
    description: 'Ephemeral — PSS ciphertext that self-expires after fulfillment.',
  },
};

/** The two purposes, in display order. */
export const BATCH_PURPOSES = ['storage', 'messaging'];

// ───────────────────────────────────────────────────────────────────────────
// PURE: duration + health formatting
// ───────────────────────────────────────────────────────────────────────────

/**
 * Format a remaining-TTL in seconds as a compact human string.
 * Bee uses -1 for an unlimited/unknown TTL; <= 0 (other than -1) ⇒ "expired".
 * @param {number} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (seconds === -1) return 'unlimited';
  if (!Number.isFinite(seconds) || seconds <= 0) return 'expired';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

/** Default health thresholds (seconds): < 1d critical, < 7d warn. */
export const DEFAULT_HEALTH_THRESHOLDS = { criticalSeconds: 86400, warnSeconds: 604800 };

/**
 * Classify a batch's remaining life into a health level for the UI badge.
 * 'unlimited' (ttl === -1) is treated as 'ok'.
 * @param {number} ttlSeconds
 * @param {{ criticalSeconds?: number, warnSeconds?: number }} [thresholds]
 * @returns {'ok'|'warn'|'critical'|'expired'}
 */
export function classifyHealth(ttlSeconds, thresholds = DEFAULT_HEALTH_THRESHOLDS) {
  const { criticalSeconds, warnSeconds } = { ...DEFAULT_HEALTH_THRESHOLDS, ...thresholds };
  if (ttlSeconds === -1) return 'ok';
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return 'expired';
  if (ttlSeconds < criticalSeconds) return 'critical';
  if (ttlSeconds < warnSeconds) return 'warn';
  return 'ok';
}

// ───────────────────────────────────────────────────────────────────────────
// PURE: defensive normalization
// ───────────────────────────────────────────────────────────────────────────

/** Coerce a value that may be a string or a typed wrapper (toHex/toString). */
function asString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v.toHex === 'function') return v.toHex();
  if (typeof v.toPLURString === 'function') return v.toPLURString();
  return String(v);
}

/** Coerce a TTL/duration field that may be a number or a Duration wrapper. */
function asSeconds(v) {
  if (typeof v === 'number') return v;
  if (v && typeof v.toSeconds === 'function') return v.toSeconds();
  if (v && typeof v.seconds === 'number') return v.seconds;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Normalize a bee-js `PostageBatch` (whose shape has shifted across versions)
 * into a stable, UI-friendly object. Reads fields defensively so a minor rename
 * doesn't break the dashboard.
 * @param {Record<string, unknown>} raw
 * @returns {{
 *   batchID: string, depth: number, bucketDepth: number, amount: string,
 *   immutable: boolean, ttlSeconds: number, usage: number, usable: boolean,
 *   label: string, exists: boolean,
 * } | null}
 */
export function normalizeBatch(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const r = /** @type {Record<string, any>} */ (raw);
  const batchID = asString(r.batchID ?? r.batchId ?? r.id);
  const depth = Number(r.depth ?? 0);
  const bucketDepth = Number(r.bucketDepth ?? 16);
  const ttlSeconds = asSeconds(r.batchTTL ?? r.duration ?? r.ttl);

  // usage in [0,1]: prefer an explicit field, else derive from utilization vs the
  // batch's effective bucket capacity (2^(depth - bucketDepth)).
  let usage = Number(r.usage);
  if (!Number.isFinite(usage)) {
    const utilization = Number(r.utilization);
    const capacity = depth > bucketDepth ? 2 ** (depth - bucketDepth) : 0;
    usage = capacity > 0 && Number.isFinite(utilization) ? utilization / capacity : 0;
  }
  usage = Math.min(1, Math.max(0, Number.isFinite(usage) ? usage : 0));

  return {
    batchID,
    depth,
    bucketDepth,
    amount: asString(r.amount),
    immutable: Boolean(r.immutableFlag ?? r.immutable ?? false),
    ttlSeconds,
    usage,
    usable: Boolean(r.usable ?? true),
    label: asString(r.label),
    exists: Boolean(r.exists ?? true),
  };
}

/**
 * Find the first USABLE normalized batch whose label matches `label`. Used by
 * auto-create to reuse an existing node batch before buying a new one.
 * @param {ReturnType<typeof normalizeBatch>[]} batches
 * @param {string} label
 * @returns {ReturnType<typeof normalizeBatch> | null}
 */
export function findUsableByLabel(batches, label) {
  for (const b of batches || []) {
    if (b && b.usable && b.exists && b.label === label) return b;
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────────────
// THIN Bee wrappers — need a LIVE writeable full Bee node (not exercised in CI).
// Each takes a `bee` instance (from src/lib/swarmWrite.js makeBee) so this module
// imports nothing and stays purely unit-testable above.
// ───────────────────────────────────────────────────────────────────────────

/**
 * List all postage batches the node owns, normalized.
 * @param {import('@ethersphere/bee-js').Bee} bee
 * @returns {Promise<ReturnType<typeof normalizeBatch>[]>}
 */
export async function listBatches(bee) {
  const raw = await bee.getAllPostageBatch();
  return (raw || []).map(normalizeBatch).filter(Boolean);
}

/**
 * Fetch + normalize a single batch, or null if it doesn't exist.
 * @param {import('@ethersphere/bee-js').Bee} bee
 * @param {string} batchId
 * @returns {Promise<ReturnType<typeof normalizeBatch> | null>}
 */
export async function getBatch(bee, batchId) {
  if (!batchId) return null;
  try {
    return normalizeBatch(await bee.getPostageBatch(batchId));
  } catch {
    return null; // not found on this node / not yet propagated.
  }
}

/**
 * Buy a new batch sized by a {@link BATCH_PRESETS} preset. Spends the NODE's BZZ.
 * Waits for the batch to become usable before returning its id.
 * @param {import('@ethersphere/bee-js').Bee} bee
 * @param {typeof BATCH_PRESETS.storage} preset
 * @returns {Promise<string>} the new batch id
 */
export async function createBatch(bee, preset) {
  if (!preset || !preset.amount || !preset.depth) {
    throw new Error('createBatch: a sizing preset with { amount, depth } is required');
  }
  const id = await bee.createPostageBatch(String(preset.amount), preset.depth, {
    label: preset.label,
    immutableFlag: Boolean(preset.immutable),
    waitForUsable: true,
  });
  return asString(id);
}

/**
 * Top up a batch's per-chunk balance — EXTENDS its TTL (keeps content alive).
 * @param {import('@ethersphere/bee-js').Bee} bee
 * @param {string} batchId
 * @param {string|number|bigint} amount additional PLUR per chunk
 * @returns {Promise<void>}
 */
export async function topUpBatch(bee, batchId, amount) {
  if (!batchId) throw new Error('topUpBatch: batchId is required');
  await bee.topUpBatch(batchId, String(amount));
}

/**
 * Dilute a batch — raise its `depth` to ADD CAPACITY (it can store more chunks).
 * Diluting halves the effective per-chunk balance, so TTL drops; top up after if
 * needed. New depth must be greater than the current depth.
 * @param {import('@ethersphere/bee-js').Bee} bee
 * @param {string} batchId
 * @param {number} depth the new, larger depth
 * @returns {Promise<void>}
 */
export async function diluteBatch(bee, batchId, depth) {
  if (!batchId) throw new Error('diluteBatch: batchId is required');
  await bee.diluteBatch(batchId, Number(depth));
}

/**
 * Resolve a USABLE batch id for `purpose`, creating one only if needed:
 *   1. if `configuredId` is still usable on this node, reuse it;
 *   2. else reuse an existing node batch whose label matches the preset;
 *   3. else BUY one with the preset (spends node BZZ).
 * Returns the resolved id. Never buys when steps 1–2 succeed.
 * @param {import('@ethersphere/bee-js').Bee} bee
 * @param {'storage'|'messaging'} purpose
 * @param {string} [configuredId] the env-configured batch id, if any
 * @returns {Promise<string>}
 */
export async function ensureBatch(bee, purpose, configuredId) {
  const preset = BATCH_PRESETS[purpose];
  if (!preset) throw new Error(`ensureBatch: unknown purpose "${purpose}"`);

  if (configuredId) {
    const existing = await getBatch(bee, configuredId);
    if (existing && existing.usable && existing.exists) return existing.batchID || configuredId;
  }
  const all = await listBatches(bee);
  const match = findUsableByLabel(all, preset.label);
  if (match) return match.batchID;

  return createBatch(bee, preset);
}
