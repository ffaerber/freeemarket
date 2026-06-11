#!/usr/bin/env node
/**
 * FreeeMarket — per-shop Swarm + ENS deploy pipeline (CLAUDE.md §8, build step #7).
 *
 * Implements the four-step flow from the spec as a REAL, runnable pipeline:
 *
 *   1. (optional) Build the storefront with the shop's env baked in at build
 *      time (VITE_MARKETPLACE_ADDRESS, VITE_SELLER, VITE_RPC_URL, VITE_BEE_URL,
 *      VITE_CONTACT_REGISTRY, VITE_POSTAGE_BATCH_ID, …). The storefront is
 *      per-shop: each shop is its own static build + ENS + Swarm address, all
 *      pointing at the SAME shared Marketplace escrow contract on Gnosis.
 *
 *   2. Upload the built `dist/` to Swarm via a writeable Bee node as a website
 *      collection (with index + error document) → get the raw content reference.
 *
 *   3. Write/refresh a Swarm FEED owned by the deployer's feed key, pointing at
 *      that content reference → get the FEED MANIFEST reference. ENS points at
 *      the *feed manifest* (a stable address), NOT the raw content hash, so
 *      future site updates just re-write the feed and ENS is never touched again
 *      (no mainnet tx per update).
 *
 *   4. Encode `bzz://<feedManifest>` as an EIP-1577 contenthash and either set
 *      it on mainnet ENS (only when explicitly opted in) or print the exact
 *      value + copy-paste instructions. Default is PRINT-ONLY — ENS lives on
 *      MAINNET with real ETH costs, so we never silently broadcast.
 *
 * House style mirrors `contracts/script/Deploy.s.sol`: env-driven, dry-run /
 * print-only by default, every knob documented, secrets are runtime-only and
 * never logged.
 *
 * ## Configuration (env)
 *
 *   Build (step 1):
 *     BUILD=1                Run `npm run build` in the storefront before upload.
 *                            When unset, a prebuilt DIST_DIR is required instead.
 *     STOREFRONT_DIR         Storefront app dir (default: ../apps/storefront).
 *     DIST_DIR               Prebuilt dist to upload (default: <STOREFRONT_DIR>/dist).
 *     VITE_*                 Any VITE_-prefixed var is passed through to the
 *                            build and baked in (per-shop config).
 *
 *   Swarm (steps 2–3):
 *     BEE_URL                Writeable Bee node base URL (default http://localhost:1633).
 *                            Must be a FULL node, not a gateway — uploads + feeds
 *                            need write access.
 *     POSTAGE_BATCH_ID       REQUIRED. Funded postage batch ("stamp") to pay for
 *                            the upload + feed chunks. Per-node; not a long-term
 *                            secret but keep it out of git.
 *     FEED_PRIVATE_KEY       REQUIRED. The Swarm FEED owner key (0x + 64 hex).
 *                            This is a *Swarm feed key*, SEPARATE from any wallet
 *                            or ENS key — it only signs feed updates. Whoever
 *                            holds it controls future site updates for this shop,
 *                            so back it up. NEVER committed or logged.
 *                            (Alias: FEED_SIGNER.)
 *     FEED_TOPIC             Feed topic label (default "freemarket-storefront").
 *                            Same owner + topic = same stable feed/ENS address,
 *                            so keep it constant across redeploys of one shop.
 *
 *   ENS (step 4):
 *     ENS_NAME               e.g. "shopname.eth". Required to print the namehash
 *                            + the .eth.limo URL; required for a live set.
 *     ENS_RPC_URL            Mainnet RPC (ENS is on MAINNET regardless of the
 *                            escrow chain). Needed only for a live set.
 *     ENS_PRIVATE_KEY        Mainnet key with ETH, the ENS name's controller /
 *                            resolver manager. Needed only for a live set.
 *                            NEVER committed or logged.
 *     ENS_RESOLVER           Optional explicit resolver address. When unset and
 *                            doing a live set, the script resolves it on-chain.
 *     CONFIRM_MAINNET=1      Opt-in gate. WITHOUT this, the script is print-only
 *                            even if ENS_PRIVATE_KEY + ENS_RPC_URL are present.
 *
 * ## Usage
 *
 *   Dry run / print-only (no mainnet tx) — the default:
 *     POSTAGE_BATCH_ID=… FEED_PRIVATE_KEY=… ENS_NAME=shop.eth \
 *       VITE_MARKETPLACE_ADDRESS=0x… VITE_SELLER=0x… BUILD=1 \
 *       node scripts/deploy-frontend.mjs
 *
 *   Live ENS set (explicit opt-in):
 *     … ENS_RPC_URL=https://eth.example ENS_PRIVATE_KEY=0x… CONFIRM_MAINNET=1 \
 *       node scripts/deploy-frontend.mjs
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import * as contentHash from '@ensdomains/content-hash';
import { Bee } from '@ethersphere/bee-js';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http, namehash } from 'viem';
import { mainnet } from 'viem/chains';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing — no I/O, no secrets).
// ---------------------------------------------------------------------------

/**
 * Encode a Swarm feed-manifest reference as an EIP-1577 ENS contenthash.
 *
 * ENS `contenthash` for Swarm uses multicodec `swarm-ns` wrapping a CIDv1 with
 * the `swarm-manifest` codec + `keccak-256` multihash. @ensdomains/content-hash
 * emits exactly the EIP-1577 swarm prefix `0xe40101fa011b20` followed by the
 * 32-byte reference. We point ENS at the FEED MANIFEST (a stable address) so the
 * site can be updated by re-writing the feed without ever re-touching ENS.
 *
 * @param {string} feedManifest 32-byte Swarm reference, hex (with or without 0x).
 * @returns {string} `0x`-prefixed contenthash bytes.
 */
