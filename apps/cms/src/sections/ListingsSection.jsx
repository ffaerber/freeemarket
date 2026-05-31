/**
 * ListingsSection — list CRUD + Swarm image upload.
 *
 * Create flow:
 *   1. Pick an accepted token (verify via useAcceptedToken → reads
 *      acceptedTokens + decimals/symbol). Decimals are NEVER hardcoded.
 *   2. Upload listing images to Swarm (write path) → collect refs.
 *   3. Assemble ListingMetadata (incl. the `payment` hint {token, symbol,
 *      decimals}) → validate with @freemarket/schema → upload JSON to Swarm.
 *   4. createListing(token, parseUnits(price, decimals), stockCount, refToBytes32(metaRef)).
 *      `stock` is a unit COUNT (a plain integer) — NEVER parseUnits'd.
 *
 * Edit flow (per existing listing): change price/stock/metadata/active and call
 * updateListing(id, price, stock, metadata, active). Toggling active reuses the
 * existing metadata reference + current stock (no re-upload needed for a flip).
 */
import React, { useState } from 'react';
import { PlusCircle, UploadCloud, X, Power, RefreshCw } from 'lucide-react';
import { useWriteContract, usePublicClient } from 'wagmi';
import { parseUnits } from 'viem';
import { assertListingMetadata, SchemaValidationError } from '@freemarket/schema';
import { marketplaceAbi } from '../abi/marketplace.js';
import { useMyListings } from '../hooks/useMyListings.js';
import { useShopProfile } from '../hooks/useShopProfile.js';
import { useAcceptedToken } from '../hooks/useAcceptedToken.js';
import { makeBee, uploadJson, uploadFile } from '../lib/swarmWrite.js';
import { refToBytes32, swarmImageUrl } from '../lib/swarm.js';
import {
  MARKETPLACE_ADDRESS,
  GNOSIS_CHAIN_ID,
  EXPLORER_URL,
  BEE_URL,
  POSTAGE_BATCH_ID,
  UPLOADS_DISABLED,
  KNOWN_TOKENS,
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

/**
 * Parse a stock field into a non-negative integer BigInt. Stock is a COUNT of
 * units — NOT a token amount — so it must never go through parseUnits. Rejects
 * empty/blank, non-integer, or negative input by throwing.
 * @param {string} raw
 * @returns {bigint}
 */
function parseStockCount(raw) {
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) throw new Error('Stock must be a whole number (a unit count).');
  return BigInt(s);
}

