/**
 * ShopSection — register / update the merchant's shop profile.
 *
 * Flow:
 *   1. Read the current shop (useShopProfile) → prefill the form if registered.
 *   2. Validate the assembled ShopProfile with @freemarket/schema
 *      (assertShopProfile) BEFORE upload.
 *   3. Upload the ShopProfile JSON to Swarm (write path) → get the reference.
 *   4. Call registerShop(refToBytes32(ref)) via wagmi useWriteContract, wait for
 *      the receipt, then refetch.
 *
 * Logo/banner accept either a Swarm reference (paste) or a file the merchant
 * uploads here (we upload it and store the resulting ref).
 */
import React, { useEffect, useState } from 'react';
import { Store, UploadCloud, Check } from 'lucide-react';
import { useWriteContract, usePublicClient } from 'wagmi';
import { assertShopProfile, SchemaValidationError } from '@freemarket/schema';
import { marketplaceAbi } from '../abi/marketplace.js';
import { useShopProfile } from '../hooks/useShopProfile.js';
import { makeBee, uploadJson, uploadFile } from '../lib/swarmWrite.js';
import { refToBytes32, swarmImageUrl } from '../lib/swarm.js';
import {
  MARKETPLACE_ADDRESS,
  GNOSIS_CHAIN_ID,
  EXPLORER_URL,
  BEE_URL,
  POSTAGE_BATCH_ID,
  UPLOADS_DISABLED,
  ADMIN_THEME,
} from '../config.js';
import {
  Card,
  Field,
  Input,
  Textarea,
  Button,
  SectionHeader,
  Banner,
  ErrorNote,
  Pill,
} from '../ui.jsx';

/** A storefront theme the merchant edits — defaults to a bright sample. */
const DEFAULT_THEME = {
  bg: '#FFF7EE', surface: '#FFFFFF', text: '#2B1A12', muted: '#9A7C68',
  accent: '#FF4D6D', accent2: '#FFA51E', border: '#F1E3D3', radius: '22px',
  display: "'Fraunces', Georgia, serif", body: "'DM Sans', sans-serif",
};

const THEME_KEYS = [
  'bg', 'surface', 'text', 'muted', 'accent', 'accent2', 'border', 'radius', 'display', 'body',
];

