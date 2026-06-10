/**
 * Portal — the root page of freeemarket.eth (the `/` route).
 *
 * Explains what FreeMarket is, links merchants to the CMS to create a shop, and
 * lists every registered shop by handle (→ /<handle>). The shop directory comes
 * from useShops (HandleRegistry events, verified on-chain). Rendered by
 * Storefront.jsx when useActiveSeller returns status 'landing' (no path handle).
 */
import React from 'react';
import { Store, ArrowRight, ShoppingBag, ShieldCheck, Globe } from 'lucide-react';
import { useShops } from './hooks/useShops.js';
import { STOREFRONT_THEME, ADMIN_URL, STOREFRONT_HOST } from './config.js';

const t = STOREFRONT_THEME;
const vars = {
  '--bg': t.bg, '--surface': t.surface, '--text': t.text, '--muted': t.muted,
  '--accent': t.accent, '--accent2': t.accent2, '--border': t.border,
  '--radius': t.radius, '--display': t.display, '--body': t.body,
};

const FEATURES = [
  { Icon: ShieldCheck, title: 'Escrow on Gnosis', body: 'Buyers pay USDC/xDAI into escrow; funds release to the seller only on delivery confirmation (or timeout), with a dispute path.' },
  { Icon: Globe, title: 'Decentralized', body: 'Shops are hosted on Swarm and resolved through ENS. No platform takes a cut — every order settles 100% buyer → seller.' },
  { Icon: ShoppingBag, title: 'Permissionless', body: 'Anyone can open a shop, list physical goods, and get paid in stablecoins. Your wallet is your storefront.' },
];

export default function Portal() {
  const { shops, isLoading } = useShops();

  return (
    <div className="fm" style={{ ...vars, background: t.bg, color: t.text, minHeight: '100%', fontFamily: 'var(--body)' }}>
      {/* hero */}
      <header style={{ background: `radial-gradient(120% 120% at 80% 0%, color-mix(in srgb, var(--accent) 14%, var(--bg)) 0%, var(--bg) 55%)`, borderBottom: '1px solid var(--border)', padding: '64px 22px 56px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
            <Store size={22} style={{ color: 'var(--accent)' }} />
            <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 20, letterSpacing: '-0.01em' }}>FreeMarket</span>
          </div>
          <h1 style={{ fontFamily: 'var(--display)', fontSize: 'clamp(32px, 5vw, 52px)', lineHeight: 1.05, margin: '0 0 16px', maxWidth: '18ch', letterSpacing: '-0.02em' }}>
            A decentralized, multi-vendor marketplace.
          </h1>
          <p style={{ fontSize: 18, color: 'var(--muted)', maxWidth: '60ch', margin: '0 0 28px', lineHeight: 1.5 }}>
            An open eBay — anyone runs their own shop, sells physical goods, and gets paid in
            stablecoins through on-chain escrow. Shops live at <code>{STOREFRONT_HOST}/your-shop</code>.
          </p>
          <a
            href={ADMIN_URL}
            target="_blank"
            rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 15, padding: '13px 20px', borderRadius: 'var(--radius)', textDecoration: 'none' }}
          >
            Create your shop <ArrowRight size={16} />
          </a>
        </div>
      </header>

      {/* features */}
      <section style={{ maxWidth: 1040, margin: '0 auto', padding: '44px 22px 8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {FEATURES.map(({ Icon, title, body }) => (
            <div key={title} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20 }}>
              <Icon size={20} style={{ color: 'var(--accent2)', marginBottom: 10 }} />
              <div style={{ fontWeight: 700, marginBottom: 6, fontFamily: 'var(--display)' }}>{title}</div>
              <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>{body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* shop directory */}
      <section style={{ maxWidth: 1040, margin: '0 auto', padding: '36px 22px 80px' }}>
        <h2 style={{ fontFamily: 'var(--display)', fontSize: 24, margin: '0 0 4px' }}>Shops</h2>
        <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 20px' }}>
          Every shop registered on-chain. Click through to browse and buy.
        </p>

        {isLoading ? (
          <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading shops…</div>
        ) : shops.length === 0 ? (
          <div style={{ background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: 'var(--radius)', padding: 28, textAlign: 'center', color: 'var(--muted)' }}>
            No shops yet. <a href={ADMIN_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Be the first to open one.</a>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            {shops.map((s) => (
              <a
                key={s.handle}
                href={`/${s.handle}`}
                style={{ display: 'block', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 18, textDecoration: 'none', color: 'var(--text)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Store size={16} style={{ color: 'var(--accent)' }} />
                  <span style={{ fontWeight: 700, fontFamily: 'var(--display)' }}>{s.name}</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)', fontFamily: 'ui-monospace, monospace' }}>
                  {STOREFRONT_HOST}/{s.handle}
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
