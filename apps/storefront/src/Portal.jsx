/**
 * Portal — the root page of freeemarket.eth (the `/` route).
 *
 * Marketing landing (what FreeeMarket is + how escrow works) plus the live,
 * on-chain shop directory (useShops). Styled with the shared design system
 * (src/design/identity.css + pages.css). Rendered by Storefront.jsx for root.
 */
import React from 'react';
import { useShops } from './hooks/useShops.js';
import { UtilityBar, Nav, Footer } from './chrome.jsx';
import { ADMIN_URL, STOREFRONT_HOST } from './config.js';

/** Deterministic emoji per shop handle, so directory tiles have visual rhythm. */
const GLYPHS = ['🛍️', '🍓', '🔧', '🜂', '🥭', '🫙', '⚙️', '🍋', '🧵', '📦'];
function glyphFor(handle) {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return GLYPHS[h % GLYPHS.length];
}

const NAV_LINKS = [
  { label: 'Browse shops', href: '#shops', active: true },
  { label: 'Open a shop', href: ADMIN_URL },
  { label: 'How escrow works', href: '#how' },
];

const FEATURES = [
  { n: '01 / escrow', title: 'Trustless payment.', body: 'Buyers pay USDC into escrow on Gnosis. Funds release to the seller only on delivery confirmation — or after timeout — with a dispute path either way.' },
  { n: '02 / sovereign', title: 'Decentralized.', body: 'Shops are hosted on Swarm and resolved through ENS. No server to seize, no account to ban. Your shop lives at /your-handle.' },
  { n: '03 / open', title: 'Permissionless.', body: 'Anyone opens a shop, lists physical goods, and gets paid in stablecoins. The fruit seller and the car-parts seller share one backend and nothing else.' },
];

const STEPS = [
  { n: '01 // PAY', title: 'Funded', body: 'Buyer approves USDC and calls buy(). The amount is escrowed; the encrypted shipping address travels off-chain.' },
  { n: '02 // SHIP', title: 'In transit', body: 'Seller decrypts the address, ships, and sends a tracking code back over the same encrypted channel.' },
  { n: '03 // CONFIRM', title: 'Completed', body: 'Buyer calls confirmReceipt(). 100 % of escrow releases to the seller — or auto-releases after 14 days.' },
  { n: '04 // BRANCH', title: 'Disputed', body: 'Either party can open a dispute. The arbiter refunds the buyer or pays the seller — never themselves.', amber: true },
];

function ShieldIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function ShopDirectory() {
  const { shops, isLoading } = useShops();
  return (
    <section id="shops" className="fm-section" style={{ paddingTop: 0 }}>
      <div className="fm-rail fm-rail--wide">
        <div className="section-head">
          <div>
            <div className="fm-kicker" style={{ marginBottom: 16 }}>// registered on-chain</div>
            <h2 className="fm-h2">Shops</h2>
          </div>
          {shops.length > 0 && <span className="fm-pill fm-pill--trust"><span className="fm-dot" /> {shops.length} live</span>}
        </div>

        {isLoading ? (
          <p className="fm-body">Loading shops…</p>
        ) : shops.length === 0 ? (
          <div className="fm-card" style={{ padding: 40, textAlign: 'center' }}>
            <p className="fm-body" style={{ marginBottom: 18 }}>No shops registered yet.</p>
            <a href={ADMIN_URL} className="fm-btn fm-btn--primary" target="_blank" rel="noreferrer">&gt; Be the first to open one</a>
          </div>
        ) : (
          <div className="shop-grid">
            {shops.map((s) => (
              <a key={s.handle} href={`/${s.handle}`} className="fm-card fm-shop">
                <div className="fm-media" style={{ aspectRatio: '16/9' }}><span className="fm-media-glyph">{glyphFor(s.handle)}</span></div>
                <div className="fm-shop-meta">
                  <div>
                    <div className="fm-shop-name">{s.name}</div>
                    <div className="fm-shop-handle">{STOREFRONT_HOST}/{s.handle}</div>
                  </div>
                  <span className="fm-shop-count">on-chain</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default function Portal() {
  return (
    <>
      <UtilityBar />
      {/* No Swarm connect on the homepage — it's only needed inside a shop (buy + PSS). */}
      <Nav links={NAV_LINKS} wallet={false} />

      <main>
        {/* HERO */}
        <section className="hero">
          <div className="fm-rail fm-rail--wide hero-grid">
            <div>
              <div className="fm-kicker fm-rise" style={{ marginBottom: 22 }}>// an open eBay · permissionless commerce</div>
              <h1 className="fm-display fm-rise" style={{ animationDelay: '.05s' }}>Own the market.<br />No <em>middleman</em>.</h1>
              <p className="fm-lead fm-rise" style={{ animationDelay: '.12s', marginTop: 24, maxWidth: '48ch' }}>
                Anyone runs their own shop, sells real goods, and gets paid in stablecoins through
                on-chain escrow. Funds release only on delivery. No platform takes a cut.
              </p>
              <div className="hero-cta fm-rise" style={{ animationDelay: '.18s' }}>
                <a href={ADMIN_URL} className="fm-btn fm-btn--primary fm-btn--lg" target="_blank" rel="noreferrer">&gt; Open your shop</a>
                <a href="#shops" className="fm-btn fm-btn--ghost fm-btn--lg">Browse shops</a>
              </div>
              <div className="hero-proof fm-rise" style={{ animationDelay: '.24s' }}>
                <span className="fm-pill fm-pill--trust"><span className="fm-dot" /> USDC escrow on Gnosis</span>
                <span className="fm-pill">Swarm + ENS hosted</span>
                <span className="fm-pill fm-pill--price">100 % buyer → seller</span>
              </div>
            </div>

            <div className="hero-visual fm-rise" style={{ animationDelay: '.1s' }}>
              <div className="hero-figure">🜲</div>
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span className="fm-kicker">// order_0x91c</span>
                <span className="fm-pill fm-pill--trust" style={{ background: '#fff' }}><span className="fm-dot fm-dot--pulse" /> funded</span>
              </div>
              <div className="fm-hud" style={{ position: 'relative', zIndex: 1, background: '#fff' }}>
                <div className="fm-hud-row"><span className="fm-hud-key">escrow</span><span className="fm-hud-val">held · 24.00 USDC</span></div>
                <div className="fm-hud-row"><span className="fm-hud-key">release on</span><span className="fm-hud-val">delivery confirm</span></div>
                <div className="fm-hud-row"><span className="fm-hud-key">platform fee</span><span className="fm-hud-val fm-hud-val--neon">0.00</span></div>
                <div className="fm-hud-row"><span className="fm-hud-key">dispute path</span><span className="fm-hud-val fm-hud-val--amber">open · 14d</span></div>
              </div>
            </div>
          </div>
        </section>

        {/* VALUE PROPS */}
        <section className="fm-section--tight">
          <div className="fm-rail fm-rail--wide values">
            {FEATURES.map((f) => (
              <div key={f.n} className="fm-feature">
                <div className="fm-feature-ic"><ShieldIcon /></div>
                <div className="fm-kicker" style={{ marginBottom: 14 }}>{f.n}</div>
                <h3 className="fm-feature-title">{f.title}</h3>
                <p className="fm-feature-body">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CAMPAIGN MOSAIC */}
        <section className="fm-section--tight">
          <div className="fm-rail fm-rail--wide">
            <div className="mosaic">
              <a href="#shops" className="fm-tile">
                <div className="fm-tile-inner">
                  <span className="fm-kicker fm-kicker--neon">// featured market</span>
                  <h3 className="fm-tile-title">Browse every shop, one chain.</h3>
                  <p className="fm-tile-body">From a 3 a.m. fruit stand to industrial car parts — every shop registered on-chain, in one directory.</p>
                  <span className="fm-tile-cta">Enter the market →</span>
                </div>
              </a>
              <a href={ADMIN_URL} className="fm-tile" target="_blank" rel="noreferrer">
                <div className="fm-tile-inner">
                  <span className="fm-kicker fm-kicker--amber">// 5 min setup</span>
                  <h3 className="fm-tile-title">Open a shop.</h3>
                  <p className="fm-tile-body">Connect a wallet, claim a handle, list goods.</p>
                  <span className="fm-tile-cta">Start selling →</span>
                </div>
              </a>
              <a href="#how" className="fm-tile">
                <div className="fm-tile-inner">
                  <span className="fm-kicker">// the mechanic</span>
                  <h3 className="fm-tile-title">How escrow works.</h3>
                  <p className="fm-tile-body">Funded → completed, with a dispute branch.</p>
                  <span className="fm-tile-cta">See the flow →</span>
                </div>
              </a>
            </div>
          </div>
        </section>

        {/* HOW ESCROW WORKS */}
        <section id="how" className="fm-section">
          <div className="fm-rail fm-rail--wide">
            <div className="section-head">
              <div>
                <div className="fm-kicker" style={{ marginBottom: 16 }}>// order lifecycle</div>
                <h2 className="fm-h2" style={{ maxWidth: '18ch' }}>From cart to delivered, the contract holds the line.</h2>
              </div>
              <span className="fm-pill fm-pill--trust"><span className="fm-dot" /> Marketplace.sol · unaudited</span>
            </div>
            <div className="fm-steps steps-wrap">
              {STEPS.map((s) => (
                <div key={s.n} className="fm-step">
                  <div className="fm-step-num">{s.n}</div>
                  <div className="fm-step-title" style={s.amber ? { color: 'var(--amber-500)' } : undefined}>{s.title}</div>
                  <p className="fm-step-body">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SHOP DIRECTORY (live) */}
        <ShopDirectory />

        {/* MERCHANT BAND */}
        <section className="fm-section" style={{ paddingTop: 0 }}>
          <div className="fm-rail fm-rail--wide">
            <div className="merchant-band">
              <div style={{ position: 'relative', zIndex: 1, maxWidth: 680, marginInline: 'auto' }}>
                <div className="fm-kicker fm-kicker--amber" style={{ justifyContent: 'center', marginBottom: 22 }}>// your wallet is your storefront</div>
                <h2 className="fm-h2" style={{ fontSize: 'clamp(30px,4.4vw,56px)' }}>Start selling in the time it takes to make a coffee.</h2>
                <p className="fm-lead" style={{ margin: '22px auto 0', maxWidth: '46ch' }}>
                  Claim a handle, list your first good, and you're live at {STOREFRONT_HOST}/you. No fees, no approval, no landlord.
                </p>
                <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap', marginTop: 34 }}>
                  <a href={ADMIN_URL} className="fm-btn fm-btn--primary fm-btn--lg" target="_blank" rel="noreferrer">&gt; Open your shop</a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}
