/**
 * Swarm WRITE helpers for the CMS — the merchant-only counterpart to the
 * read-only path the storefront uses.
 *
 * The storefront only DOWNLOADS metadata/images from Swarm (a gateway is fine
 * for that). The CMS must UPLOAD shop profiles, listing metadata, and images,
 * which on Swarm requires:
 *   1. A real, WRITEABLE Bee node (NOT a public gateway — gateways are read-only
 *      and reject uploads). Default VITE_BEE_URL is http://localhost:1633.
 *   2. A postage batch ("stamp") to pay for storage. Without one, uploads are
 *      disabled and the UI surfaces a warning (CLAUDE.md §5).
 *
 * Buying a batch is intentionally NOT required by this module — operators get
 * one out-of-band (see `createPostageBatch` note below) and paste its id into
 * VITE_POSTAGE_BATCH_ID. We expose a thin wrapper for convenience but never
 * call it implicitly.
 */
import { Bee } from '@ethersphere/bee-js';

/**
 * Construct a Bee client for the configured node.
 * @param {string} beeUrl base Bee node URL (must be writeable for uploads)
 * @returns {import('@ethersphere/bee-js').Bee}
 */
export function makeBee(beeUrl) {
  if (!beeUrl || typeof beeUrl !== 'string') {
    throw new Error('makeBee: beeUrl is required');
  }
  return new Bee(beeUrl);
}

/** Guard shared by the upload helpers. */
function requireStamp(postageBatchId) {
  if (!postageBatchId || typeof postageBatchId !== 'string') {
    throw new Error(
      'Swarm upload requires a postage batch id (VITE_POSTAGE_BATCH_ID). ' +
        'Uploads are disabled until one is configured — see CLAUDE.md §5.',
    );
  }
}

/**
 * Upload a JSON-serializable object to Swarm and return its reference.
 * Used for ShopProfile and ListingMetadata documents.
 * @param {import('@ethersphere/bee-js').Bee} bee
 * @param {string} postageBatchId the stamp paying for storage
 * @param {unknown} obj a JSON-serializable object
 * @returns {Promise<string>} bare Swarm reference (64-char hex)
 */
export async function uploadJson(bee, postageBatchId, obj) {
  requireStamp(postageBatchId);
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const result = await bee.uploadData(postageBatchId, bytes);
  // bee-js returns an object with a `.reference` (UploadResult); normalize to a
  // plain string regardless of the wrapper type.
  return String(result.reference ?? result);
}

/**
 * Upload a File/Blob (e.g. an image) to Swarm and return its reference.
 * @param {import('@ethersphere/bee-js').Bee} bee
 * @param {string} postageBatchId the stamp paying for storage
 * @param {File|Blob} file the file to upload
 * @returns {Promise<string>} bare Swarm reference (64-char hex)
 */
export async function uploadFile(bee, postageBatchId, file) {
  requireStamp(postageBatchId);
  const name = file.name || 'upload';
  const contentType = file.type || 'application/octet-stream';
  // bee-js accepts ArrayBuffer/Uint8Array; read the File into bytes first so it
  // works uniformly across browser File and Blob inputs.
  const buf = new Uint8Array(await file.arrayBuffer());
  const result = await bee.uploadFile(postageBatchId, buf, name, {
    contentType,
  });
  return String(result.reference ?? result);
}

/**
 * Optional low-level convenience: buy a postage batch so uploads can proceed. NOT
 * called automatically. The MANAGED path now lives in `src/lib/postage.js` (sizing
 * presets, auto-create, top-up/dilute) surfaced by the CMS "Storage" tab; prefer
 * that. This thin wrapper stays for ad-hoc/scripted use. See docs/POSTAGE.md.
 *
 * `amount` is the per-chunk balance (in PLUR) and `depth` sets capacity
 * (2^depth chunks); see Bee docs for sizing. Returns the new batch id to paste
 * into VITE_POSTAGE_BATCH_ID.
 * @param {import('@ethersphere/bee-js').Bee} bee
 * @param {string|bigint|number} amount
 * @param {number} depth
 * @returns {Promise<string>} the postage batch id
 */
export async function createPostageBatch(bee, amount, depth) {
  const id = await bee.createPostageBatch(String(amount), depth);
  return String(id);
}
