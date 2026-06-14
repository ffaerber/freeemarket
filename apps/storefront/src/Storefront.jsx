/**
 * FreeeMarket — storefront shop view (REAL, data-driven), in the shared design.
 *
 *   - Shop profile/copy: useShop(seller)  → shops(seller).metadata → Swarm
 *   - Listings:          useListings(seller) → ListingCreated logs → listings(id)
 *                        + Swarm ListingMetadata + ERC-20 decimals/symbol
 *   - Checkout:          real approve + buy escrow on Gnosis, then PSS messaging
 *
 * MULTI-TENANT: the active shop is resolved at runtime from the URL path via
 * useActiveSeller (freeemarket.eth.limo/<handle> → HandleRegistry → seller). The
 * root path renders the Portal; an unknown handle renders "shop not found".
 * Styling comes from the design system (src/design/identity.css + pages.css).
 */
import React, { useMemo, useState } from 'react';
import { describeShippingPolicy } from '@freeemarket/schema';
import Checkout from './checkout/Checkout.jsx';
import { useShop } from './hooks/useShop.js';
import { useListings } from './hooks/useListings.js';
import { useActiveSeller } from './hooks/useActiveSeller.js';
import { useSellerRating } from './hooks/useSellerRating.js';
import { Stars } from './ui/Stars.jsx';
import Portal from './Portal.jsx';
import { UtilityBar, Nav, MiniFooter } from './chrome.jsx';
import { swarmImageUrl } from './lib/swarm.js';
import { BEE_URL, STOREFRONT_HOST } from './config.js';

/** Emoji glyph fallback when a listing has no Swarm image. */
function glyphFor(listing) {
  if (listing.glyph) return listing.glyph;
  const t = (listing.title || '').toLowerCase();
  if (/straw|berry|berries/.test(t)) return '🍓';
  if (/banana/.test(t)) return '🍌';
  if (/mango/.test(t)) return '🥭';
  if (/lemon|citrus/.test(t)) return '🍋';
  return '🛍️';
}

/** Coerce a listing's ON-CHAIN stock to a count, or null. */
function stockCount(item) {
  return item?.stockCount != null ? item.stockCount : item?.stock != null ? Number(item.stock) : null;
}

