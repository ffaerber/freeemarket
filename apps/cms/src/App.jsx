/**
 * FreeeMarket CMS / admin — shell.
 *
 * One SHARED app for all shops: the merchant connects their wallet and that
 * address IS their seller address (no per-shop build, unlike the storefront).
 *
 * Layout: a neutral dark admin theme (config.ADMIN_THEME) set as CSS variables
 * on the root, a top bar with wallet connect + connected address, three tabs
 * (Shop / Listings / Orders), and banners when the app is unconfigured (no
 * VITE_MARKETPLACE_ADDRESS) or can't upload (no postage batch).
 *
 * The contract writes are REAL (registerShop / createListing / updateListing /
 * claim / dispute / resolve). The PSS decrypt of shipping addresses and the
 * seller→buyer tracking-code send are WIRED to @freemarket/messaging (src/
 * messaging), going live once the merchant unlocks their ECIES key and a full
 * Bee node + ContactRegistry are configured; otherwise they fall back to a
 * graceful stub — CLAUDE.md §5. Run this CMS LOCALLY so the decryption key +
 * plaintext addresses stay on the merchant's machine.
 */
import React, { useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Store, Package, Inbox, Wallet, Power } from 'lucide-react';
import { Styles, Button, GhostButton, Banner, Pill } from './ui.jsx';
import ShopSection from './sections/ShopSection.jsx';
import ListingsSection from './sections/ListingsSection.jsx';
import OrdersSection from './sections/OrdersSection.jsx';
import Onboarding from './sections/Onboarding.jsx';
import { useShopProfile } from './hooks/useShopProfile.js';
import { useMyHandle } from './hooks/useMyHandle.js';
import {
  ADMIN_THEME,
  UNCONFIGURED,
  UPLOADS_DISABLED,
  MARKETPLACE_ADDRESS,
  BEE_URL,
  GNOSIS_CHAIN_ID,
} from './config.js';

const TABS = [
  { id: 'shop', label: 'Shop', icon: Store, Comp: ShopSection },
  { id: 'listings', label: 'Listings', icon: Package, Comp: ListingsSection },
  { id: 'orders', label: 'Orders', icon: Inbox, Comp: OrdersSection },
];

function themeVars(t) {
  return {
    '--bg': t.bg, '--surface': t.surface, '--text': t.text, '--muted': t.muted,
    '--accent': t.accent, '--accent2': t.accent2, '--border': t.border,
    '--radius': t.radius, '--display': t.display, '--body': t.body,
  };
}

function WalletControls() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Pill tone="accent2">{address.slice(0, 6)}…{address.slice(-4)}</Pill>
        <GhostButton onClick={() => disconnect()} style={{ padding: '8px 12px', fontSize: 13 }}>
          <Power size={14} /> Disconnect
        </GhostButton>
      </div>
    );
  }

  const injected = connectors[0];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Button
        onClick={() => injected && connect({ connector: injected, chainId: GNOSIS_CHAIN_ID })}
        disabled={isPending || !injected}
      >
        <Wallet size={15} /> {isPending ? 'Connecting…' : 'Connect wallet'}
      </Button>
      {error && <span style={{ color: '#ff6b6b', fontSize: 12 }}>{error.shortMessage || error.message}</span>}
    </div>
  );
}

export default function App() {
  const { isConnected } = useAccount();
  const [tab, setTab] = useState('shop');
  const Active = TABS.find((t) => t.id === tab)?.Comp;

  // Onboarding gate: a connected, configured wallet with no shop OR no handle yet
  // gets the first-run wizard instead of the tabs. Wait for both reads to settle
  // so existing merchants don't see a flash of onboarding.
  const { registered, isLoading: shopLoading } = useShopProfile();
  const { handle, isLoading: handleLoading } = useMyHandle();
  const ready = isConnected && !UNCONFIGURED;
  const gateLoading = ready && (shopLoading || handleLoading);
  const needsOnboarding = ready && !gateLoading && (!registered || !handle);
  const showTabs = ready && !gateLoading && !needsOnboarding;

  return (
    <div className="fm" style={{ ...themeVars(ADMIN_THEME), background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh', fontFamily: 'var(--body)' }}>
      <Styles />

      {/* Top bar */}
      <header style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '16px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Store size={20} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 700, fontSize: 17 }}>FreeeMarket</span>
            <span style={{ color: 'var(--muted)', fontSize: 13 }}>merchant admin</span>
          </div>
          <WalletControls />
        </div>
        {/* Tabs — hidden during first-run onboarding */}
        {showTabs && (
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 22px', display: 'flex', gap: 4 }}>
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = id === tab;
            return (
              <button
                key={id}
                className="fm-tab fm-btn"
                onClick={() => setTab(id)}
                style={{
                  background: 'transparent', border: 'none',
                  borderBottom: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  color: active ? 'var(--text)' : 'var(--muted)',
                  fontFamily: 'var(--body)', fontWeight: 600, fontSize: 14,
                  padding: '12px 14px', display: 'inline-flex', alignItems: 'center', gap: 7,
                }}
              >
                <Icon size={15} /> {label}
              </button>
            );
          })}
        </div>
        )}
      </header>

      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '26px 22px 80px' }}>
        {UNCONFIGURED && (
          <Banner tone="error">
            <strong>Unconfigured.</strong> No <code>VITE_MARKETPLACE_ADDRESS</code> set — on-chain reads/writes are
            disabled. Copy <code>.env.example</code> to <code>.env</code> and set the Marketplace contract address
            (Gnosis Chain). This is the admin shell preview.
          </Banner>
        )}
        {!UNCONFIGURED && UPLOADS_DISABLED && (
          <Banner>
            <strong>Uploads disabled.</strong> No Swarm postage batch (<code>VITE_POSTAGE_BATCH_ID</code>). Saving a
            shop profile or listing requires uploading JSON/images to a writeable Bee node (<code>{BEE_URL}</code>,
            NOT a gateway) stamped with a postage batch. See CLAUDE.md §5.
          </Banner>
        )}
        {!UNCONFIGURED && !isConnected && (
          <Banner tone="info">
            Connect your wallet to manage your shop. The connected address (on Gnosis Chain) is your seller identity.
          </Banner>
        )}

        {/* First-run wizard → onboarding; otherwise the active tab. Sections
            render read-only/empty states gracefully until a wallet connects. */}
        {gateLoading ? (
          <div style={{ color: 'var(--muted)', fontSize: 14, padding: '8px 0' }}>Checking your shop…</div>
        ) : needsOnboarding ? (
          <Onboarding onDone={() => setTab('listings')} />
        ) : (
          Active && <Active />
        )}

        <footer style={{ marginTop: 48, paddingTop: 18, borderTop: '1px solid var(--border)', color: 'var(--muted)', fontSize: 12, lineHeight: 1.6 }}>
          Marketplace: <code>{MARKETPLACE_ADDRESS || '— unset —'}</code> · Bee: <code>{BEE_URL}</code>
          <br />
          Run this CMS LOCALLY: shipping-address decryption (PSS) uses your private key — it should never leave your machine. PSS messaging is wired to <code>@freemarket/messaging</code> and goes live once you unlock your key and point at a full Bee node + ContactRegistry (CLAUDE.md §5).
        </footer>
      </main>
    </div>
  );
}
