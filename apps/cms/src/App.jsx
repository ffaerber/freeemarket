/**
 * FreeeMarket CMS / admin — sidebar console shell (design system).
 *
 * One SHARED app for all shops: the merchant connects their wallet and that
 * address IS their seller address. Left sidebar (shop chip + nav + node/key
 * HUD), a sticky topbar (section title + view-storefront + wallet), and the
 * active section in the content area. A connected wallet with no shop/handle
 * gets the first-run Onboarding wizard instead of the console.
 *
 * Styling: src/design/identity.css + pages.css. Contract writes are REAL.
 */
import React, { useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { LayoutGrid, Package, Inbox, Store, ExternalLink, Power, Wallet } from 'lucide-react';
import Dashboard from './sections/Dashboard.jsx';
import ShopSection from './sections/ShopSection.jsx';
import ListingsSection from './sections/ListingsSection.jsx';
import OrdersSection from './sections/OrdersSection.jsx';
import Onboarding from './sections/Onboarding.jsx';
import { useShopProfile } from './hooks/useShopProfile.js';
import { useMyHandle } from './hooks/useMyHandle.js';
import { Banner } from './ui.jsx';
import { UNCONFIGURED, UPLOADS_DISABLED, BEE_URL, GNOSIS_CHAIN_ID } from './config.js';

const STOREFRONT_BASE = 'https://freeemarket.eth.limo';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid, title: 'Dashboard' },
  { id: 'listings', label: 'Listings', icon: Package, title: 'Listings' },
  { id: 'orders', label: 'Orders', icon: Inbox, title: 'Orders' },
  { id: 'shop', label: 'Shop & shipping', icon: Store, title: 'Shop & shipping' },
];

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Wordmark() {
  return (
    <a href={STOREFRONT_BASE} className="fm-logo" target="_blank" rel="noreferrer">
      <span className="mk">fr</span><span className="eee">eee</span><span className="mk">market</span>
    </a>
  );
}

function WalletPill() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  if (isConnected) {
    return <button className="fm-wallet" onClick={() => disconnect()} title="Disconnect"><span className="fm-dot" /> {short(address)} <Power size={13} /></button>;
  }
  const injected = connectors[0];
  return (
    <button className="fm-wallet" onClick={() => injected && connect({ connector: injected, chainId: GNOSIS_CHAIN_ID })} disabled={isPending || !injected}>
      <Wallet size={14} /> {isPending ? 'connecting…' : 'connect wallet'}
    </button>
  );
}

/** Centered connect / unconfigured screen (no console until ready). */
function Gate({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 460, width: '100%', textAlign: 'center' }}>
        <div style={{ marginBottom: 22 }}><Wordmark /></div>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const { isConnected } = useAccount();
  const [tab, setTab] = useState('dashboard');

  const { registered, profile, isLoading: shopLoading } = useShopProfile();
  const { handle, isLoading: handleLoading } = useMyHandle();

  // Unconfigured build — no contract address.
  if (UNCONFIGURED) {
    return (
      <Gate>
        <h2 className="fm-h3" style={{ marginBottom: 10 }}>Merchant console</h2>
        <Banner tone="error">Unconfigured — set <code>VITE_MARKETPLACE_ADDRESS</code> (Gnosis) in <code>.env</code>. On-chain reads/writes are disabled.</Banner>
      </Gate>
    );
  }

  // Not connected — prompt to connect.
  if (!isConnected) {
    return (
      <Gate>
        <h2 className="fm-h3" style={{ marginBottom: 8 }}>Open your shop</h2>
        <p className="fm-body" style={{ marginBottom: 22 }}>Connect a wallet on Gnosis Chain — that address is your seller identity.</p>
        <div style={{ display: 'flex', justifyContent: 'center' }}><WalletPill /></div>
      </Gate>
    );
  }

  const gateLoading = shopLoading || handleLoading;
  const needsOnboarding = !gateLoading && (!registered || !handle);

  if (gateLoading) {
    return <Gate><p className="fm-body">Checking your shop…</p></Gate>;
  }
  if (needsOnboarding) {
    return (
      <div className="cms-content" style={{ maxWidth: 720, margin: '0 auto', paddingTop: 40 }}>
        <div style={{ marginBottom: 24 }}><Wordmark /></div>
        <Onboarding onDone={() => setTab('listings')} />
      </div>
    );
  }

  const shopName = profile?.name || handle;
  const active = TABS.find((t) => t.id === tab);
  const sectionEl =
    tab === 'dashboard' ? <Dashboard onNewListing={() => setTab('listings')} onGoOrders={() => setTab('orders')} onGoListings={() => setTab('listings')} />
    : tab === 'listings' ? <ListingsSection />
    : tab === 'orders' ? <OrdersSection />
    : <ShopSection />;

  return (
    <div className="cms">
      {/* SIDEBAR */}
      <aside className="fm-side cms-side">
        <div className="side-head">
          <Wordmark />
          <div className="fm-kicker" style={{ fontSize: 9.5, marginTop: 6, color: 'var(--fg-soft)' }}>// merchant console</div>
          <div className="side-shop">
            <div className="side-shop-ic">🛍️</div>
            <div style={{ minWidth: 0 }}>
              <div className="fm-mono" style={{ fontSize: 12, color: 'var(--fg)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{shopName}</div>
              <div className="fm-mono fm-small" style={{ fontSize: 10, color: 'var(--phos-500)' }}>/{handle}</div>
            </div>
          </div>
        </div>
        <nav className="side-nav">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`fm-side-link${id === tab ? ' is-active' : ''}`} onClick={() => setTab(id)}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="fm-hud" style={{ padding: '12px 14px', fontSize: 11 }}>
            <div className="fm-hud-row" style={{ padding: '4px 0' }}><span className="fm-hud-key">node</span><span className="fm-hud-val">{UPLOADS_DISABLED ? 'no stamp' : 'bee · ok'}</span></div>
            <div className="fm-hud-row" style={{ padding: '4px 0' }}><span className="fm-hud-key">network</span><span className="fm-hud-val fm-hud-val--neon">gnosis · 100</span></div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <div className="cms-main">
        <header className="cms-topbar">
          <div className="fm-eyebrow-title">{active?.title}</div>
          <div className="fm-nav-spacer" />
          <a href={`${STOREFRONT_BASE}/${handle}`} className="fm-btn fm-btn--ghost fm-btn--sm" target="_blank" rel="noreferrer">
            View storefront <ExternalLink size={13} />
          </a>
          <WalletPill />
        </header>

        <div className="cms-content">
          {UPLOADS_DISABLED && (
            <Banner>Uploads disabled — no Swarm postage batch (<code>VITE_POSTAGE_BATCH_ID</code>). Saving a profile or listing needs a writeable Bee node (<code>{BEE_URL}</code>) + a stamp.</Banner>
          )}
          {sectionEl}
        </div>
      </div>
    </div>
  );
}
