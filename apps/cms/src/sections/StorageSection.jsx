/**
 * StorageSection — Swarm postage-batch manager (docs/POSTAGE.md).
 *
 * The seller's back-office for the TWO batches FreeMarket uses:
 *   - STORAGE   (durable)   — product images + metadata; keep alive via top-up.
 *   - MESSAGING (ephemeral) — PSS ciphertext that self-expires after fulfillment.
 *
 * For each, this shows the configured id + the live on-node batch (depth, usage,
 * remaining duration with a health badge) and offers Create / Top up / Add
 * capacity. All writes hit the Bee NODE's API and spend the NODE's BZZ wallet
 * (NOT MetaMask — that's only for Gnosis escrow); fund the node with xBZZ first.
 *
 * A newly-created batch id is shown so the operator can paste it into
 * VITE_STORAGE_BATCH_ID / VITE_MESSAGING_BATCH_ID. Even without that, auto-create
 * (ensureBatch) reuses a batch by its preset label on the next run.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { HardDrive, RefreshCw, PlusCircle, ArrowUpCircle, Maximize2 } from 'lucide-react';
import { makeBee } from '../lib/swarmWrite.js';
import {
  BATCH_PRESETS,
  formatDuration,
  classifyHealth,
  getBatch,
  listBatches,
  createBatch,
  topUpBatch,
  diluteBatch,
} from '../lib/postage.js';
import { BEE_URL, STORAGE_BATCH_ID, MESSAGING_BATCH_ID } from '../config.js';
import {
  Card, Field, Input, Button, GhostButton, SectionHeader, Banner, ErrorNote,
} from '../ui.jsx';

const HEALTH_COLORS = {
  ok: '#7CE3C4',
  warn: '#FFB454',
  critical: '#ff6b6b',
  expired: '#ff6b6b',
};

/** Small colored health badge driven by classifyHealth. */
function HealthBadge({ ttlSeconds }) {
  const level = classifyHealth(ttlSeconds);
  const color = HEALTH_COLORS[level];
  return (
    <span
      style={{
        fontSize: 12, fontWeight: 700, letterSpacing: '.04em', color,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap',
      }}
    >
      {level === 'ok' ? 'Healthy' : level === 'warn' ? 'Topping up soon' : level === 'critical' ? 'Top up now' : 'Expired'}
      {' · '}{formatDuration(ttlSeconds)}
    </span>
  );
}

