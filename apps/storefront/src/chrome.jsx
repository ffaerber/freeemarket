/**
 * Shared storefront chrome — utility bar, nav (with real wallet), footer, and
 * the freee·market wordmark. Styling comes entirely from the design system
 * (src/design/identity.css); these components just provide the markup + the
 * live wallet wiring. Used by both the Portal (landing) and the shop view.
 */
import React from 'react';
import { SwarmConnectButton } from '@ffaerber/swarm-connect';
import { ADMIN_URL, MARKETPLACE_ADDRESS, BEE_URL } from './config.js';

/** The freee·market wordmark — the "eee" in brand blue. */
export function Wordmark({ size }) {
  return (
    <a href="/" className="fm-logo" style={size ? { fontSize: size } : undefined}>
      <span className="mk">fr</span><span className="eee">eee</span><span className="mk">market</span>
    </a>
  );
}

const SearchIcon = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}>
    <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
  </svg>
);

/**
 * Swarm connect wizard (wallet + Bee node + postage stamp) from
 * @ffaerber/swarm-connect, pinned to this app's Bee node. Used in the nav; the
 * buyer needs a Bee node + stamp to send the encrypted shipping address over PSS.
 */
export function WalletButton() {
  return <SwarmConnectButton beeApiUrl={BEE_URL} />;
}

/** Thin machine utility bar above the nav. */
export function UtilityBar({ right }) {
  return (
    <div className="fm-utilbar">
      <div className="fm-rail fm-rail--wide">
        <div className="fm-util-group">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="fm-dot fm-dot--pulse" /> gnosis chain · escrow live
          </span>
          <span style={{ color: 'var(--border-strong)' }}>·</span>
          <span>0 % platform fee</span>
        </div>
        <div className="fm-util-group">{right || <><span>swarm + ens</span><span style={{ color: 'var(--border-strong)' }}>·</span><span>usdc</span></>}</div>
      </div>
    </div>
  );
}

/** Sticky top nav. `links` = [{label, href, active}]. `search` toggles the search box. */
export function Nav({ links = [], search = true, searchPlaceholder = 'Search shops & goods' }) {
  return (
    <nav className="fm-nav">
      <div className="fm-rail fm-rail--wide">
        <Wordmark />
        <div className="fm-nav-links">
          {links.map((l) => (
            <a key={l.label} href={l.href} className={`fm-nav-link${l.active ? ' is-active' : ''}`}>{l.label}</a>
          ))}
        </div>
        <div className="fm-nav-spacer" />
        <div className="fm-nav-actions">
          {search && (
            <label className="fm-search">
              <SearchIcon />
              <input type="text" placeholder={searchPlaceholder} />
            </label>
          )}
          <WalletButton />
        </div>
      </div>
    </nav>
  );
}

/** Full marketing footer (landing). */
export function Footer() {
  const contract = MARKETPLACE_ADDRESS ? `${MARKETPLACE_ADDRESS.slice(0, 6)}…${MARKETPLACE_ADDRESS.slice(-4)}` : '—';
  return (
    <footer className="fm-footer">
      <div className="fm-rail fm-rail--wide">
        <div className="fm-footer-cols">
          <div>
            <Wordmark size={22} />
            <p className="fm-body" style={{ marginTop: 16, maxWidth: '34ch', fontSize: 14 }}>
              A decentralized, multi-vendor marketplace. Pure escrow + listings on Gnosis. No platform fee, ever.
            </p>
            <div style={{ marginTop: 20 }}>
              <span className="fm-pill fm-pill--trust"><span className="fm-dot fm-dot--pulse" /> network: gnosis · 100</span>
            </div>
          </div>
          <div>
            <h4 className="fm-foot-h">Market</h4>
            <a href="/" className="fm-foot-link">Browse shops</a>
            <a href="/#listings" className="fm-foot-link">Featured goods</a>
            <a href="/#how" className="fm-foot-link">How escrow works</a>
          </div>
          <div>
            <h4 className="fm-foot-h">Sell</h4>
            <a href={ADMIN_URL} className="fm-foot-link" target="_blank" rel="noreferrer">Open a shop</a>
            <a href={ADMIN_URL} className="fm-foot-link" target="_blank" rel="noreferrer">Merchant console</a>
          </div>
          <div>
            <h4 className="fm-foot-h">Protocol</h4>
            <a href="#" className="fm-foot-link">Marketplace.sol</a>
            <a href="#" className="fm-foot-link">Swarm + ENS</a>
            <a href="#" className="fm-foot-link">Encrypted shipping</a>
          </div>
        </div>
        <div className="fm-foot-bottom">
          <span>© 2026 freeemarket — fee-free &amp; permissionless</span>
          <span>contract: {contract} · unaudited</span>
        </div>
      </div>
    </footer>
  );
}

/** Compact footer (shop view). */
export function MiniFooter({ shopName }) {
  const contract = MARKETPLACE_ADDRESS ? `${MARKETPLACE_ADDRESS.slice(0, 6)}…${MARKETPLACE_ADDRESS.slice(-4)}` : '—';
  return (
    <footer className="fm-footer" style={{ paddingBlock: '40px' }}>
      <div className="fm-rail fm-rail--wide">
        <div className="fm-foot-bottom" style={{ border: 'none', margin: 0, padding: 0 }}>
          <span><a href="/">freeemarket</a>{shopName ? ` · ${shopName}` : ''}</span>
          <span>contract: {contract} · gnosis · 100</span>
        </div>
      </div>
    </footer>
  );
}