export function encodeSwarmContenthash(feedManifest) {
  const hex = stripHex(feedManifest).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(
      `feed manifest must be a 32-byte hex reference (64 hex chars); got ${hex.length} chars`,
    );
  }
  // content-hash returns the bytes WITHOUT a 0x prefix; ENS resolvers + tooling
  // expect the 0x form, so normalise here.
  return '0x' + contentHash.encode('swarm', hex);
}

/**
 * Inverse of {@link encodeSwarmContenthash} — pull the 32-byte Swarm reference
 * back out of an EIP-1577 contenthash. Used by the unit test to assert a clean
 * round-trip, and handy for verifying a value before pasting it into ENS.
 *
 * @param {string} hash `0x`-prefixed (or bare) contenthash bytes.
 * @returns {string} the bare 32-byte hex reference.
 */
export function decodeSwarmContenthash(hash) {
  return contentHash.decode(stripHex(hash));
}

/** Strip a leading `0x`/`0X` if present. */
export function stripHex(s) {
  return String(s).replace(/^0x/i, '');
}

/** Build the `<name>.eth.limo` gateway URL for an ENS name. */
export function ethLimoUrl(ensName) {
  return `https://${ensName.replace(/\.$/, '')}.limo`;
}

// ---------------------------------------------------------------------------
// Small env / logging utilities.
// ---------------------------------------------------------------------------

/** Trimmed env getter that treats empty strings as unset (matches Deploy.s.sol). */
function env(key, fallback = undefined) {
  const v = process.env[key];
  return v != null && String(v).trim() !== '' ? String(v).trim() : fallback;
}

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

const log = (...a) => console.log(...a);
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

/** Mask a secret for the rare case we must acknowledge its presence (never the value). */
function redacted(present) {
  return present ? '(set — redacted)' : '(unset)';
}

// ---------------------------------------------------------------------------
// Step 1 — (optional) build the storefront with the shop's env baked in.
// ---------------------------------------------------------------------------

