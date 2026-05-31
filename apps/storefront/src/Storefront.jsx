/**
 * FreeMarket — white-label storefront engine (REAL, data-driven).
 *
 * Ported from the demo template: same theme engine, hero, product grid, and
 * product modal — but the shop profile + listings now come from the chain and
 * Swarm instead of a static config object.
 *
 *   - Shop theme/copy: useShop()  → shops(seller).metadata → Swarm ShopProfile
 *   - Listings:        useListings() → ListingCreated logs → listings(id) +
 *                      Swarm ListingMetadata + ERC-20 decimals/symbol
 *   - Checkout:        real approve + buy escrow on Gnosis, then the PSS
 *                      messaging boundary (stubbed; CLAUDE.md §5)
 *
 * DEMO MODE (config.DEMO_MODE): when no contract/seller env is set, we render a
 * ported sample shop so the build/preview shows something. The real on-chain
 * path is the default the moment env is configured.
 */
import React, { useState } from 'react';
import { Store, ShoppingBag } from 'lucide-react';
import { Styles, Pill } from './ui.jsx';
import Checkout from './checkout/Checkout.jsx';
import { useShop } from './hooks/useShop.js';
import { useListings } from './hooks/useListings.js';
import { swarmImageUrl } from './lib/swarm.js';
import { DEMO_MODE, DEMO_SHOP, BEE_URL } from './config.js';

/** Pick a graceful emoji glyph fallback when a listing has no Swarm image. */
function glyphFor(listing) {
  if (listing.glyph) return listing.glyph;
  const t = (listing.title || '').toLowerCase();
  if (/straw|berry|berries/.test(t)) return '🍓';
  if (/banana/.test(t)) return '🍌';
  if (/mango/.test(t)) return '🥭';
  return '🛍️';
}

