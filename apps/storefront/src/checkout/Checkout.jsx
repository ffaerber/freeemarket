/**
 * Checkout — REAL escrow flow on Gnosis, styled like the template's preview.
 *
 * Steps:
 *   1. Connect wallet (wagmi injected connector).
 *   2. Approve the listing's ERC-20 for the marketplace if allowance < price.
 *   3. `buy(listingId)` → wait for receipt → parse `OrderFunded` for orderId.
 *   4. Collect a shipping address and hand it to the messaging boundary
 *      (`sendEncryptedAddress`) — currently a STUB that returns
 *      { delivered: false } pending @freemarket/messaging (CLAUDE.md §5).
 *
 * All on-chain writes use wagmi `useWriteContract` + `useWaitForTransactionReceipt`.
 * Real tx hashes link to gnosisscan; real errors surface inline.
 */
import React, { useEffect, useState } from 'react';
import {
  useAccount,
  useConnect,
  useReadContract,
  useWriteContract,
  usePublicClient,
} from 'wagmi';
import { parseEventLogs } from 'viem';
import { ShoppingBag, X, Check, Lock, Wallet, Truck, ArrowRight, AlertTriangle } from 'lucide-react';
import { marketplaceAbi } from '../abi/marketplace.js';
import { erc20Abi } from '../abi/erc20.js';
import { sendEncryptedAddress } from '../messaging/index.js';
import {
  MARKETPLACE_ADDRESS,
  GNOSIS_CHAIN_ID,
  EXPLORER_URL,
  BEE_URL,
} from '../config.js';
import { Pill } from '../ui.jsx';