function buildStorefront(storefrontDir) {
  step(1, `Building storefront (vite build) in ${storefrontDir}`);
  if (!existsSync(join(storefrontDir, 'package.json'))) {
    fail(`STOREFRONT_DIR has no package.json: ${storefrontDir}`);
  }

  // Pass through every VITE_* var so the per-shop config is baked into the
  // static build. We log the KEYS (not values) so the operator can confirm the
  // shop config without us echoing anything sensitive.
  const viteKeys = Object.keys(process.env).filter((k) => k.startsWith('VITE_'));
  log('    baking in VITE_ vars:', viteKeys.length ? viteKeys.join(', ') : '(none)');

  const res = spawnSync('npm', ['run', 'build'], {
    cwd: storefrontDir,
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    fail(`storefront build failed (exit ${res.status ?? 'signal ' + res.signal})`);
  }
  log('    ✓ build complete');
}

// ---------------------------------------------------------------------------
// Step 2 — upload dist/ to Swarm as a website collection.
// ---------------------------------------------------------------------------

async function uploadDist(bee, batchId, distDir, beeUrl) {
  step(2, `Uploading ${distDir} to Swarm as a website collection`);

  // Probe the node FIRST with an awaitable health check. bee-js's directory
  // upload kicks off internal requests whose rejections don't always attach to
  // the returned promise, so an unreachable node can surface as a raw unhandled
  // rejection mid-upload. Checking connectivity here turns "node down / wrong
  // URL / gateway-not-a-node" into one clear, catchable error before we start.
  try {
    await bee.checkConnection();
  } catch (e) {
    fail(
      `cannot reach a writeable Bee node at ${beeUrl}.\n` +
        `  Steps 2–3 (upload + feed) need a FULL Bee node (not a gateway), running\n` +
        `  and reachable. Set BEE_URL to your node (e.g. http://localhost:1633).\n` +
        `  Underlying error: ${e.message}`,
    );
  }

  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    fail(
      `DIST_DIR not found or not a directory: ${distDir}\n` +
        `  Run with BUILD=1 to build first, or point DIST_DIR at a prebuilt dist/.`,
    );
  }
  if (!existsSync(join(distDir, 'index.html'))) {
    fail(`no index.html in ${distDir} — is this a built storefront dist/?`);
  }

  // indexDocument: served for the collection root and SPA-friendly fallbacks.
  // errorDocument: an SPA has no server, so route 404s back to index.html so
  // client-side routing/deep links still resolve.
  const result = await bee.uploadFilesFromDirectory(batchId, distDir, {
    indexDocument: 'index.html',
    errorDocument: 'index.html',
  });
  const contentRef = result.reference.toString();
  log(`    ✓ content reference: ${contentRef}`);
  return contentRef;
}

// ---------------------------------------------------------------------------
// Step 3 — write the Swarm feed → get the stable FEED MANIFEST reference.
// ---------------------------------------------------------------------------

async function updateFeed(bee, batchId, feedPrivateKey, topicLabel, contentRef) {
  step(3, `Updating Swarm feed (topic "${topicLabel}") → feed manifest`);

  // The feed is owned by FEED_PRIVATE_KEY; its owner address + topic uniquely
  // determine the stable feed/ENS address. We derive the owner from the key via
  // viem (never logging the key), and hash the human topic label into a 32-byte
  // feed topic.
  const owner = privateKeyToAccount(
    feedPrivateKey.startsWith('0x') ? feedPrivateKey : `0x${feedPrivateKey}`,
  ).address;
  const topic = bee.makeFeedTopic(topicLabel);

  // The feed MANIFEST is a Swarm reference that resolves the latest feed update.
  // It is derived purely from (type, topic, owner) — i.e. it is STABLE across
  // updates. This is the address ENS should point at: re-writing the feed below
  // changes what it resolves to WITHOUT changing the manifest, so ENS is touched
  // exactly once (at first deploy), never again.
  const manifest = await bee.createFeedManifest(batchId, 'sequence', topic, owner);
  const feedManifest = manifest.reference.toString();
  log(`    feed owner   : ${owner}`);
  log(`    feed manifest: ${feedManifest}  (← the stable ENS target)`);

  // Write the actual update: point this feed at the freshly-uploaded content.
  const writer = bee.makeFeedWriter('sequence', topic, feedPrivateKey);
  const update = await writer.upload(batchId, contentRef);
  log(`    ✓ feed updated → ${contentRef}  (update ref ${update.reference.toString()})`);

  return feedManifest;
}

// ---------------------------------------------------------------------------
// Step 4 — encode the ENS contenthash, then set-on-mainnet OR print-only.
// ---------------------------------------------------------------------------

// Minimal ENS ABIs (viem) — registry `resolver(node)` + public resolver
// `setContenthash(node, hash)`. We never embed addresses; the registry is the
// canonical mainnet ENS registry, resolver is looked up on-chain (overridable).
const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'resolver',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
];
const RESOLVER_ABI = [
  {
    type: 'function',
    name: 'setContenthash',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'hash', type: 'bytes' },
    ],
    outputs: [],
  },
];

