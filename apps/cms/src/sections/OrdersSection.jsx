/**
 * OrdersSection — escrow order dashboard for the connected merchant.
 *
 * Reads OrderFunded logs (seller == me) → current orders(orderId) state, with
 * token-decimal-formatted amounts (never hardcoded). Per order:
 *   - "Decrypt shipping address" → LIVE PSS receive + ECIES decrypt via
 *     @freeemarket/messaging (src/messaging), using the merchant's locally
 *     unlocked private key; falls back to a stub when unconfigured.
 *   - "Send tracking code" → LIVE seller→buyer shipment update via
 *     @freeemarket/messaging (encrypted to the buyer's ContactRegistry key,
 *     signed by the seller's wallet); stub fallback when unconfigured.
 *   - claimAfterTimeout(orderId): shown when Funded AND the autoReleasePeriod
 *     has elapsed since fundedAt.
 *   - openDispute(orderId): shown while Funded.
 *   - resolveDispute(orderId, refundBuyer): arbiter-only — shown only when the
 *     connected wallet == contract owner() AND the order is Disputed.
 *   - "Mark shipped": OFF-CHAIN, localStorage-only note. There is NO on-chain
 *     shipped state — fulfillment isn't tracked by the contract; the real signal
 *     is the buyer's confirmReceipt or the timeout. This is purely a local memo.
 */
import React, { useState } from 'react';
import { useAccount, useReadContract, useWriteContract, usePublicClient, useWalletClient } from 'wagmi';
import { getAddress } from 'viem';
import { Lock, Clock, Gavel, Truck, RefreshCw, ShieldCheck, KeyRound, Send } from 'lucide-react';
import { marketplaceAbi, orderStateLabel } from '../abi/marketplace.js';
import { useOrders } from '../hooks/useOrders.js';
import { receiveDecryptedAddress, sendShipmentUpdateFromCms, makeSignDigest } from '../messaging/index.js';
import { usePostageBatch } from '../hooks/usePostageBatch.js';
import { MARKETPLACE_ADDRESS, GNOSIS_CHAIN_ID, EXPLORER_URL, BEE_URL } from '../config.js';
import { Card, Button, GhostButton, SectionHeader, Banner, ErrorNote, Pill } from '../ui.jsx';

const STATE = { NONE: 0, FUNDED: 1, COMPLETED: 2, DISPUTED: 3, REFUNDED: 4 };

/** localStorage key for the off-chain "shipped" memo (no on-chain equivalent). */
const SHIPPED_KEY = 'fmkt.cms.shipped';