function StepShell({ icon: Icon, title, body, children }) {
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 18 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon size={22} />
        </div>
        <div>
          <div style={{ fontFamily: 'var(--display)', fontSize: 22, lineHeight: 1.05 }}>{title}</div>
          <div style={{ fontFamily: 'var(--body)', color: 'var(--muted)', fontSize: 14, marginTop: 4, lineHeight: 1.5 }}>{body}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function PrimaryButton({ onClick, disabled, children }) {
  return (
    <button
      className="fm-btn"
      onClick={onClick}
      disabled={disabled}
      style={{ width: '100%', border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--body)', fontWeight: 700, fontSize: 15, padding: '15px', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: disabled ? 0.55 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      {children}
    </button>
  );
}

function TxLink({ hash, label }) {
  if (!hash) return null;
  return (
    <a href={`${EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--accent)', display: 'inline-block', marginTop: 8 }}>
      {label || 'View tx'}: {hash.slice(0, 10)}…
    </a>
  );
}

function ErrorNote({ error }) {
  if (!error) return null;
  const msg = error.shortMessage || error.message || String(error);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, color: '#ff6b6b', fontSize: 13, fontFamily: 'var(--body)' }}>
      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{msg}</span>
    </div>
  );
}

export default function Checkout({ shop, item, onClose }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: connecting, error: connectError } = useConnect();
  const publicClient = usePublicClient({ chainId: GNOSIS_CHAIN_ID });

  // phase: connect → approve → buy → address → done
  const [phase, setPhase] = useState('connect');
  const [orderId, setOrderId] = useState(null);
  const [buyHash, setBuyHash] = useState(null);
  const [approveHash, setApproveHash] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [name, setName] = useState('');
  const [shipTo, setShipTo] = useState('');
  const [deliveryResult, setDeliveryResult] = useState(null);

  const { writeContractAsync } = useWriteContract();

  // Current allowance for buyer → marketplace, in the listing's token.
  const allowanceRead = useReadContract({
    abi: erc20Abi,
    address: item.token,
    functionName: 'allowance',
    args: address && MARKETPLACE_ADDRESS ? [address, MARKETPLACE_ADDRESS] : undefined,
    chainId: GNOSIS_CHAIN_ID,
    query: { enabled: Boolean(address && item.token && MARKETPLACE_ADDRESS) },
  });

  // Advance from connect → approve/buy once a wallet is connected.
  useEffect(() => {
    if (phase === 'connect' && isConnected) {
      setPhase('approve');
    }
  }, [isConnected, phase]);

  // Skip approve if allowance already covers the price.
  useEffect(() => {
    if (phase === 'approve' && allowanceRead.data != null) {
      if (allowanceRead.data >= item.price) setPhase('buy');
    }
  }, [phase, allowanceRead.data, item.price]);

  async function doConnect() {
    setActionError(null);
    const injected = connectors[0];
    if (!injected) {
      setActionError(new Error('No injected wallet found. Install MetaMask or use Freedom Browser.'));
      return;
    }
    connect({ connector: injected, chainId: GNOSIS_CHAIN_ID });
  }

  async function doApprove() {
    setBusy(true);
    setActionError(null);
    try {
      const hash = await writeContractAsync({
        abi: erc20Abi,
        address: item.token,
        functionName: 'approve',
        args: [MARKETPLACE_ADDRESS, item.price],
        chainId: GNOSIS_CHAIN_ID,
      });
      setApproveHash(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      await allowanceRead.refetch?.();
      setPhase('buy');
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function doBuy() {
    setBusy(true);
    setActionError(null);
    try {
      const hash = await writeContractAsync({
        abi: marketplaceAbi,
        address: MARKETPLACE_ADDRESS,
        functionName: 'buy',
        args: [item.id],
        chainId: GNOSIS_CHAIN_ID,
      });
      setBuyHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      // Parse OrderFunded to recover the orderId.
      const events = parseEventLogs({
        abi: marketplaceAbi,
        eventName: 'OrderFunded',
        logs: receipt.logs,
      });
      const funded = events.find((e) => e.args?.buyer?.toLowerCase() === address?.toLowerCase());
      const oid = funded?.args?.orderId ?? events[0]?.args?.orderId ?? null;
      setOrderId(oid);
      setPhase('address');
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  async function doSendAddress() {
    setBusy(true);
    setActionError(null);
    try {
      // Real boundary — swapping in @freemarket/messaging is a one-file change.
      const result = await sendEncryptedAddress({
        orderId,
        seller: shop.seller,
        // sellerPubKey: resolved from ContactRegistry in the real impl.
        address: { name, address: shipTo },
        beeUrl: BEE_URL,
      });
      setDeliveryResult(result);
      setPhase('done');
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  }

  const phaseIndex = { connect: 0, approve: 1, buy: 2, address: 3, done: 4 }[phase];

  return (
    <div className="fm-overlay" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50, backdropFilter: 'blur(3px)' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: 'var(--surface)', color: 'var(--text)', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, border: '1px solid var(--border)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <Pill t>Checkout · {item.priceFormatted} {item.symbol}</Pill>
          <X size={20} className="fm-x" onClick={onClose} style={{ color: 'var(--text)' }} />
        </div>

        {/* progress */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 4, background: i < phaseIndex ? 'var(--accent)' : 'var(--border)', transition: 'background .3s' }} />
          ))}
        </div>

        {phase === 'connect' && (
          <StepShell icon={Wallet} title="Connect wallet" body="Connect on Gnosis Chain to pay into escrow.">
            <PrimaryButton onClick={doConnect} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Connect wallet'} <ArrowRight size={17} />
            </PrimaryButton>
            <ErrorNote error={connectError || actionError} />
          </StepShell>
        )}

        {phase === 'approve' && (
          <StepShell icon={Lock} title={`Approve ${item.symbol}`} body={`Allow the marketplace to pull ${item.priceFormatted} ${item.symbol} for this order.`}>
            <PrimaryButton onClick={doApprove} disabled={busy}>
              {busy ? 'Approving…' : `Approve ${item.symbol}`} <ArrowRight size={17} />
            </PrimaryButton>
            <TxLink hash={approveHash} label="Approval" />
            <ErrorNote error={actionError} />
          </StepShell>
        )}

        {phase === 'buy' && (
          <StepShell icon={ShoppingBag} title="Pay into escrow" body="Funds are held by the contract — not the seller — until you confirm delivery (or the timeout elapses).">
            <PrimaryButton onClick={doBuy} disabled={busy}>
              {busy ? 'Confirming…' : `Pay ${item.priceFormatted} ${item.symbol}`} <ArrowRight size={17} />
            </PrimaryButton>
            <TxLink hash={buyHash} label="Order" />
            <ErrorNote error={actionError} />
          </StepShell>
        )}

        {phase === 'address' && (
          <StepShell icon={Truck} title="Send shipping address" body="Your address is encrypted to the shop's key and sent over Swarm PSS — never on-chain in plaintext.">
            <input
              placeholder="Full name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--body)', fontSize: 14, marginBottom: 10 }}
            />
            <textarea
              placeholder="Shipping address"
              value={shipTo}
              onChange={(e) => setShipTo(e.target.value)}
              rows={3}
              style={{ width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'var(--body)', fontSize: 14, marginBottom: 12, resize: 'vertical' }}
            />
            <PrimaryButton onClick={doSendAddress} disabled={busy || !name || !shipTo}>
              {busy ? 'Encrypting & sending…' : 'Send encrypted address'} <ArrowRight size={17} />
            </PrimaryButton>
            {orderId != null && (
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>
                order #{orderId.toString()} funded
              </div>
            )}
            <ErrorNote error={actionError} />
          </StepShell>
        )}

        {phase === 'done' && (
          <div style={{ textAlign: 'center', padding: '18px 0 8px' }}>
            <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
              <Check size={28} />
            </div>
            <div style={{ fontFamily: 'var(--display)', fontSize: 26, marginBottom: 6 }}>Order placed</div>
            <div style={{ fontFamily: 'var(--body)', color: 'var(--muted)', fontSize: 14, lineHeight: 1.5 }}>
              {item.priceFormatted} {item.symbol} is escrowed on Gnosis (order #{orderId?.toString()}). It releases to {shop.name} when you confirm the package arrived — or auto-releases after the timeout. Dispute any time before that.
            </div>
            <TxLink hash={buyHash} label="Escrow tx" />
            {deliveryResult?.stub && (
              <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'color-mix(in srgb, var(--accent) 6%, transparent)', textAlign: 'left' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.5 }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1, color: 'var(--accent2)' }} />
                  <span>
                    <strong>PSS delivery pending.</strong> The escrow is real, but encrypted-address delivery is stubbed
                    (<code>delivered: false</code>) until <code>@freemarket/messaging</code> lands (CLAUDE.md §5). The
                    address was validated and would be ECIES-encrypted and sent over Swarm PSS to the seller's key.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