async function handleEns(feedManifest, ensName) {
  step(4, 'Encoding ENS contenthash');
  const ch = encodeSwarmContenthash(feedManifest);
  log(`    contenthash: ${ch}`);

  if (!ensName) {
    log('\n    ENS_NAME not set — skipping namehash / set instructions.');
    log('    Set ENS_NAME=shopname.eth to get the exact value + instructions to');
    log('    paste into the ENS manager, or for a live set.');
    return { contenthash: ch, set: false };
  }

  const node = namehash(ensName);
  log(`    ens name   : ${ensName}`);
  log(`    namehash   : ${node}`);

  const ensRpc = env('ENS_RPC_URL');
  const ensKeyPresent = !!env('ENS_PRIVATE_KEY');
  const confirm = env('CONFIRM_MAINNET') === '1';

  // Print-only unless ALL of: an RPC, a key, AND the explicit CONFIRM_MAINNET=1
  // opt-in are present. ENS is on mainnet with real ETH cost — never broadcast
  // by accident.
  if (!(ensRpc && ensKeyPresent && confirm)) {
    printManualInstructions({ ensName, node, contenthash: ch, ensRpc, ensKeyPresent, confirm });
    return { contenthash: ch, set: false };
  }

  return await setContenthashOnChain({ ensName, node, contenthash: ch, ensRpc });
}

function printManualInstructions({ ensName, node, contenthash, ensRpc, ensKeyPresent, confirm }) {
  log('\n    ── PRINT-ONLY (no mainnet tx broadcast) ──');
  if (!confirm) {
    log('    CONFIRM_MAINNET is not "1" → not broadcasting. This is the safe default.');
  }
  if (!ensRpc) log('    (ENS_RPC_URL unset — required for a live set.)');
  if (!ensKeyPresent) log('    (ENS_PRIVATE_KEY unset — required for a live set.)');
  log('\n    To set the contenthash, either:');
  log(`      • In the ENS manager (https://app.ens.domains/${ensName}) → Records →`);
  log('        Content Hash, paste:');
  log(`            ${contenthash}`);
  log('      • Or call the public resolver directly:');
  log(`            resolver.setContenthash(${node}, ${contenthash})`);
  log('      • Or re-run this script with ENS_RPC_URL + ENS_PRIVATE_KEY +');
  log('        CONFIRM_MAINNET=1 to broadcast it for you.');
}

