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
import { useAccount } from 'wagmi';
import { LayoutGrid, Package, Inbox, Store, ExternalLink } from 'lucide-react';
import { SwarmConnectButton, useBeeNode } from '@ffaerber/swarm-connect';
import Dashboard from './sections/Dashboard.jsx';
import ShopSection from './sections/ShopSection.jsx';
import ListingsSection from './sections/ListingsSection.jsx';
import OrdersSection from './sections/OrdersSection.jsx';
import Onboarding from './sections/Onboarding.jsx';
import { useShopProfile } from './hooks/useShopProfile.js';
import { useMyHandle } from './hooks/useMyHandle.js';
import { usePostageBatch } from './hooks/usePostageBatch.js';
import { Banner } from './ui.jsx';
import { UNCONFIGURED, BEE_URL } from './config.js';

const STOREFRONT_BASE = 'https://freeemarket.eth.limo';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid, title: 'Dashboard' },
  { id: 'listings', label: 'Listings', icon: Package, title: 'Listings' },
  { id: 'orders', label: 'Orders', icon: Inbox, title: 'Orders' },
  { id: 'shop', label: 'Shop & shipping', icon: Store, title: 'Shop & shipping' },
];

function Wordmark() {
  return (
    <a href={STOREFRONT_BASE} className="fm-logo" target="_blank" rel="noreferrer">
      <span className="mk">fr</span><span className="eee">eee</span><span className="mk">market</span>
    </a>
  );
}

/** Swarm connect wizard (wallet + Bee node + postage stamp), pinned to our node. */
function SwarmConnect() {
  return <SwarmConnectButton beeApiUrl={BEE_URL} />;
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
  const node = useBeeNode(BEE_URL); // live Bee node health for the sidebar HUD
  const { ready: uploadsReady, isChecking: batchChecking } = usePostageBatch();

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
        <p className="fm-body" style={{ marginBottom: 22 }}>Connect your wallet, Bee node and a postage stamp — that address is your seller identity.</p>
        <div style={{ display: 'flex', justifyContent: 'center' }}><SwarmConnect /></div>
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
            <div className="fm-hud-row" style={{ padding: '4px 0' }}>
              <span className="fm-hud-key">node</span>
              <span className={`fm-hud-val${node.isRunning ? ' fm-hud-val--neon' : ''}`}>
                {node.isChecking ? 'checking…' : node.isRunning ? `bee · ${node.version || 'ok'}` : 'offline'}
              </span>
            </div>
            <div className="fm-hud-row" style={{ padding: '4px 0' }}>
              <span className="fm-hud-key">stamp</span>
              <span className={`fm-hud-val${uploadsReady ? ' fm-hud-val--neon' : ''}`}>{batchChecking ? 'checking…' : uploadsReady ? 'ready' : 'none'}</span>
            </div>
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
          <SwarmConnect />
        </header>

        <div className="cms-content">
          {!uploadsReady && !batchChecking && (
            <Banner>No usable postage stamp on your Bee node (<code>{BEE_URL}</code>). Connect a local node and buy a stamp via the Swarm connect button, or set <code>VITE_POSTAGE_BATCH_ID</code>. Saving a profile or listing needs a stamp.</Banner>
          )}
          {sectionEl}
        </div>
      </div>
    </div>
  );
}
