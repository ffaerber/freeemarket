/**
 * Dashboard — merchant overview. Real on-chain stats (listings + orders) for the
 * connected wallet, in the design's stat cards + orders table. No fabricated
 * numbers: everything is derived from useMyListings / useOrders.
 */
import React, { useMemo } from 'react';
import { useMyListings } from '../hooks/useMyListings.js';
import { useOrders } from '../hooks/useOrders.js';
import { orderStateLabel } from '../abi/marketplace.js';
import { EXPLORER_URL } from '../config.js';
import { Button } from '../ui.jsx';

const BADGE = { 1: 'fm-badge--funded', 2: 'fm-badge--completed', 3: 'fm-badge--disputed', 4: '' };

export default function Dashboard({ onNewListing, onGoOrders, onGoListings }) {
  const { listings, isLoading: lLoad } = useMyListings();
  const { orders, isLoading: oLoad } = useOrders();

  const titleById = useMemo(() => {
    const m = new Map();
    for (const l of listings) m.set(l.id.toString(), l.title);
    return m;
  }, [listings]);

  const active = listings.filter((l) => l.active).length;
  const lowStock = listings.filter((l) => l.active && l.stockCount > 0 && l.stockCount <= 5).length;
  const funded = orders.filter((o) => o.state === 1).length;
  const completed = orders.filter((o) => o.state === 2).length;
  const disputed = orders.filter((o) => o.state === 3).length;
  const recent = [...orders].sort((a, b) => Number(b.fundedAt - a.fundedAt)).slice(0, 5);

  const Stat = ({ label, num, numCls, delta, deltaStyle }) => (
    <div className="fm-stat">
      <div className="fm-stat-label">{label}</div>
      <div className={`fm-stat-num ${numCls || ''}`}>{num}</div>
      {delta && <div className="fm-stat-delta" style={deltaStyle}>{delta}</div>}
    </div>
  );

  return (
    <div>
      <div className="stat-grid">
        <Stat label="Active listings" num={lLoad ? '—' : active} delta={lowStock ? `${lowStock} low stock` : 'all stocked'} />
        <Stat label="Orders funded" num={oLoad ? '—' : funded} numCls="fm-stat-num--neon" delta="awaiting fulfilment" />
        <Stat label="Completed" num={oLoad ? '—' : completed} numCls="fm-stat-num--phos" delta="100 % paid to you" />
        <Stat label="Open disputes" num={oLoad ? '—' : disputed} numCls="fm-stat-num--amber" delta={disputed ? 'awaiting arbiter' : 'none'} deltaStyle={disputed ? { color: 'var(--amber-500)' } : undefined} />
      </div>

      <div className="cms-panel">
        <div className="cms-panel-head">
          <span className="cms-panel-title">// recent orders</span>
          <button className="fm-btn fm-btn--quiet" style={{ fontSize: 11 }} onClick={onGoOrders}>View all →</button>
        </div>
        {oLoad ? (
          <div style={{ padding: 18 }} className="fm-body">Loading orders…</div>
        ) : recent.length === 0 ? (
          <div style={{ padding: 18 }} className="fm-body">No orders yet. Share your shop link to get your first sale.</div>
        ) : (
          <table className="fm-table">
            <thead><tr><th>Order</th><th>Item</th><th>Amount</th><th>Status</th></tr></thead>
            <tbody>
              {recent.map((o) => (
                <tr key={o.orderId.toString()}>
                  <td className="fm-mono-cell">
                    <a href={`${EXPLORER_URL}/tx/${o.txHash}`} target="_blank" rel="noreferrer">#{o.orderId.toString()}</a>
                  </td>
                  <td>{titleById.get(o.listingId.toString()) || `Listing #${o.listingId.toString()}`}</td>
                  <td className="fm-mono-cell" style={{ color: 'var(--neon-300)' }}>{o.amountFormatted} {o.symbol}</td>
                  <td><span className={`fm-badge ${BADGE[o.state] || ''}`}>{orderStateLabel(o.state).toLowerCase()}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 22, flexWrap: 'wrap' }}>
        <Button onClick={onNewListing}>+ New listing</Button>
        <button className="fm-btn fm-btn--ghost" onClick={onGoListings}>Manage listings</button>
        <button className="fm-btn fm-btn--ghost" onClick={onGoOrders}>Fulfil orders</button>
      </div>
    </div>
  );
}