async function setContenthashOnChain({ ensName, node, contenthash, ensRpc }) {
  log('\n    ── LIVE MAINNET SET (CONFIRM_MAINNET=1) ──');
  const key = env('ENS_PRIVATE_KEY');
  const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
  const publicClient = createPublicClient({ chain: mainnet, transport: http(ensRpc) });
  const walletClient = createWalletClient({ account, chain: mainnet, transport: http(ensRpc) });

  // Resolve the name's resolver (or use an explicit override). We never log the
  // controller key — only its derived address.
  let resolver = env('ENS_RESOLVER');
  if (!resolver) {
    resolver = await publicClient.readContract({
      address: ENS_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: 'resolver',
      args: [node],
    });
  }
  if (!resolver || /^0x0+$/.test(resolver)) {
    fail(
      `no resolver set for ${ensName} on mainnet. Set a resolver in the ENS ` +
        `manager first (or pass ENS_RESOLVER=0x…).`,
    );
  }
  log(`    sender   : ${account.address}`);
  log(`    resolver : ${resolver}`);

  const hash = await walletClient.writeContract({
    address: resolver,
    abi: RESOLVER_ABI,
    functionName: 'setContenthash',
    args: [node, contenthash],
  });
  log(`    ✓ broadcast setContenthash tx: ${hash}`);
  log('    waiting for confirmation…');
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  log(`    ✓ confirmed in block ${receipt.blockNumber} (status ${receipt.status})`);
  return { contenthash, set: true, txHash: hash };
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

async function main() {
  log('== FreeeMarket storefront deploy (Swarm + ENS) ==');

  // Resolve config + validate the hard requirements up front so we fail fast
  // with a clear message rather than deep inside an upload.
  const storefrontDir = resolve(
    __dirname,
    env('STOREFRONT_DIR', '../apps/storefront'),
  );
  const distDir = env('DIST_DIR')
    ? resolve(env('DIST_DIR'))
    : join(storefrontDir, 'dist');
  const doBuild = env('BUILD') === '1';

  const beeUrl = env('BEE_URL', 'http://localhost:1633');
  const batchId = env('POSTAGE_BATCH_ID');
  const feedKey = env('FEED_PRIVATE_KEY') || env('FEED_SIGNER');
  const feedTopic = env('FEED_TOPIC', 'freemarket-storefront');
  const ensName = env('ENS_NAME');

  // --- Required-env validation (clear, actionable errors) ---
  const missing = [];
  if (!batchId) missing.push('POSTAGE_BATCH_ID (funded Swarm postage batch for the upload + feed)');
  if (!feedKey) missing.push('FEED_PRIVATE_KEY or FEED_SIGNER (Swarm feed owner key — runtime only, never commit)');
  if (missing.length) {
    fail(
      'missing required env:\n  - ' +
        missing.join('\n  - ') +
        '\n\nQuick start (dry-run / print-only — no mainnet tx):\n' +
        '  POSTAGE_BATCH_ID=<64-hex> FEED_PRIVATE_KEY=0x<64-hex> ENS_NAME=shop.eth \\\n' +
        '    DIST_DIR=apps/storefront/dist BEE_URL=http://localhost:1633 \\\n' +
        '    node scripts/deploy-frontend.mjs\n\n' +
        'See the header of this file (or docs/DEPLOY.md) for every option.',
    );
  }
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(feedKey)) {
    fail('FEED_PRIVATE_KEY must be a 32-byte hex private key (0x + 64 hex chars).');
  }

  // --- Plan summary (no secrets) ---
  log('\nplan:');
  log(`  build           : ${doBuild ? 'yes (vite build)' : 'no (use prebuilt DIST_DIR)'}`);
  log(`  storefront dir  : ${storefrontDir}`);
  log(`  dist dir        : ${distDir}`);
  log(`  bee node        : ${beeUrl}`);
  log(`  postage batch   : ${redacted(!!batchId)}`);
  log(`  feed key        : ${redacted(!!feedKey)}`);
  log(`  feed topic      : ${feedTopic}`);
  log(`  ens name        : ${ensName ?? '(unset — print contenthash only)'}`);
  log(`  ens set mode    : ${
    env('CONFIRM_MAINNET') === '1' && env('ENS_RPC_URL') && env('ENS_PRIVATE_KEY')
      ? 'LIVE mainnet set (CONFIRM_MAINNET=1)'
      : 'print-only (safe default)'
  }`);

  // 1 — build (optional)
  if (doBuild) {
    buildStorefront(storefrontDir);
  }

  // Connect to Bee. Construct lazily so a missing/unreachable node surfaces at
  // the upload call with a clear network error (not an opaque construction one).
  const bee = new Bee(beeUrl);

  // 2 — upload dist
  let contentRef;
  try {
    contentRef = await uploadDist(bee, batchId, distDir, beeUrl);
  } catch (e) {
    fail(
      `Swarm upload failed talking to ${beeUrl}.\n` +
        `  Is this a writeable FULL Bee node (not a gateway), running and reachable,\n` +
        `  with a valid funded POSTAGE_BATCH_ID? Underlying error:\n  ${e.message}`,
    );
  }

  // 3 — feed → feed manifest
  let feedManifest;
  try {
    feedManifest = await updateFeed(bee, batchId, feedKey, feedTopic, contentRef);
  } catch (e) {
    fail(`Swarm feed update failed: ${e.message}`);
  }

  // 4 — ENS contenthash (set or print)
  const ens = await handleEns(feedManifest, ensName);

  // --- Final summary ---
  log('\n== Summary ==');
  log(`  content ref   : ${contentRef}`);
  log(`  feed manifest : ${feedManifest}   (stable — ENS points here)`);
  log(`  contenthash   : ${ens.contenthash}`);
  if (ensName) {
    log(`  live URL      : ${ethLimoUrl(ensName)}   (once ENS contenthash is set + propagated)`);
  }
  if (ens.set) {
    log(`  ENS set       : YES (tx ${ens.txHash})`);
  } else {
    log('  ENS set       : NO (print-only — set it manually or re-run with CONFIRM_MAINNET=1)');
  }
  log('\n  Update flow: re-run this script (same FEED key + topic) → the feed');
  log('  re-points at the new build; the feed manifest + ENS stay untouched.');
  log('  The escrow contract stays on Gnosis; only the storefront lives on Swarm/ENS.\n');
}

// Only run the pipeline when invoked directly — importing the file (e.g. from
// the unit test) must NOT trigger I/O.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Safety net: some bee-js network errors surface as unhandled rejections that
  // don't attach to an awaited promise. Catch them so the operator always gets
  // a clear message + non-zero exit instead of a raw stack trace.
  process.on('unhandledRejection', (e) => {
    fail(`unexpected error (likely a Bee/network failure): ${e?.message || String(e)}`);
  });
  main().catch((e) => fail(e?.stack || e?.message || String(e)));
}