export default function ListingsSection() {
  const { registered } = useShopProfile();
  const { listings, isLoading, error, refetch } = useMyListings();

  return (
    <div>
      <SectionHeader
        title="Listings"
        subtitle="Create and manage items. Metadata + images live on Swarm; price + token are on-chain. Listing creation requires a registered shop."
        right={<GhostButton onClick={() => refetch()}><RefreshCw size={14} /> Refresh</GhostButton>}
      />

      {!registered && (
        <Banner>Register your shop first (Shop tab) — createListing reverts without a registered shop.</Banner>
      )}
      {UPLOADS_DISABLED && (
        <Banner>No Swarm postage batch (VITE_POSTAGE_BATCH_ID) — image + metadata uploads are disabled. See CLAUDE.md §5.</Banner>
      )}
      {error && <Banner tone="error">Couldn't load listings: {error.shortMessage || error.message}</Banner>}

      <CreateListing disabled={!registered || UPLOADS_DISABLED} onCreated={refetch} />

      <div style={{ marginTop: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: 'var(--muted)' }}>
          Your listings {listings.length > 0 && `(${listings.length})`}
        </div>
        {isLoading && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading from Gnosis + Swarm…</div>}
        {!isLoading && listings.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>No listings yet.</div>
        )}
        <div style={{ display: 'grid', gap: 12 }}>
          {listings.map((l) => (
            <ListingRow key={l.id.toString()} listing={l} onChanged={refetch} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The create-listing form. */
function CreateListing({ disabled, onCreated }) {
  const publicClient = usePublicClient({ chainId: GNOSIS_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const tokenCheck = useAcceptedToken();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [variant, setVariant] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState(''); // unit COUNT (not a token amount)
  const [images, setImages] = useState([]); // Swarm refs
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [txHash, setTxHash] = useState(null);

  const info = tokenCheck.info;
  const tokenReady = info?.accepted && info?.decimals != null;

  async function addImage(file) {
    if (!file) return;
    setActionError(null);
    try {
      const bee = makeBee(BEE_URL);
      const ref = await uploadFile(bee, POSTAGE_BATCH_ID, file);
      setImages((xs) => [...xs, ref]);
    } catch (err) {
      setActionError(err);
    }
  }

  function reset() {
    setTitle(''); setVariant(''); setDescription(''); setCategory('');
    setPrice(''); setStock(''); setImages([]); setTxHash(null);
    tokenCheck.setToken('');
  }

  async function onCreate() {
    setBusy(true);
    setActionError(null);
    setTxHash(null);
    try {
      if (!tokenReady) throw new Error('Pick an accepted token first.');
      // price → smallest unit using the token's on-chain decimals (never hardcoded).
      const priceSmallest = parseUnits(price.trim(), info.decimals);
      if (priceSmallest <= 0n) throw new Error('Price must be greater than 0.');

      // stock is a COUNT of units — a plain non-negative integer, NEVER run
      // through parseUnits (that is for token amounts). createListing requires > 0.
      const stockCount = parseStockCount(stock);
      if (stockCount <= 0n) throw new Error('Stock must be a whole number greater than 0.');

      // Assemble + validate ListingMetadata.
      const meta = { version: 1, title: title.trim(), images };
      if (variant.trim()) meta.variant = variant.trim();
      if (description.trim()) meta.description = description.trim();
      if (category.trim()) meta.category = category.trim();
      // payment hint: canonical token/price stay on-chain; this aids rendering.
      meta.payment = { token: info.address, symbol: info.symbol || 'TOKEN', decimals: info.decimals };
      const metaObj = assertListingMetadata(meta);

      // Upload metadata JSON.
      const bee = makeBee(BEE_URL);
      const metaRef = await uploadJson(bee, POSTAGE_BATCH_ID, metaObj);

      // createListing(token, price, stock, metadata).
      const hash = await writeContractAsync({
        abi: marketplaceAbi,
        address: MARKETPLACE_ADDRESS,
        functionName: 'createListing',
        args: [info.address, priceSmallest, stockCount, refToBytes32(metaRef)],
        chainId: GNOSIS_CHAIN_ID,
      });
      setTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      reset();
      setOpen(false);
      await onCreated?.();
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        setActionError(new Error(`Invalid ListingMetadata: ${JSON.stringify(err.errors)}`));
      } else {
        setActionError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} disabled={disabled}>
        <PlusCircle size={16} /> New listing
      </Button>
    );
  }

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontFamily: 'var(--display)', fontSize: 18, fontWeight: 700 }}>New listing</div>
        <X size={18} className="fm-x" style={{ cursor: 'pointer', color: 'var(--muted)' }} onClick={() => setOpen(false)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Strawberries" /></Field>
        <Field label="Variant" hint="e.g. 100 g jar"><Input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="100 g jar" /></Field>
      </div>
      <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        <Field label="Category"><Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="fruit" /></Field>
        <Field
          label="Price"
          hint={tokenReady ? `In ${info.symbol || 'token'} (${info.decimals} decimals). Converted to smallest units on submit.` : 'Pick an accepted token to enable.'}
        >
          <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="14.00" inputMode="decimal" />
        </Field>
        <Field label="Stock" hint="Units available (a whole number, on-chain). Must be > 0.">
          <Input value={stock} onChange={(e) => setStock(e.target.value)} placeholder="100" inputMode="numeric" />
        </Field>
      </div>

      <Field
        label="Settlement token"
        hint="Must be on the marketplace accepted-token allowlist. Decimals/symbol are read on-chain."
      >
        <Input
          value={tokenCheck.token}
          onChange={(e) => tokenCheck.setToken(e.target.value)}
          placeholder="0x… token address"
          list="known-tokens"
        />
        {KNOWN_TOKENS.length > 0 && (
          <datalist id="known-tokens">
            {KNOWN_TOKENS.map((t) => <option key={t} value={t} />)}
          </datalist>
        )}
        <div style={{ marginTop: 6, fontSize: 12.5 }}>
          {tokenCheck.isLoading && <span style={{ color: 'var(--muted)' }}>Checking token…</span>}
          {info && info.accepted && (
            <span style={{ color: 'var(--accent2)' }}>Accepted · {info.symbol || '?'} · {info.decimals ?? '?'} decimals</span>
          )}
          {info && !info.accepted && (
            <span style={{ color: '#ff6b6b' }}>Not on the accepted-token allowlist.</span>
          )}
        </div>
      </Field>

      <Field label="Images" hint="Uploaded to Swarm; references stored in the listing metadata.">
        <FilePickerButton disabled={UPLOADS_DISABLED} onPick={addImage} />
        {images.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {images.map((ref) => (
              <div key={ref} style={{ position: 'relative' }}>
                <img src={swarmImageUrl(BEE_URL, ref)} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                <span
                  onClick={() => setImages((xs) => xs.filter((r) => r !== ref))}
                  style={{ position: 'absolute', top: -6, right: -6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 999, width: 18, height: 18, display: 'grid', placeItems: 'center', cursor: 'pointer', fontSize: 10 }}
                >✕</span>
              </div>
            ))}
          </div>
        )}
      </Field>

      <div style={{ marginTop: 8 }}>
        <Button onClick={onCreate} disabled={busy || disabled || !title.trim() || !tokenReady || !price.trim() || !stock.trim()}>
          <PlusCircle size={16} /> {busy ? 'Creating…' : 'Create listing'}
        </Button>
      </div>
      {txHash && (
        <a href={`${EXPLORER_URL}/tx/${txHash}`} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 10, fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--accent)' }}>
          View tx: {txHash.slice(0, 10)}…
        </a>
      )}
      <ErrorNote error={actionError || tokenCheck.error} />
    </Card>
  );
}

/** One existing listing with edit (price/metadata via re-upload) + active toggle. */
function ListingRow({ listing, onChanged }) {
  const publicClient = usePublicClient({ chainId: GNOSIS_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();

  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(listing.priceFormatted);
  const [stock, setStock] = useState(String(listing.stockCount ?? 0)); // unit COUNT; 0 allowed on edit
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description || '');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  /** Toggle active reuses the existing metadata ref — no re-upload needed. */
  async function toggleActive() {
    setBusy(true);
    setActionError(null);
    try {
      const hash = await writeContractAsync({
        abi: marketplaceAbi,
        address: MARKETPLACE_ADDRESS,
        functionName: 'updateListing',
        args: [listing.id, listing.price, listing.stock, refToBytes32(listing.metadataRef), !listing.active],
        chainId: GNOSIS_CHAIN_ID,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      await onChanged?.();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  /** Save edits: re-upload metadata JSON (title/description), new price. */
  async function saveEdit() {
    setBusy(true);
    setActionError(null);
    try {
      const priceSmallest = parseUnits(price.trim(), listing.decimals);
      if (priceSmallest <= 0n) throw new Error('Price must be greater than 0.');

      // stock is a COUNT — a non-negative integer (0 = sold out / paused), never
      // run through parseUnits. updateListing permits any value including 0.
      const stockCount = parseStockCount(stock);

      // Rebuild metadata from the existing fields + edited title/description.
      const meta = { version: 1, title: title.trim(), images: listing.images };
      if (listing.variant) meta.variant = listing.variant;
      if (description.trim()) meta.description = description.trim();
      if (listing.category) meta.category = listing.category;
      if (listing.attributes && Object.keys(listing.attributes).length) meta.attributes = listing.attributes;
      meta.payment = { token: listing.token, symbol: listing.symbol, decimals: listing.decimals };
      const metaObj = assertListingMetadata(meta);

      const bee = makeBee(BEE_URL);
      const metaRef = await uploadJson(bee, POSTAGE_BATCH_ID, metaObj);

      const hash = await writeContractAsync({
        abi: marketplaceAbi,
        address: MARKETPLACE_ADDRESS,
        functionName: 'updateListing',
        args: [listing.id, priceSmallest, stockCount, refToBytes32(metaRef), listing.active],
        chainId: GNOSIS_CHAIN_ID,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setEditing(false);
      await onChanged?.();
    } catch (err) {
      if (err instanceof SchemaValidationError) {
        setActionError(new Error(`Invalid ListingMetadata: ${JSON.stringify(err.errors)}`));
      } else {
        setActionError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ width: 56, height: 56, borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)', overflow: 'hidden', flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 22 }}>
          {listing.images[0] ? <img src={swarmImageUrl(BEE_URL, listing.images[0])} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🛍️'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontWeight: 700 }}>{listing.title}</span>
            <span style={{ color: 'var(--accent)', fontWeight: 700, whiteSpace: 'nowrap' }}>{listing.priceFormatted} {listing.symbol}</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
            #{listing.id.toString()} · {listing.variant || 'no variant'} {' · '}
            {listing.stockCount > 0
              ? <Pill tone="accent2">{listing.stockCount} in stock</Pill>
              : <Pill>sold out</Pill>}
            {' '}
            {listing.active ? <Pill tone="accent2">active</Pill> : <Pill>inactive</Pill>}
            {!listing.hasMetadata && <span style={{ color: '#ff6b6b', marginLeft: 8 }}>metadata unreadable</span>}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <GhostButton onClick={() => setEditing((v) => !v)} disabled={busy} style={{ padding: '8px 12px', fontSize: 13 }}>
          {editing ? 'Cancel' : 'Edit'}
        </GhostButton>
        <GhostButton onClick={toggleActive} disabled={busy || UPLOADS_DISABLED} style={{ padding: '8px 12px', fontSize: 13 }}>
          <Power size={14} /> {listing.active ? 'Deactivate' : 'Activate'}
        </GhostButton>
      </div>

      {editing && (
        <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          {UPLOADS_DISABLED && <Banner>Saving edits re-uploads metadata to Swarm — needs a postage batch.</Banner>}
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Description"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label={`Price (${listing.symbol}, ${listing.decimals} decimals)`}>
              <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="Stock (units)" hint="Whole number; 0 = sold out / paused.">
              <Input value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" />
            </Field>
          </div>
          <Button onClick={saveEdit} disabled={busy || UPLOADS_DISABLED || !title.trim() || !price.trim()}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}
      <ErrorNote error={actionError} />
    </Card>
  );
}

/** File input styled as a button (label wrapper avoids nested <button>). */
function FilePickerButton({ onPick, disabled }) {
  return (
    <label
      className="fm-btn"
      style={{
        border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)',
        fontFamily: 'var(--body)', fontWeight: 600, fontSize: 13, padding: '9px 13px',
        borderRadius: 10, display: 'inline-flex', alignItems: 'center', gap: 8,
        opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <UploadCloud size={15} /> Add image
      <input type="file" accept="image/*" disabled={disabled} style={{ display: 'none' }} onChange={(e) => onPick(e.target.files?.[0])} />
    </label>
  );
}