export default function ShopSection() {
  const { registered, profile, isLoading, error: readError, refetch } = useShopProfile();
  const publicClient = usePublicClient({ chainId: GNOSIS_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();

  const [form, setForm] = useState({
    name: '', ens: '', tagline: '', blurb: '', logo: '', banner: '',
  });
  const [theme, setTheme] = useState(DEFAULT_THEME);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [txHash, setTxHash] = useState(null);
  const [done, setDone] = useState(false);

  // Prefill from the on-chain profile once it loads.
  useEffect(() => {
    if (profile) {
      setForm({
        name: profile.name || '',
        ens: profile.ens || '',
        tagline: profile.tagline || '',
        blurb: profile.blurb || '',
        logo: profile.logo || '',
        banner: profile.banner || '',
      });
      if (profile.theme) setTheme({ ...DEFAULT_THEME, ...profile.theme });
    }
  }, [profile]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function setThemeKey(key, value) {
    setTheme((t) => ({ ...t, [key]: value }));
  }

  async function uploadImage(key, file) {
    if (!file) return;
    setActionError(null);
    try {
      const bee = makeBee(BEE_URL);
      const ref = await uploadFile(bee, POSTAGE_BATCH_ID, file);
      set(key, ref);
    } catch (err) {
      setActionError(err);
    }
  }

  /** Assemble the ShopProfile object from form + theme state. */
  function buildProfile() {
    const p = { version: 1, name: form.name.trim(), theme };
    if (form.ens.trim()) p.ens = form.ens.trim();
    if (form.tagline.trim()) p.tagline = form.tagline.trim();
    if (form.blurb.trim()) p.blurb = form.blurb.trim();
    if (form.logo.trim()) p.logo = form.logo.trim();
    if (form.banner.trim()) p.banner = form.banner.trim();
    return p;
  }

  async function onSubmit() {
    setBusy(true);
    setActionError(null);
    setDone(false);
    setTxHash(null);
    try {
      // 1. Validate against the shared schema before doing anything on-chain.
      const profileObj = assertShopProfile(buildProfile());

      // 2. Upload the profile JSON to Swarm.
      const bee = makeBee(BEE_URL);
      const ref = await uploadJson(bee, POSTAGE_BATCH_ID, profileObj);

      // 3. registerShop(bytes32 metadata).
      const hash = await writeContractAsync({
        abi: marketplaceAbi,
        address: MARKETPLACE_ADDRESS,
        functionName: 'registerShop',
        args: [refToBytes32(ref)],
        chainId: GNOSIS_CHAIN_ID,
      });
      setTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      setDone(true);
      await refetch();
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        setActionError(new Error(`Invalid ShopProfile: ${JSON.stringify(err.errors)}`));
      } else {
        setActionError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Shop profile"
        subtitle="Your white-label storefront identity. Saved as a ShopProfile JSON on Swarm and registered on-chain via registerShop(bytes32). The connected wallet IS your shop."
        right={registered ? <Pill tone="accent2">Registered</Pill> : <Pill>Not registered</Pill>}
      />

      {UPLOADS_DISABLED && (
        <Banner>
          No Swarm postage batch configured (VITE_POSTAGE_BATCH_ID). Saving requires
          uploading the profile JSON to Swarm, which needs a stamp — uploads are
          disabled until one is set. See CLAUDE.md §5.
        </Banner>
      )}
      {readError && <Banner tone="error">Couldn't read current shop: {readError.shortMessage || readError.message}</Banner>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        <Card>
          <Field label="Shop name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Sunny Field" />
          </Field>
          <Field label="ENS" hint="Optional — the name.eth this storefront is hosted at.">
            <Input value={form.ens} onChange={(e) => set('ens', e.target.value)} placeholder="sunnyfield.eth" />
          </Field>
          <Field label="Tagline">
            <Input value={form.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Freeze-dried fruit, nothing else added." />
          </Field>
          <Field label="Blurb">
            <Textarea rows={3} value={form.blurb} onChange={(e) => set('blurb', e.target.value)} placeholder="Single-origin fruit, freeze-dried at harvest." />
          </Field>

          <Field label="Logo" hint="Paste a Swarm reference or upload an image to store one.">
            <Input value={form.logo} onChange={(e) => set('logo', e.target.value)} placeholder="Swarm reference (64 hex)" />
            <ImageUpload disabled={UPLOADS_DISABLED} onPick={(f) => uploadImage('logo', f)} preview={swarmImageUrl(BEE_URL, form.logo)} />
          </Field>
          <Field label="Banner" hint="Paste a Swarm reference or upload an image to store one.">
            <Input value={form.banner} onChange={(e) => set('banner', e.target.value)} placeholder="Swarm reference (64 hex)" />
            <ImageUpload disabled={UPLOADS_DISABLED} onPick={(f) => uploadImage('banner', f)} preview={swarmImageUrl(BEE_URL, form.banner)} />
          </Field>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <Button onClick={onSubmit} disabled={busy || UPLOADS_DISABLED || !form.name.trim()}>
              <Store size={16} /> {busy ? 'Saving…' : registered ? 'Update shop' : 'Register shop'}
            </Button>
            {done && (
              <span style={{ color: 'var(--accent2)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Check size={15} /> Saved
              </span>
            )}
          </div>
          {txHash && (
            <a href={`${EXPLORER_URL}/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 10, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--accent)' }}>
              View tx: {txHash.slice(0, 10)}…
            </a>
          )}
          <ErrorNote error={actionError} />
          {isLoading && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 10 }}>Loading current shop…</div>}
        </Card>

        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Storefront theme tokens</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
            White-label tokens the storefront renders with (CLAUDE.md §6). All ten are required by the schema.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {THEME_KEYS.map((k) => (
              <label key={k} style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{k}</span>
                <Input value={theme[k]} onChange={(e) => setThemeKey(k, e.target.value)} style={{ padding: '8px 10px', fontSize: 12.5 }} />
              </label>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/** Small file picker + preview used for logo/banner. */
function ImageUpload({ onPick, preview, disabled }) {
  // A <label> wrapping a hidden <input type=file> is the reliable picker trigger
  // (no nested <button>, which would be invalid markup). The label is styled to
  // match GhostButton.
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
      <label
        className="fm-btn"
        style={{
          border: '1px solid var(--border)',
          background: 'transparent',
          color: 'var(--text)',
          fontFamily: 'var(--body)',
          fontWeight: 600,
          fontSize: 14,
          padding: '10px 15px',
          borderRadius: 10,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <UploadCloud size={15} /> Upload
        <input
          type="file"
          accept="image/*"
          disabled={disabled}
          style={{ display: 'none' }}
          onChange={(e) => onPick(e.target.files?.[0])}
        />
      </label>
      {preview && (
        <img src={preview} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
      )}
    </div>
  );
}