/** Horizontal usage meter (0..1). */
function UsageBar({ usage }) {
  const pct = Math.round((usage || 0) * 100);
  return (
    <div>
      <div style={{ height: 6, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{pct}% of capacity used</div>
    </div>
  );
}

/** One purpose's card (storage or messaging). */
function BatchCard({ purpose, configuredId, batch, bee, onChanged }) {
  const preset = BATCH_PRESETS[purpose];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [newId, setNewId] = useState(null);
  const [topUp, setTopUp] = useState('');
  const [newDepth, setNewDepth] = useState('');

  async function run(fn) {
    setBusy(true); setError(null); setNewId(null);
    try {
      const result = await fn();
      if (typeof result === 'string') setNewId(result);
      await onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const title = purpose === 'storage' ? 'Storage batch' : 'Messaging batch';
  const envVar = purpose === 'storage' ? 'VITE_STORAGE_BATCH_ID' : 'VITE_MESSAGING_BATCH_ID';

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>{preset.description}</div>
        </div>
        {batch && <HealthBadge ttlSeconds={batch.ttlSeconds} />}
      </div>

      <div style={{ marginTop: 14, fontSize: 13, lineHeight: 1.7 }}>
        <div style={{ color: 'var(--muted)' }}>
          Configured (<code>{envVar}</code>):{' '}
          <code>{configuredId ? `${configuredId.slice(0, 10)}…${configuredId.slice(-6)}` : '— unset —'}</code>
        </div>

        {batch ? (
          <>
            <div style={{ marginTop: 8, display: 'flex', gap: 18, flexWrap: 'wrap', color: 'var(--muted)' }}>
              <span>depth <strong style={{ color: 'var(--text)' }}>{batch.depth}</strong></span>
              <span>amount <strong style={{ color: 'var(--text)' }}>{batch.amount}</strong> PLUR/chunk</span>
              <span>{batch.immutable ? 'immutable' : 'mutable'}</span>
              <span>{batch.usable ? 'usable' : 'not yet usable'}</span>
            </div>
            <div style={{ marginTop: 10 }}><UsageBar usage={batch.usage} /></div>
          </>
        ) : (
          <div style={{ marginTop: 8, color: 'var(--muted)' }}>
            No usable batch found on this node {configuredId ? 'for the configured id' : ''}. Create one below.
          </div>
        )}
      </div>

      {/* Actions */}
      <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
        {!batch && (
          <Button
            disabled={busy || !bee}
            onClick={() => run(() => createBatch(bee, preset))}
          >
            <PlusCircle size={15} /> {busy ? 'Buying…' : `Create ${purpose} batch (depth ${preset.depth})`}
          </Button>
        )}

        {batch && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <Field label="Top up amount (PLUR/chunk)" hint="Extends remaining duration.">
                <Input value={topUp} onChange={(e) => setTopUp(e.target.value)} placeholder={preset.amount} style={{ width: 160 }} />
              </Field>
              <GhostButton
                disabled={busy || !topUp.trim()}
                onClick={() => run(() => topUpBatch(bee, batch.batchID, topUp.trim()))}
                style={{ padding: '11px 14px' }}
              >
                <ArrowUpCircle size={15} /> Top up
              </GhostButton>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <Field label="Add capacity (new depth)" hint={`> ${batch.depth}; halves balance, top up after.`}>
                <Input value={newDepth} onChange={(e) => setNewDepth(e.target.value)} placeholder={String(batch.depth + 1)} style={{ width: 140 }} />
              </Field>
              <GhostButton
                disabled={busy || !newDepth.trim() || Number(newDepth) <= batch.depth}
                onClick={() => run(() => diluteBatch(bee, batch.batchID, Number(newDepth.trim())))}
                style={{ padding: '11px 14px' }}
              >
                <Maximize2 size={15} /> Add capacity
              </GhostButton>
            </div>
          </>
        )}
      </div>

      {newId && (
        <Banner tone="info">
          Created batch <code>{newId}</code>. Paste it into <code>{envVar}</code> in your <code>.env</code> and rebuild,
          or leave it — auto-create reuses it by label (<code>{preset.label}</code>) next run.
        </Banner>
      )}
      <ErrorNote error={error} />
    </Card>
  );
}

export default function StorageSection() {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [storageBatch, setStorageBatch] = useState(null);
  const [messagingBatch, setMessagingBatch] = useState(null);
  const [bee, setBee] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const b = makeBee(BEE_URL);
      setBee(b);
      // Resolve each purpose's batch: prefer the configured id, else find a
      // usable node batch sharing the preset label (matches ensureBatch's reuse).
      const all = await listBatches(b);
      const resolve = async (configuredId, label) => {
        if (configuredId) {
          const got = await getBatch(b, configuredId);
          if (got) return got;
        }
        return all.find((x) => x.usable && x.exists && x.label === label) || null;
      };
      setStorageBatch(await resolve(STORAGE_BATCH_ID, BATCH_PRESETS.storage.label));
      setMessagingBatch(await resolve(MESSAGING_BATCH_ID, BATCH_PRESETS.messaging.label));
    } catch (err) {
      setLoadError(err);
      setStorageBatch(null);
      setMessagingBatch(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div>
      <SectionHeader
        title="Storage"
        subtitle="Manage your Swarm postage batches — a durable one for product content and a short-lived one for encrypted messages. Batches are bought + topped up from your Bee node's BZZ wallet (not MetaMask). See docs/POSTAGE.md."
        right={<GhostButton onClick={refresh} disabled={loading}><RefreshCw size={14} /> {loading ? 'Loading…' : 'Refresh'}</GhostButton>}
      />

      <Banner tone="info">
        <strong><HardDrive size={13} style={{ verticalAlign: '-2px' }} /> Two stamps, two lifetimes.</strong> Storage
        must stay alive as long as your shop is live (top it up); messaging is short-lived so encrypted addresses
        self-expire after fulfillment (CLAUDE.md §5). Bee node: <code>{BEE_URL}</code> — must be a writeable FULL node.
      </Banner>

      {loadError && (
        <Banner tone="error">
          Couldn't reach the Bee node at <code>{BEE_URL}</code>: {loadError.shortMessage || loadError.message}.
          Postage management needs a writeable full Bee node (not a gateway).
        </Banner>
      )}

      <div style={{ marginTop: 16 }}>
        <BatchCard purpose="storage" configuredId={STORAGE_BATCH_ID} batch={storageBatch} bee={bee} onChanged={refresh} />
        <BatchCard purpose="messaging" configuredId={MESSAGING_BATCH_ID} batch={messagingBatch} bee={bee} onChanged={refresh} />
      </div>
    </div>
  );
}
