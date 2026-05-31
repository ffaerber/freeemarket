/**
 * OrdersSection — escrow order dashboard for the connected merchant.
 *
 * Reads OrderFunded logs (seller == me) → current orders(orderId) state, with
 * token-decimal-formatted amounts (never hardcoded). Per order:
 *   - "Decrypt shipping address" → calls the STUBBED PSS receive/decrypt
 *     boundary (src/messaging). Swapping in @freemarket/messaging is one file.
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
import { useAccount, useReadContract, useWriteContract, usePublicClient } from 'wagmi';
import { getAddress } from 'viem';
import { Lock, Clock, Gavel, Truck, RefreshCw, ShieldCheck } from 'lucide-react';
import { marketplaceAbi, orderStateLabel } from '../abi/marketplace.js';
import { useOrders } from '../hooks/useOrders.js';
import { receiveDecryptedAddress } from '../messaging/index.js';
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

export default function OrdersSection() {
  const { address } = useAccount();
  const { orders, autoReleasePeriod, isLoading, error, refetch } = useOrders();

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
            onChanged={refetch}
          />
        ))}
      </div>
    </div>
  );
}

function OrderRow({ order, autoReleasePeriod, isArbiter, sellerAddress, onChanged }) {
  const publicClient = usePublicClient({ chainId: GNOSIS_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [decrypting, setDecrypting] = useState(false);
  const [decryptResult, setDecryptResult] = useState(null);
  const [shippedMap, setShippedMap] = useState(readShipped);

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
      // Real boundary — swapping in @freemarket/messaging is a one-file change.
      const result = await receiveDecryptedAddress({
        orderId: order.orderId,
        seller: sellerAddress,
        buyer: order.buyer,
        beeUrl: BEE_URL,
      });
      setDecryptResult(result);
    } catch (err) {
      setActionError(err);
    } finally {
      setDecrypting(false);
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

      {/* Shipping address (stubbed PSS decrypt). */}
      <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <GhostButton onClick={decryptAddress} disabled={decrypting} style={{ padding: '8px 12px', fontSize: 13 }}>
            <Lock size={14} /> {decrypting ? 'Decrypting…' : 'Decrypt shipping address'}
          </GhostButton>
          <GhostButton onClick={toggleShipped} style={{ padding: '8px 12px', fontSize: 13 }}>
            <Truck size={14} /> {shipped ? 'Unmark shipped' : 'Mark shipped'}
          </GhostButton>
        </div>
        {decryptResult?.stub && (
          <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'color-mix(in srgb, var(--accent) 6%, transparent)', fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>
            <strong>PSS decrypt stubbed.</strong> Returned <code>decrypted: false</code>. The real boundary
            reads the buyer's PSS message / recipient feed, verifies the signed envelope's sender == this
            order's buyer, and ECIES-decrypts with your private key — pending <code>@freemarket/messaging</code>
            (CLAUDE.md §5). Run this CMS locally so that key + the plaintext address never leave your machine.
          </div>
        )}
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
