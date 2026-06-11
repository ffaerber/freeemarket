/**
 * ShopSection — register / update the merchant's shop profile.
 *
 * Flow:
 *   1. Read the current shop (useShopProfile) → prefill the form if registered.
 *   2. Validate the assembled ShopProfile with @freeemarket/schema
 *      (assertShopProfile) BEFORE upload.
 *   3. Upload the ShopProfile JSON to Swarm (write path) → get the reference.
 *   4. Call registerShop(refToBytes32(ref)) via wagmi useWriteContract, wait for
 *      the receipt, then refetch.
 *
 * Logo/banner accept either a Swarm reference (paste) or a file the merchant
 * uploads here (we upload it and store the resulting ref).
 */
import React, { useEffect, useState } from 'react';
import { Store, UploadCloud, Check, Truck, Link as LinkIcon } from 'lucide-react';
import { useAccount, useWriteContract, usePublicClient } from 'wagmi';
import {
  assertShopProfile,
  SchemaValidationError,
  REGION_PRESETS,
  REGION_LABELS,
  describeShippingPolicy,
} from '@freeemarket/schema';
import { marketplaceAbi } from '../abi/marketplace.js';
import { handleRegistryAbi } from '../abi/handleRegistry.js';
import { useShopProfile } from '../hooks/useShopProfile.js';
import { useMyHandle } from '../hooks/useMyHandle.js';
import { makeBee, uploadJson, uploadFile } from '../lib/swarmWrite.js';
import { refToBytes32, swarmImageUrl } from '../lib/swarm.js';
import { usePostageBatch } from '../hooks/usePostageBatch.js';
import {
  MARKETPLACE_ADDRESS,
  HANDLE_REGISTRY_ADDRESS,
  GNOSIS_CHAIN_ID,
  EXPLORER_URL,
  BEE_URL,
} from '../config.js';
import {
  Card,
  Field,
  Input,
  Textarea,
  Button,
  GhostButton,
  SectionHeader,
  Banner,
  ErrorNote,
  Pill,
} from '../ui.jsx';

/** Public host the multi-tenant storefront is served at (for the handle URL preview). */
const STOREFRONT_HOST = 'freeemarket.eth.limo';

/** Client-side mirror of HandleRegistry._validate (3–32 [a-z0-9-], no edge hyphen). */
function handleError(h) {
  if (!h) return '';
  if (h.length < 3 || h.length > 32) return 'Must be 3–32 characters.';
  if (h[0] === '-' || h[h.length - 1] === '-') return 'No leading or trailing hyphen.';
  if (!/^[a-z0-9-]+$/.test(h)) return 'Only lowercase a–z, 0–9 and hyphen.';
  return '';
}

/** Region presets offered as checkboxes (resolved via @freeemarket/schema). */
const REGION_OPTIONS = ['EU', 'EEA', 'US', 'NA'];

/** Empty/default shipping form state (worldwide ⇒ ships everywhere). */
const DEFAULT_SHIPPING = { mode: 'worldwide', regions: [], countries: '', note: '' };

const SHIPPING_MODES = [
  { value: 'worldwide', label: 'Worldwide (ships everywhere)' },
  { value: 'allowlist', label: 'Only these (allowlist)' },
  { value: 'blocklist', label: 'Everywhere except (blocklist)' },
];