function readShipped() {
  try {
    return JSON.parse(localStorage.getItem(SHIPPED_KEY) || '{}');
  } catch {
    return {};
  }
}
function writeShipped(map) {
  try {
    localStorage.setItem(SHIPPED_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota/availability errors — it's a non-critical local memo */
  }
}

/**
 * Local keystore stand-in: the merchant's ECIES DECRYPTION PRIVATE KEY, unlocked
 * at RUNTIME only. Held in React state (optionally mirrored to sessionStorage for
 * the tab's lifetime — NEVER localStorage by default), never logged, never sent
 * anywhere, never read from VITE_ env (which would bake it into the bundle).
 * (CLAUDE.md §5 key custody.)
 */
const PRIVKEY_SESSION_KEY = 'fmkt.cms.unlockedKey';

export default function OrdersSection() {
  const { address } = useAccount();
  const { orders, autoReleasePeriod, isLoading, error, refetch } = useOrders();

  // Unlocked ECIES private key — sessionStorage only (cleared when the tab/browser
  // closes), opt-in. Default is in-memory React state for max safety.
  const [privateKey, setPrivateKey] = useState(() => {
    try {
      return sessionStorage.getItem(PRIVKEY_SESSION_KEY) || '';
    } catch {
      return '';
    }
  });
  const [remember, setRemember] = useState(false);

  function onUnlockChange(value) {
    setPrivateKey(value);
    if (remember) {
      try {
        sessionStorage.setItem(PRIVKEY_SESSION_KEY, value);
      } catch {
        /* sessionStorage unavailable — keep in memory only */
      }
    }
  }
  function onRememberChange(checked) {
    setRemember(checked);
    try {
      if (checked) sessionStorage.setItem(PRIVKEY_SESSION_KEY, privateKey);
      else sessionStorage.removeItem(PRIVKEY_SESSION_KEY);
    } catch {
      /* ignore */
    }
  }
  function lockKey() {
    setPrivateKey('');
    setRemember(false);
    try {
      sessionStorage.removeItem(PRIVKEY_SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  // Is the connected wallet the arbiter (contract owner)?
  const ownerRead = useReadContract({
    abi: marketplaceAbi,
    address: MARKETPLACE_ADDRESS || undefined,
    functionName: 'owner',
    chainId: GNOSIS_CHAIN_ID,
    query: { enabled: Boolean(MARKETPLACE_ADDRESS) },
  });
  const isArbiter =
    Boolean(address && ownerRead.data && getAddress(ownerRead.data) === getAddress(address));

  return (
    <div>
      <SectionHeader
        title="Orders"
        subtitle="Escrowed orders against your shop. Shipping addresses arrive off-chain over Swarm PSS (decrypt below). Fulfillment isn't on-chain — escrow releases on the buyer's confirmReceipt or after the timeout."
        right={<GhostButton onClick={() => refetch()}><RefreshCw size={14} /> Refresh</GhostButton>}
      />

      {isArbiter && <Banner tone="info">You are the contract arbiter (owner) — dispute resolution controls are enabled.</Banner>}
      {error && <Banner tone="error">Couldn't load orders: {error.shortMessage || error.message}</Banner>}

      {/* Local keystore unlock — the merchant's ECIES private key, runtime only. */}
      <Card style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <KeyRound size={15} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 14 }}>Unlock decryption key</span>
          {privateKey && <Pill tone="accent2">unlocked</Pill>}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 8 }}>
          Paste your ECIES <strong>private</strong> key to decrypt buyer addresses below. It stays on this machine —
          held in memory (or this tab's sessionStorage if you tick "remember"), never logged, never sent, never in env.
          Run the CMS locally. (CLAUDE.md §5)
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="password"
            placeholder="0x… ECIES private key (local only)"
            value={privateKey}
            onChange={(e) => onUnlockChange(e.target.value)}
            autoComplete="off"
            style={{ flex: '1 1 260px', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--muted)' }}>
            <input type="checkbox" checked={remember} onChange={(e) => onRememberChange(e.target.checked)} />
            remember (session)
          </label>
          {privateKey && <GhostButton onClick={lockKey} style={{ padding: '8px 12px', fontSize: 13 }}>Lock</GhostButton>}
        </div>
      </Card>

      {isLoading && <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading orders from Gnosis…</div>}
      {!isLoading && orders.length === 0 && (
        <div style={{ color: 'var(--muted)', fontSize: 13 }}>No orders yet.</div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {orders.map((o) => (
          <OrderRow
            key={o.orderId.toString()}
            order={o}
            autoReleasePeriod={autoReleasePeriod}
            isArbiter={isArbiter}
            sellerAddress={address}
            privateKey={privateKey}
            onChanged={refetch}
          />
        ))}
      </div>
    </div>
  );
}

function OrderRow({ order, autoReleasePeriod, isArbiter, sellerAddress, privateKey, onChanged }) {
  const publicClient = usePublicClient({ chainId: GNOSIS_CHAIN_ID });
  const { data: walletClient } = useWalletClient({ chainId: GNOSIS_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const { batchId } = usePostageBatch();

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [decrypting, setDecrypting] = useState(false);
  const [decryptResult, setDecryptResult] = useState(null);
  const [shippedMap, setShippedMap] = useState(readShipped);

  // Tracking-code send (seller→buyer) form state.
  const [carrier, setCarrier] = useState('');
  const [trackingCode, setTrackingCode] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);
  const [sendError, setSendError] = useState(null);

  const oid = order.orderId.toString();
  const shipped = Boolean(shippedMap[oid]);

  // Timeout eligibility: Funded + (now >= fundedAt + autoReleasePeriod).
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const releaseAt = order.fundedAt + autoReleasePeriod;
  const timeoutEligible = order.state === STATE.FUNDED && autoReleasePeriod > 0n && nowSec >= releaseAt;

  async function runWrite(functionName, args) {
    setBusy(true);
    setActionError(null);
    try {
      const hash = await writeContractAsync({
        abi: marketplaceAbi,
        address: MARKETPLACE_ADDRESS,
        functionName,
        args,
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

  async function decryptAddress() {
    setDecrypting(true);
    setActionError(null);
    try {
      // LIVE: decrypts with the unlocked private key when a Bee node is set; else stub.
      const result = await receiveDecryptedAddress({
        orderId: order.orderId,
        seller: sellerAddress,
        buyer: order.buyer,
        recipientPrivateKey: privateKey?.trim() || undefined,
        beeUrl: BEE_URL,
      });
      setDecryptResult(result);
    } catch (err) {
      setActionError(err);
    } finally {
      setDecrypting(false);
    }
  }

  async function sendTracking() {
    setSending(true);
    setSendError(null);
    try {
      const signMessage =
        walletClient && sellerAddress ? makeSignDigest(walletClient, sellerAddress) : undefined;
      const result = await sendShipmentUpdateFromCms({
        orderId: order.orderId,
        buyer: order.buyer,
        seller: sellerAddress,
        update: { carrier, trackingCode, note },
        publicClient,
        signMessage,
        beeUrl: BEE_URL,
        postageBatchId: batchId,
      });
      setSendResult(result);
    } catch (err) {
      setSendError(err);
    } finally {
      setSending(false);
    }
  }

  /** Off-chain only: local memo, no contract state exists for "shipped". */
  function toggleShipped() {
    const next = { ...shippedMap };
    if (next[oid]) delete next[oid];
    else next[oid] = new Date().toISOString();
    writeShipped(next);
    setShippedMap(next);
  }

  const fundedDate = order.fundedAt > 0n ? new Date(Number(order.fundedAt) * 1000) : null;

  return (
    <Card style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 700 }}>Order #{oid}</span>
            <StatePill state={order.state} />
            {shipped && <Pill tone="accent2">shipped (local)</Pill>}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 5, fontFamily: 'ui-monospace, monospace' }}>
            listing #{order.listingId.toString()} · buyer {order.buyer.slice(0, 6)}…{order.buyer.slice(-4)}
          </div>
          {fundedDate && (
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 3 }}>
              funded {fundedDate.toLocaleString()}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: 'var(--accent)', fontWeight: 700 }}>{order.amountFormatted} {order.symbol}</div>
          <a href={`${EXPLORER_URL}/tx/${order.txHash}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--muted)' }}>
            funding tx ↗
          </a>
        </div>
      </div>

      {/* Shipping address — LIVE PSS receive + ECIES decrypt (stub when unconfigured). */}
      <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GhostButton onClick={decryptAddress} disabled={decrypting} style={{ padding: '8px 12px', fontSize: 13 }}>
            <Lock size={14} /> {decrypting ? 'Decrypting…' : 'Decrypt shipping address'}
          </GhostButton>
          <GhostButton onClick={toggleShipped} style={{ padding: '8px 12px', fontSize: 13 }}>
            <Truck size={14} /> {shipped ? 'Unmark shipped' : 'Mark shipped'}
          </GhostButton>
        </div>
        {decryptResult?.decrypted && decryptResult.address && (
          <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--accent2)', background: 'color-mix(in srgb, var(--accent2) 8%, transparent)', fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
            <div><strong>{decryptResult.address.name}</strong></div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{decryptResult.address.address}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>
              Decrypted locally · envelope signer verified == order buyer.
            </div>
          </div>
        )}
        {decryptResult && !decryptResult.decrypted && (
          <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'color-mix(in srgb, var(--accent) 6%, transparent)', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
            {decryptResult.stub ? (
              <>
                <strong>PSS decrypt unconfigured.</strong> Returned <code>decrypted: false</code> — unlock your ECIES
                private key above and point <code>VITE_BEE_URL</code> at a full Bee node. The live boundary reads the
                buyer's PSS message / recipient feed, verifies the signed envelope's sender == this order's buyer, and
                ECIES-decrypts with your key (CLAUDE.md §5). Run this CMS locally so the key + plaintext never leave.
              </>
            ) : (
              <>
                <strong>No address yet.</strong> No valid envelope found for this order
                {decryptResult.rejected ? ` (${decryptResult.rejected} rejected as forgeries / wrong order)` : ''}.
                The buyer may not have sent it yet.
              </>
            )}
          </div>
        )}
      </div>

      {/* Send tracking code (seller→buyer) — LIVE when configured; stub otherwise. */}
      <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Send size={14} style={{ color: 'var(--accent)' }} />
          <span style={{ fontWeight: 700, fontSize: 13 }}>Send tracking code to buyer</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <input
            placeholder="Carrier (e.g. DHL)"
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            style={{ flex: '1 1 120px', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12.5 }}
          />
          <input
            placeholder="Tracking code"
            value={trackingCode}
            onChange={(e) => setTrackingCode(e.target.value)}
            style={{ flex: '1 1 160px', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12.5 }}
          />
        </div>
        <input
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12.5, marginBottom: 8 }}
        />
        <GhostButton
          onClick={sendTracking}
          disabled={sending || (!carrier && !trackingCode && !note)}
          style={{ padding: '8px 12px', fontSize: 13 }}
        >
          <Send size={14} /> {sending ? 'Sending…' : 'Encrypt & send tracking'}
        </GhostButton>
        {sendResult?.delivered && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--accent2)' }}>
            Tracking sent over Swarm PSS (encrypted to the buyer's key, signed by you).
          </div>
        )}
        {sendResult?.stub && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
            <strong>Tracking send unconfigured.</strong> Set <code>VITE_CONTACT_REGISTRY</code> (to resolve the buyer's
            key), <code>VITE_BEE_URL</code> (full node), and <code>VITE_POSTAGE_BATCH_ID</code>, and connect your
            wallet to sign. Falls back to a stub until then.
          </div>
        )}
        <ErrorNote error={sendError} />
      </div>

      {/* State-driven actions. */}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {order.state === STATE.FUNDED && (
          <GhostButton onClick={() => runWrite('openDispute', [order.orderId])} disabled={busy} style={{ padding: '8px 12px', fontSize: 13 }}>
            <Gavel size={14} /> Open dispute
          </GhostButton>
        )}
        {timeoutEligible && (
          <Button onClick={() => runWrite('claimAfterTimeout', [order.orderId])} disabled={busy} style={{ padding: '8px 12px', fontSize: 13 }}>
            <Clock size={14} /> Claim (timeout elapsed)
          </Button>
        )}
        {order.state === STATE.FUNDED && !timeoutEligible && autoReleasePeriod > 0n && (
          <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
            Claimable after {new Date(Number(releaseAt) * 1000).toLocaleDateString()} if buyer is silent.
          </span>
        )}
        {isArbiter && order.state === STATE.DISPUTED && (
          <>
            <Button onClick={() => runWrite('resolveDispute', [order.orderId, false])} disabled={busy} style={{ padding: '8px 12px', fontSize: 13 }}>
              <ShieldCheck size={14} /> Resolve → pay seller
            </Button>
            <GhostButton onClick={() => runWrite('resolveDispute', [order.orderId, true])} disabled={busy} style={{ padding: '8px 12px', fontSize: 13 }}>
              Resolve → refund buyer
            </GhostButton>
          </>
        )}
      </div>
      <ErrorNote error={actionError} />
    </Card>
  );
}

function StatePill({ state }) {
  const label = orderStateLabel(state);
  const tone = state === STATE.COMPLETED ? 'accent2' : state === STATE.DISPUTED ? 'accent' : 'accent';
  return <Pill tone={tone}>{label}</Pill>;
}