/** Product image (Swarm) with emoji fallback, sized via aspect ratio. */
function ProductMedia({ listing, aspect, fontSize }) {
  const ref = listing.images?.[0];
  const url = ref ? swarmImageUrl(BEE_URL, ref) : null;
  const [errored, setErrored] = useState(false);
  const showImg = url && !errored;
  return (
    <div
      style={{
        aspectRatio: aspect,
        display: 'grid',
        placeItems: 'center',
        fontSize,
        background: 'color-mix(in srgb, var(--accent) 8%, var(--surface))',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {showImg ? (
        <img
          src={url}
          alt={listing.title}
          onError={() => setErrored(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        glyphFor(listing)
      )}
    </div>
  );
}

/**
 * Inventory hint derived from the ON-CHAIN `stock` count (never a metadata
 * field — that would drift; mirrors how price is on-chain). Shows "Sold out"
 * when stock is 0, a low-stock nudge when scarce, else "N in stock".
 */
function StockBadge({ item }) {
  // stock may be a bigint (real path) or absent; coerce to a count.
  const count =
    item.stockCount != null
      ? item.stockCount
      : item.stock != null
        ? Number(item.stock)
        : null;
  if (count == null) return null;
  const soldOut = count <= 0;
  const low = !soldOut && count <= 5;
  return (
    <div
      style={{
        marginTop: 8,
        fontSize: 12,
        fontWeight: 700,
        color: soldOut ? 'var(--muted)' : low ? 'var(--accent2)' : 'var(--muted)',
      }}
    >
      {soldOut ? 'Sold out' : low ? `Only ${count} left` : `${count} in stock`}
    </div>
  );
}

function ProductBuy({ shop, item }) {
  const [checkout, setCheckout] = useState(false);
  const count = item.stockCount != null ? item.stockCount : item.stock != null ? Number(item.stock) : null;
  const soldOut = count != null && count <= 0;
  if (soldOut) {
    return (
      <button
        disabled
        style={{ width: '100%', marginTop: 18, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontFamily: 'var(--body)', fontWeight: 700, fontSize: 15, padding: '15px', borderRadius: 14, cursor: 'not-allowed' }}
      >
        Sold out
      </button>
    );
  }
  return (
    <>
      <button
        className="fm-btn"
        onClick={() => setCheckout(true)}
        style={{ width: '100%', marginTop: 18, border: 'none', background: 'var(--accent)', color: '#fff', fontFamily: 'var(--body)', fontWeight: 700, fontSize: 15, padding: '15px', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        <ShoppingBag size={17} /> Buy with {item.symbol}
      </button>
      {checkout && <Checkout shop={shop} item={item} onClose={() => setCheckout(false)} />}
    </>
  );
}

/**
 * The pure presentational engine. Receives a normalized `shop` (theme/copy +
 * `seller`) and a `listings` array; identical shape in demo and real paths.
 */
function StorefrontView({ shop, listings, isLoading, error, hero, demo }) {
  const t = shop.theme;
  const [item, setItem] = useState(null);
  const vars = {
    '--bg': t.bg, '--surface': t.surface, '--text': t.text, '--muted': t.muted,
    '--accent': t.accent, '--accent2': t.accent2, '--border': t.border,
    '--radius': t.radius, '--display': t.display, '--body': t.body,
  };
  const heroBg = hero || `radial-gradient(120% 120% at 80% 0%, color-mix(in srgb, var(--accent) 18%, var(--bg)) 0%, var(--bg) 55%)`;

  return (
    <div className="fm" style={{ ...vars, background: t.bg, color: t.text, minHeight: '100%', fontFamily: 'var(--body)' }}>
      {/* hero */}
      <header style={{ background: heroBg, borderBottom: '1px solid var(--border)', padding: '54px 22px 46px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div className="fm-rise" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
            <Store size={18} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 700, letterSpacing: '.02em' }}>{shop.ens}</span>
            {demo && (
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: 'var(--accent2)', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 8px' }}>DEMO MODE</span>
            )}
          </div>
          <h1 className="fm-rise" style={{ fontFamily: 'var(--display)', fontSize: 'clamp(40px, 9vw, 76px)', lineHeight: 0.95, margin: 0, fontWeight: 900, maxWidth: '14ch', animationDelay: '.05s' }}>{shop.name}</h1>
          <p className="fm-rise" style={{ fontSize: 'clamp(16px,2.4vw,20px)', color: 'var(--muted)', marginTop: 16, maxWidth: '46ch', animationDelay: '.12s' }}>{shop.tagline}</p>
          <div className="fm-rise" style={{ marginTop: 20, animationDelay: '.18s' }}>
            <Pill>Pays in stablecoins · escrow on Gnosis</Pill>
          </div>
        </div>
      </header>

      {/* grid */}
      <main style={{ maxWidth: 1040, margin: '0 auto', padding: '40px 22px 80px' }}>
        {shop.blurb && (
          <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 24, maxWidth: '60ch' }}>{shop.blurb}</p>
        )}

        {error && (
          <div style={{ color: '#ff6b6b', fontSize: 14, marginBottom: 20 }}>
            Couldn't load listings: {error.shortMessage || error.message || String(error)}
          </div>
        )}
        {isLoading && (
          <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading listings from Gnosis + Swarm…</div>
        )}
        {!isLoading && !error && listings.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 14 }}>
            No active listings for this shop yet.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 18 }}>
          {listings.map((l, i) => (
            <div
              key={l.id.toString()}
              className="fm-card fm-rise"
              onClick={() => setItem(l)}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', animationDelay: `${0.05 * i}s` }}
            >
              <ProductMedia listing={l} aspect="1/1" fontSize={64} />
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontFamily: 'var(--display)', fontSize: 21, lineHeight: 1 }}>{l.title}</span>
                  <span style={{ fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{l.priceFormatted} {l.symbol}</span>
                </div>
                {l.variant && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>{l.variant}</div>}
                <StockBadge item={l} />
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* product modal */}
      {item && (
        <div className="fm-overlay" onClick={() => setItem(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40, padding: 18, backdropFilter: 'blur(2px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', color: 'var(--text)', borderRadius: 20, maxWidth: 420, width: '100%', border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ position: 'relative' }}>
              <ProductMedia listing={item} aspect="16/10" fontSize={96} />
              <span className="fm-x" onClick={() => setItem(null)} style={{ position: 'absolute', top: 14, right: 14, color: 'var(--text)', background: 'var(--surface)', borderRadius: 999, width: 28, height: 28, display: 'grid', placeItems: 'center' }}>✕</span>
            </div>
            <div style={{ padding: 22 }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: 30, lineHeight: 1 }}>{item.title}</div>
              <div style={{ color: 'var(--muted)', marginTop: 6 }}>
                {[item.variant, item.description].filter(Boolean).join(' · ')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
                <span style={{ fontFamily: 'var(--display)', fontSize: 30, color: 'var(--accent)' }}>{item.priceFormatted}</span>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>{item.symbol}</span>
              </div>
              <StockBadge item={item} />
              {demo ? (
                <div style={{ marginTop: 18, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 13 }}>
                  Checkout is disabled in DEMO MODE. Set VITE_MARKETPLACE_ADDRESS + VITE_SELLER to enable the real escrow flow.
                </div>
              ) : (
                <ProductBuy shop={shop} item={item} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** DEMO MODE wrapper: render the ported sample shop config, no chain reads. */
function DemoStorefront() {
  // Normalize the demo listing prices to the {priceFormatted, symbol} shape.
  const listings = DEMO_SHOP.listings.map((l) => ({
    ...l,
    id: BigInt(l.id),
    images: l.images || [],
  }));
  const shop = {
    seller: DEMO_SHOP.seller,
    ens: DEMO_SHOP.ens,
    name: DEMO_SHOP.name,
    tagline: DEMO_SHOP.tagline,
    blurb: DEMO_SHOP.blurb,
    theme: DEMO_SHOP.theme,
  };
  return <StorefrontView shop={shop} listings={listings} isLoading={false} error={null} hero={DEMO_SHOP.hero} demo />;
}

/** REAL path: read shop + listings from chain/Swarm. */
function RealStorefront() {
  const { shop } = useShop();
  const { listings, isLoading, error } = useListings();
  return <StorefrontView shop={shop} listings={listings} isLoading={isLoading} error={error} />;
}

export default function Storefront() {
  return (
    <div style={{ minHeight: '100vh' }}>
      <Styles />
      {DEMO_MODE ? <DemoStorefront /> : <RealStorefront />}
    </div>
  );
}