export default function ShopSection() {
  const { registered, profile, isLoading, error: readError, refetch } = useShopProfile();
  const { batchId, ready: uploadsReady, isChecking: batchChecking } = usePostageBatch();
  const publicClient = usePublicClient({ chainId: GNOSIS_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();

  const [form, setForm] = useState({
    name: '', ens: '', tagline: '', blurb: '', logo: '', banner: '',
  });
  // Shipping policy form (ShopProfile.shipping). `countries` is a comma/space
  // separated string in the form; it's parsed to an uppercase ISO code array on
  // build. ADVISORY only — the contract never sees a country (CLAUDE.md §5).
  const [shipping, setShipping] = useState(DEFAULT_SHIPPING);
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
      // Prefill the shipping policy (absent ⇒ worldwide, backward compatible).
      const sp = profile.shipping;
      if (sp) {
        setShipping({
          mode: sp.mode || 'worldwide',
          regions: Array.isArray(sp.regions) ? sp.regions : [],
          countries: Array.isArray(sp.countries) ? sp.countries.join(', ') : '',
          note: sp.note || '',
        });
      } else {
        setShipping(DEFAULT_SHIPPING);
      }
    }
  }, [profile]);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  function setShip(key, value) {
    setShipping((s) => ({ ...s, [key]: value }));
  }
  function toggleRegion(r) {
    setShipping((s) => ({
      ...s,
      regions: s.regions.includes(r)
        ? s.regions.filter((x) => x !== r)
        : [...s.regions, r],
    }));
  }

  /** Parse the comma/space-separated country field into uppercase ISO codes. */
  function parseCountries(raw) {
    return Array.from(
      new Set(
        (raw || '')
          .split(/[\s,]+/)
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean),
      ),
    );
  }

  async function uploadImage(key, file) {
    if (!file) return;
    setActionError(null);
    try {
      const bee = makeBee(BEE_URL);
      const ref = await uploadFile(bee, batchId, file);
      set(key, ref);
    } catch (err) {
      setActionError(err);
    }
  }

  /** Assemble the ShopProfile object from the form state (theme is static now). */
  function buildProfile() {
    const p = { version: 1, name: form.name.trim() };
    if (form.ens.trim()) p.ens = form.ens.trim();
    if (form.tagline.trim()) p.tagline = form.tagline.trim();
    if (form.blurb.trim()) p.blurb = form.blurb.trim();
    if (form.logo.trim()) p.logo = form.logo.trim();
    if (form.banner.trim()) p.banner = form.banner.trim();

    // Shipping policy (ADVISORY, off-chain — CLAUDE.md §5). For worldwide we omit
    // countries/regions (they're ignored); we still write the mode so the
    // storefront badge reads "Worldwide" explicitly.
    const ship = { mode: shipping.mode };
    if (shipping.mode !== 'worldwide') {
      const countries = parseCountries(shipping.countries);
      const regions = (shipping.regions || []).filter((r) => REGION_PRESETS[r]);
      if (countries.length) ship.countries = countries;
      if (regions.length) ship.regions = regions;
    }
    if (shipping.note.trim()) ship.note = shipping.note.trim();
    p.shipping = ship;

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
      const ref = await uploadJson(bee, batchId, profileObj);

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
        subtitle="Your shop identity. Saved as a ShopProfile JSON on Swarm and registered on-chain via registerShop(bytes32). The connected wallet IS your shop. The storefront uses a fixed default theme."
        right={registered ? <Pill tone="accent2">Registered</Pill> : <Pill>Not registered</Pill>}
      />

      {!uploadsReady && (
        <Banner>
          {batchChecking
            ? 'Checking your Bee node for a postage stamp…'
            : 'No usable postage stamp on your Bee node. Connect a local node and buy a stamp (Swarm connect button), or set VITE_POSTAGE_BATCH_ID. Saving uploads the profile JSON to Swarm. See CLAUDE.md §5.'}
        </Banner>
      )}
      {readError && <Banner tone="error">Couldn't read current shop: {readError.shortMessage || readError.message}</Banner>}

      <div>
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
            <ImageUpload disabled={!uploadsReady} onPick={(f) => uploadImage('logo', f)} preview={swarmImageUrl(BEE_URL, form.logo)} />
          </Field>
          <Field label="Banner" hint="Paste a Swarm reference or upload an image to store one.">
            <Input value={form.banner} onChange={(e) => set('banner', e.target.value)} placeholder="Swarm reference (64 hex)" />
            <ImageUpload disabled={!uploadsReady} onPick={(f) => uploadImage('banner', f)} preview={swarmImageUrl(BEE_URL, form.banner)} />
          </Field>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <Button onClick={onSubmit} disabled={busy || !uploadsReady || !form.name.trim()}>
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
      </div>

      {/* Storefront handle — claim a multi-tenant URL on the shared storefront. */}
      <HandleClaim />

      {/* Shipping-region policy (ADVISORY, off-chain — CLAUDE.md §5). */}
      <Card style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Truck size={16} style={{ color: 'var(--accent2)' }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>Shipping region</div>
          <Pill tone="accent2">{describeShippingPolicy(previewShipping(shipping))}</Pill>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5, maxWidth: '70ch' }}>
          Restrict which countries your shop ships to. This is an <strong>advisory storefront
          policy</strong> — the storefront shows it and disables checkout for excluded countries.
          It is <strong>NOT enforced on-chain</strong>: the buyer's address (and country) is
          encrypted and travels off-chain over Swarm PSS (CLAUDE.md §5), so a buyer could still
          fund escrow — the dispute/refund path is the backstop.
        </div>

        <Field label="Mode">
          <select
            className="fm-input"
            value={shipping.mode}
            onChange={(e) => setShip('mode', e.target.value)}
          >
            {SHIPPING_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </Field>

        <div style={{ opacity: shipping.mode === 'worldwide' ? 0.45 : 1, pointerEvents: shipping.mode === 'worldwide' ? 'none' : 'auto' }}>
          <Field
            label="Region presets"
            hint="Each preset expands into its ISO country codes (e.g. EU → 27 members). Combined with the countries below."
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
              {REGION_OPTIONS.map((r) => (
                <label key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={shipping.regions.includes(r)}
                    disabled={shipping.mode === 'worldwide'}
                    onChange={() => toggleRegion(r)}
                  />
                  {r} <span style={{ color: 'var(--muted)' }}>({REGION_LABELS[r]}, {REGION_PRESETS[r].length})</span>
                </label>
              ))}
            </div>
          </Field>

          <Field
            label="Individual countries"
            hint="ISO 3166-1 alpha-2 codes, comma or space separated (e.g. US, GB, JP). Uppercased automatically."
          >
            <Input
              value={shipping.countries}
              onChange={(e) => setShip('countries', e.target.value)}
              placeholder="US, GB, JP"
              disabled={shipping.mode === 'worldwide'}
            />
          </Field>
        </div>

        <Field label="Note (optional)" hint="Free text shown to buyers, e.g. “Ships within 3 days”.">
          <Input
            value={shipping.note}
            onChange={(e) => setShip('note', e.target.value)}
            placeholder="Ships within 3 days"
          />
        </Field>
      </Card>
    </div>
  );
}