/** Product media — Swarm image with emoji fallback, in the design's .fm-media. */
function ProductMedia({ listing, glyphSize }) {
  const ref = listing.images?.[0];
  const url = ref ? swarmImageUrl(BEE_URL, ref) : null;
  const [errored, setErrored] = useState(false);
  if (url && !errored) {
    return (
      <div className="fm-media">
        <img src={url} alt={listing.title} onError={() => setErrored(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    );
  }
  return (
    <div className="fm-media">
      <span className="fm-media-glyph" style={glyphSize ? { fontSize: glyphSize } : undefined}>{glyphFor(listing)}</span>
    </div>
  );
}

/** Stock line in the design's .fm-stock styles. */
function stockLabel(item) {
  const c = stockCount(item);
  if (c == null) return { text: '', cls: '' };
  if (c <= 0) return { text: 'sold out', cls: 'fm-stock--out' };
  if (c <= 5) return { text: `only ${c} left`, cls: 'fm-stock--low' };
  return { text: `${c} in stock`, cls: '' };
}

/** Group price as { price, token } for the card row (range when variants differ). */
function groupPrice(group) {
  const lo = group.variants[0];
  const hi = group.variants[group.variants.length - 1];
  const price = lo.priceFormatted === hi.priceFormatted ? lo.priceFormatted : `${lo.priceFormatted}–${hi.priceFormatted}`;
  return { price, token: lo.symbol };
}

function groupSoldOut(group) {
  return group.variants.every((v) => {
    const c = stockCount(v);
    return c != null && c <= 0;
  });
}

/** Real approve+buy flow — opens the existing Checkout overlay. */
function ProductBuy({ shop, item }) {
  const [checkout, setCheckout] = useState(false);
  const count = stockCount(item);
  const soldOut = count != null && count <= 0;
  if (soldOut) {
    return <button className="fm-btn fm-btn--ghost fm-btn--block fm-btn--lg" disabled style={{ marginTop: 22 }}>Sold out</button>;
  }
  return (
    <>
      <button className="fm-btn fm-btn--primary fm-btn--block fm-btn--lg" style={{ marginTop: 22 }} onClick={() => setCheckout(true)}>
        Buy with {item.symbol}
      </button>
      {checkout && <Checkout shop={shop} item={item} onClose={() => setCheckout(false)} />}
    </>
  );
}

/** Variant chips (design .chip). Hidden for a group of one. */
function VariantChips({ group, selectedId, onSelect }) {
  if (group.variants.length <= 1) return null;
  return (
    <div style={{ marginTop: 20 }}>
      <div className="fm-label" style={{ marginBottom: 8 }}>Variant</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {group.variants.map((v) => {
          const c = stockCount(v);
          const sold = c != null && c <= 0;
          const active = v.id.toString() === selectedId?.toString();
          return (
            <button key={v.id.toString()} className={`chip${active ? ' is-active' : ''}`} style={sold ? { opacity: 0.55 } : undefined} onClick={() => onSelect(v)}>
              {v.variantLabel || v.variant || v.title}{sold ? ' · sold out' : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StorefrontView({ shop, handle, groups, isLoading, error }) {
  const [group, setGroup] = useState(null);
  const [selected, setSelected] = useState(null);
  const [cat, setCat] = useState('all');
  const rating = useSellerRating(shop.seller);

  function openGroup(g) {
    setGroup(g);
    const firstAvailable = g.variants.find((v) => {
      const c = stockCount(v);
      return c == null || c > 0;
    });
    setSelected(firstAvailable || g.variants[0]);
  }
  function closeGroup() { setGroup(null); setSelected(null); }

  const categories = useMemo(() => {
    const set = new Set();
    for (const g of groups) for (const v of g.variants) if (v.category) set.add(v.category);
    return [...set];
  }, [groups]);

  const shownGroups = cat === 'all' ? groups : groups.filter((g) => g.variants.some((v) => v.category === cat));
  const totalListings = groups.reduce((n, g) => n + g.variants.length, 0);
  const shopUrl = handle ? `${STOREFRONT_HOST}/${handle}` : shop.ens || '';
  const sellerShort = shop.seller ? `${shop.seller.slice(0, 6)}…${shop.seller.slice(-4)}` : '—';

  return (
    <>
      <UtilityBar right={<><span>{describeShippingPolicy(shop.shipping)}</span><span style={{ color: 'var(--border-strong)' }}>·</span><span>usdc</span></>} />
      <Nav
        links={[{ label: 'Shop', href: '#', active: true }, { label: 'About this shop', href: '#about' }, { label: 'Shipping', href: '#shipping' }]}
        searchPlaceholder="Search this shop"
      />

      {/* SHOP HERO */}
      <header className="shop-hero">
        <div className="fm-rail fm-rail--wide shop-hero-grid">
          <div>
            <div className="fm-kicker">// {shopUrl}</div>
            <h1 className="shop-name-xl">{shop.name}</h1>
            <p className="fm-lead" style={{ marginTop: 18, maxWidth: '42ch' }}>{shop.tagline}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
              <span className="fm-pill fm-pill--trust"><span className="fm-dot" /> escrow on gnosis</span>
              <span className="fm-pill">ships: {describeShippingPolicy(shop.shipping)}</span>
              <span className="fm-pill fm-pill--price">0 % fee</span>
            </div>
          </div>
          <div className="fm-hud" style={{ minWidth: 260 }}>
            <div className="fm-hud-row"><span className="fm-hud-key">seller</span><span className="fm-hud-val">{sellerShort}</span></div>
            {rating.hasRatings && (
              <div className="fm-hud-row">
                <span className="fm-hud-key">rating</span>
                <span className="fm-hud-val" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Stars value={rating.avgOverall} size={14} />
                  <span>{rating.avgOverall.toFixed(1)} · {rating.count}</span>
                </span>
              </div>
            )}
            {rating.hasSales && (
              <div className="fm-hud-row">
                <span className="fm-hud-key">sold</span>
                <span className="fm-hud-val">{rating.salesCount} {rating.salesCount === 1 ? 'order' : 'orders'}</span>
              </div>
            )}
            <div className="fm-hud-row"><span className="fm-hud-key">listings</span><span className="fm-hud-val fm-hud-val--neon">{totalListings} active</span></div>
            <div className="fm-hud-row"><span className="fm-hud-key">settlement</span><span className="fm-hud-val">100 % to seller</span></div>
            <div className="fm-hud-row"><span className="fm-hud-key">network</span><span className="fm-hud-val">gnosis · 100</span></div>
          </div>
        </div>
      </header>

      {/* FILTER + GRID */}
      <main className="fm-section" style={{ paddingTop: 8 }}>
        <div className="fm-rail fm-rail--wide">
          {shop.blurb && <p className="fm-body" style={{ marginBottom: 22, maxWidth: '60ch' }}>{shop.blurb}</p>}

          {categories.length > 0 && (
            <div className="filter-bar">
              <button className={`chip${cat === 'all' ? ' is-active' : ''}`} onClick={() => setCat('all')}>All goods</button>
              {categories.map((c) => (
                <button key={c} className={`chip${cat === c ? ' is-active' : ''}`} onClick={() => setCat(c)}>{c}</button>
              ))}
              <span className="chip-spacer" />
            </div>
          )}

          {error && <p className="fm-body" style={{ color: 'var(--amber-500)' }}>Couldn't load listings: {error.shortMessage || error.message || String(error)}</p>}
          {isLoading && <p className="fm-body">Loading listings from Gnosis + Swarm…</p>}
          {!isLoading && !error && shownGroups.length === 0 && <p className="fm-body">No active listings for this shop yet.</p>}

          <div className="store-grid">
            {shownGroups.map((g, i) => {
              const lead = g.variants[0];
              const sold = groupSoldOut(g);
              const { price, token } = groupPrice(g);
              const stk = sold ? { text: 'sold out', cls: 'fm-stock--out' } : g.variants.length > 1 ? { text: `${g.variants.length} variants`, cls: '' } : stockLabel(lead);
              return (
                <article key={g.key} className="fm-card fm-product fm-rise" style={{ animationDelay: `${0.03 * i}s` }} onClick={() => openGroup(g)}>
                  <ProductMedia listing={lead} />
                  <div className="fm-product-body">
                    <div className="fm-product-shop">{handle || shop.name}</div>
                    <div className="fm-product-title">{g.title}</div>
                    <div className="fm-product-row">
                      <span className="fm-product-price">{price}</span>
                      <span className="fm-product-token">{token}</span>
                    </div>
                    <div className={`fm-stock ${stk.cls}`}>{stk.text}</div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </main>

      {/* PRODUCT MODAL */}
      {group && selected && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeGroup(); }}>
          <div className="modal">
            <button className="fm-icon-btn modal-x" onClick={closeGroup}>✕</button>
            <ProductMedia listing={selected} glyphSize={120} />
            <div className="modal-body">
              <div className="fm-kicker">// {handle || shop.name}</div>
              <h2 className="fm-h3" style={{ margin: '14px 0 8px' }}>{group.title}</h2>
              <p className="fm-body" style={{ fontSize: 14 }}>{selected.description || selected.variantLabel || selected.variant}</p>

              <VariantChips group={group} selectedId={selected.id} onSelect={setSelected} />

              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 24 }}>
                <span className="fm-serif" style={{ fontSize: 40, fontWeight: 800, color: 'var(--neon-300)', letterSpacing: '-0.02em' }}>{selected.priceFormatted}</span>
                <span className="fm-mono fm-small">{selected.symbol}</span>
              </div>
              {selected.hasShipping && (
                <div className="fm-mono fm-small" style={{ marginTop: 6, color: 'var(--fg-soft)' }}>
                  item {selected.itemFormatted} + shipping {selected.shippingFormatted} {selected.symbol}
                </div>
              )}
              {(() => { const s = stockLabel(selected); return s.text ? <div className={`fm-stock ${s.cls}`} style={{ marginTop: 8 }}>{s.text}</div> : null; })()}

              <ProductBuy key={selected.id.toString()} shop={shop} item={selected} />
              <p className="fm-mono fm-small" style={{ marginTop: 12, color: 'var(--fg-soft)', textAlign: 'center' }}>funds release to seller only on delivery</p>
            </div>
          </div>
        </div>
      )}

      <MiniFooter shopName={shop.name} />
    </>
  );
}

/** REAL path: read shop + listings for a resolved seller from chain/Swarm. */
function RealStorefront({ seller, handle }) {
  const { shop } = useShop(seller);
  const { groups, isLoading, error } = useListings(seller);
  return <StorefrontView shop={shop} handle={handle} groups={groups} isLoading={isLoading} error={error} />;
}

/** Centered full-page message with chrome (resolving / not-found states). */
function CenterNote({ title, detail }) {
  return (
    <>
      <UtilityBar />
      <Nav links={[{ label: 'Browse shops', href: '/' }]} search={false} />
      <div style={{ minHeight: '50vh', display: 'grid', placeItems: 'center', textAlign: 'center', padding: 24 }}>
        <div>
          <h2 className="fm-h3" style={{ marginBottom: 8 }}>{title}</h2>
          {detail && <p className="fm-body" style={{ maxWidth: 440 }}>{detail}</p>}
          <div style={{ marginTop: 22 }}><a href="/" className="fm-btn fm-btn--ghost">← Back to market</a></div>
        </div>
      </div>
      <MiniFooter />
    </>
  );
}

export default function Storefront() {
  const { seller, handle, status } = useActiveSeller();

  if (status === 'landing') return <Portal />;
  if (status === 'resolving') return <CenterNote title="Loading shop…" detail={handle ? `Resolving “${handle}”` : ''} />;
  if (status === 'notfound') {
    return <CenterNote title="Shop not found" detail={handle ? `No shop is registered for “${handle}”.` : 'No shop handle in the URL.'} />;
  }
  return <RealStorefront seller={seller} handle={handle} />;
}
