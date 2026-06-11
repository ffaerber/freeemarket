/**
 * Onboarding — first-run wizard for a freshly-connected merchant.
 *
 * Shown by App when the connected wallet has no shop AND/OR no handle. One step:
 * name your store (e.g. "superfruits"). On submit it does the two on-chain writes
 * that constitute a shop — and the store name IS the handle:
 *   1. HandleRegistry.claim(name)  → freeemarket.eth.limo/<name> resolves here
 *   2. registerShop(ShopProfile{ version:1, name })  → uploaded to Swarm
 * Either step is skipped if already done (resumable). When both are in place the
 * App gate flips to the normal tabs; onDone() jumps the merchant to Listings.
 */
import React, { useEffect, useState } from 'react';
import { Store, ArrowRight, Check } from 'lucide-react';
import { useWriteContract, usePublicClient } from 'wagmi';
import { assertShopProfile, SchemaValidationError } from '@freeemarket/schema';
import { marketplaceAbi } from '../abi/marketplace.js';
import { handleRegistryAbi } from '../abi/handleRegistry.js';
import { useShopProfile } from '../hooks/useShopProfile.js';
import { useMyHandle } from '../hooks/useMyHandle.js';
import { makeBee, uploadJson } from '../lib/swarmWrite.js';
import { refToBytes32 } from '../lib/swarm.js';
import { usePostageBatch } from '../hooks/usePostageBatch.js';
import {
  MARKETPLACE_ADDRESS,
  HANDLE_REGISTRY_ADDRESS,
  GNOSIS_CHAIN_ID,
  EXPLORER_URL,
  BEE_URL,
} from '../config.js';
import { Card, Field, Input, Button, SectionHeader, Banner, ErrorNote } from '../ui.jsx';

const STOREFRONT_HOST = 'freeemarket.eth.limo';

/** Same rules as HandleRegistry._validate (3–32 [a-z0-9-], no edge hyphen). */
function handleError(h) {
  if (!h) return 'Enter a store name.';
  if (h.length < 3 || h.length > 32) return 'Must be 3–32 characters.';
  if (h[0] === '-' || h[h.length - 1] === '-') return 'No leading or trailing hyphen.';
  if (!/^[a-z0-9-]+$/.test(h)) return 'Only lowercase a–z, 0–9 and hyphen.';
  return '';
}

export default function Onboarding({ onDone }) {
  const publicClient = usePublicClient({ chainId: GNOSIS_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const { registered, refetch: refetchShop } = useShopProfile();
  const { handle: currentHandle, refetch: refetchHandle } = useMyHandle();
  const { batchId, ready: uploadsReady, isChecking: batchChecking } = usePostageBatch();

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [stepMsg, setStepMsg] = useState('');
  const [txHash, setTxHash] = useState(null);
  const [error, setError] = useState(null);

  // If a previous run half-completed (handle claimed but shop not registered),
  // prefill the name with the existing handle so the merchant just finishes.
  useEffect(() => {
    if (currentHandle && !name) setName(currentHandle);
  }, [currentHandle, name]);

  const registryMissing = !HANDLE_REGISTRY_ADDRESS;
  const validationMsg = name ? handleError(name) : '';
  const canSubmit = !busy && Boolean(name) && !validationMsg && uploadsReady && !registryMissing;

  async function send(label, args) {
    setStepMsg(label);
    const hash = await writeContractAsync(args);
    setTxHash(hash);
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function onCreate() {
    setBusy(true);
    setError(null);
    setTxHash(null);
    try {
      const handle = name.trim();

      // 1. Claim the handle (skip if this wallet already holds it).
      if (currentHandle !== handle) {
        await send('Claiming your store name…', {
          abi: handleRegistryAbi,
          address: HANDLE_REGISTRY_ADDRESS,
          functionName: 'claim',
          args: [handle],
          chainId: GNOSIS_CHAIN_ID,
        });
        await refetchHandle?.();
      }

      // 2. Register the shop profile (skip if already registered).
      if (!registered) {
        const profile = assertShopProfile({ version: 1, name: handle });
        setStepMsg('Uploading your shop profile to Swarm…');
        const bee = makeBee(BEE_URL);
        const ref = await uploadJson(bee, batchId, profile);
        await send('Registering your shop on-chain…', {
          abi: marketplaceAbi,
          address: MARKETPLACE_ADDRESS,
          functionName: 'registerShop',
          args: [refToBytes32(ref)],
          chainId: GNOSIS_CHAIN_ID,
        });
        await refetchShop?.();
      }

      setStepMsg('Done!');
      onDone?.();
    } catch (err) {
      setError(err instanceof SchemaValidationError ? new Error(`Invalid profile: ${JSON.stringify(err.errors)}`) : err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Welcome — open your shop"
        subtitle="Two on-chain steps and you're live. Pick a store name; it becomes your public URL and is registered on-chain."
      />

      {registryMissing && (
        <Banner tone="error">Handle registry not configured (<code>VITE_HANDLE_REGISTRY</code>).</Banner>
      )}
      {!registryMissing && !uploadsReady && (
        <Banner>
          {batchChecking
            ? 'Checking your Bee node for a postage stamp…'
            : <><strong>No postage stamp.</strong> Registering a shop uploads its profile JSON to Swarm. Connect your local Bee node and buy a postage stamp (use the Swarm connect button), or set <code>VITE_POSTAGE_BATCH_ID</code>. See CLAUDE.md §5.</>}
        </Banner>
      )}

      <Card style={{ maxWidth: 560 }}>
        <Field
          label="Store name"
          hint={
            name && !validationMsg
              ? `Your shop will live at ${STOREFRONT_HOST}/${name}`
              : 'Lowercase letters, numbers and hyphens — e.g. superfruits'
          }
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            placeholder="superfruits"
            autoFocus
          />
        </Field>
        {validationMsg && (
          <div style={{ color: '#ff6b6b', fontSize: 12.5, marginTop: -6, marginBottom: 8 }}>{validationMsg}</div>
        )}

        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.6 }}>
          On submit: <strong>claim</strong> the name on the HandleRegistry, then <strong>register</strong> your shop
          (two wallet confirmations). You can add products right after.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Button onClick={onCreate} disabled={!canSubmit}>
            <Store size={16} /> {busy ? 'Working…' : 'Create my shop'} {!busy && <ArrowRight size={15} />}
          </Button>
          {busy && stepMsg && (
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>{stepMsg}</span>
          )}
          {!busy && stepMsg === 'Done!' && (
            <span style={{ color: 'var(--accent2)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Check size={15} /> Shop created
            </span>
          )}
        </div>
        {txHash && (
          <a href={`${EXPLORER_URL}/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 10, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--accent)' }}>
            View tx: {txHash.slice(0, 10)}…
          </a>
        )}
        <ErrorNote error={error} />
      </Card>
    </div>
  );
}