/**
 * HandleClaim — claim / change / release the merchant's storefront handle on the
 * ownerless HandleRegistry, so the shared multi-tenant storefront resolves
 * freeemarket.eth.limo/<handle> → this wallet. The connected wallet IS the seller.
 */
function HandleClaim() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: GNOSIS_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const { handle: currentHandle, refetch } = useMyHandle();

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Prefill the input with the current handle once it loads.
  useEffect(() => {
    if (currentHandle) setInput(currentHandle);
  }, [currentHandle]);

  const notConfigured = !HANDLE_REGISTRY_ADDRESS;
  const validationMsg = handleError(input);
  const unchanged = input === currentHandle;
  const canClaim =
    isConnected && !notConfigured && !busy && Boolean(input) && !validationMsg && !unchanged;

  async function run(functionName, args) {
    setBusy(true);
    setActionError(null);
    setTxHash(null);
    try {
      const hash = await writeContractAsync({
        abi: handleRegistryAbi,
        address: HANDLE_REGISTRY_ADDRESS,
        functionName,
        args,
        chainId: GNOSIS_CHAIN_ID,
      });
      setTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      await refetch?.();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <LinkIcon size={16} style={{ color: 'var(--accent2)' }} />
        <div style={{ fontSize: 13, fontWeight: 600 }}>Storefront handle</div>
        {currentHandle
          ? <Pill tone="accent2">{currentHandle}</Pill>
          : <Pill>None claimed</Pill>}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5, maxWidth: '70ch' }}>
        Claim a handle on the on-chain <strong>HandleRegistry</strong> so the shared multi-tenant
        storefront resolves your shop by URL. One handle per wallet; claiming a new one frees the
        old. Lowercase a–z, 0–9 and hyphen, 3–32 chars.
      </div>

      {notConfigured ? (
        <Banner>
          Handle registry not configured (VITE_HANDLE_REGISTRY). Set it to the deployed
          HandleRegistry address to enable handle claims.
        </Banner>
      ) : (
        <>
          <Field
            label="Handle"
            hint={
              input && !validationMsg
                ? `Your shop will be at ${STOREFRONT_HOST}/${input}`
                : 'e.g. autoparts24'
            }
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value.toLowerCase())}
              placeholder="autoparts24"
            />
          </Field>
          {validationMsg && (
            <div style={{ color: '#ff6b6b', fontSize: 12.5, marginTop: -6, marginBottom: 8 }}>{validationMsg}</div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <Button onClick={() => run('claim', [input])} disabled={!canClaim}>
              <LinkIcon size={16} /> {busy ? 'Submitting…' : currentHandle ? 'Change handle' : 'Claim handle'}
            </Button>
            {currentHandle && (
              <GhostButton onClick={() => run('release', [])} disabled={busy}>
                Release
              </GhostButton>
            )}
            {!isConnected && (
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>Connect a wallet to claim.</span>
            )}
          </div>
          {txHash && (
            <a href={`${EXPLORER_URL}/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 10, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--accent)' }}>
              View tx: {txHash.slice(0, 10)}…
            </a>
          )}
          <ErrorNote error={actionError} />
        </>
      )}
    </Card>
  );
}

/**
 * Build a preview ShippingPolicy from the form state so the badge mirrors what
 * gets uploaded (uses the same describeShippingPolicy as the storefront).
 */
function previewShipping(shipping) {
  if (shipping.mode === 'worldwide') return { mode: 'worldwide' };
  return {
    mode: shipping.mode,
    regions: (shipping.regions || []).filter((r) => REGION_PRESETS[r]),
    countries: (shipping.countries || '')
      .split(/[\s,]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
  };
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
