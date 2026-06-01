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
import { Store, ShoppingBag, Truck } from 'lucide-react';
import { describeShippingPolicy, shippingFromPricing } from '@freemarket/schema';
import { Styles, Pill } from './ui.jsx';
import Checkout from './checkout/Checkout.jsx';
import { useShop } from './hooks/useShop.js';
import { useListings, groupListings } from './hooks/useListings.js';
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

/** Coerce a listing's ON-CHAIN stock to a count (bigint or number), or null. */
function stockCount(item) {
  return item?.stockCount != null
    ? item.stockCount
    : item?.stock != null
      ? Number(item.stock)
      : null;
}

function ProductBuy({ shop, item }) {
  const [checkout, setCheckout] = useState(false);
  const count = stockCount(item);
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
 * Format a group's price for the card: a single price when all variants share
 * one, else a "lo–hi {symbol}" range (variants are price-sorted ascending).
 */
function groupPriceLabel(group) {
  const vs = group.variants;
  const lo = vs[0];
  const hi = vs[vs.length - 1];
  if (lo.priceFormatted === hi.priceFormatted) {
    return `${lo.priceFormatted} ${lo.symbol}`;
  }
  return `${lo.priceFormatted}–${hi.priceFormatted} ${lo.symbol}`;
}

/** A group is sold out only when EVERY variant's on-chain stock is 0. */
function groupSoldOut(group) {
  return group.variants.every((v) => {
    const c = stockCount(v);
    return c != null && c <= 0;
  });
}

/**
 * Variant selector — pill buttons of each variant's label. Hidden entirely for a
 * group of one (renders nothing). Sold-out variants stay selectable (so the
 * buyer can see the price/state) but are visually muted.
 */
function VariantSelector({ group, selectedId, onSelect }) {
  if (group.variants.length <= 1) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Variant</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {group.variants.map((v) => {
          const c = stockCount(v);
          const sold = c != null && c <= 0;
          const active = v.id.toString() === selectedId?.toString();
          return (
            <button
              key={v.id.toString()}
              onClick={() => onSelect(v)}
              style={{
                fontFamily: 'var(--body)', fontSize: 13, fontWeight: 700,
                padding: '8px 12px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                background: active ? 'color-mix(in srgb, var(--accent) 14%, var(--surface))' : 'var(--surface)',
                color: active ? 'var(--accent)' : 'var(--text)',
                opacity: sold ? 0.55 : 1,
              }}
            >
              {v.variantLabel || v.variant || v.title}{sold ? ' · sold out' : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The pure presentational engine. Receives a normalized `shop` (theme/copy +
 * `seller`) and a `groups` array (each: { title, variants:[listing,…] });
 * identical shape in demo and real paths. One card renders per GROUP; the modal
 * carries a variant selector. A group of one behaves exactly like before.
 */
function StorefrontView({ shop, groups, isLoading, error, hero, demo }) {
  const t = shop.theme;
  // The open product modal holds a group; `selected` is the active variant.
  const [group, setGroup] = useState(null);
  const [selected, setSelected] = useState(null);
  function openGroup(g) {
    setGroup(g);
    // Default to the first IN-STOCK variant, else the first (cheapest).
    const firstAvailable = g.variants.find((v) => {
      const c = stockCount(v);
      return c == null || c > 0;
    });
    setSelected(firstAvailable || g.variants[0]);
  }
  function closeGroup() {
    setGroup(null);
    setSelected(null);
  }
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
          <div className="fm-rise" style={{ marginTop: 20, animationDelay: '.18s', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <Pill>Pays in stablecoins · escrow on Gnosis</Pill>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>
              <Truck size={15} style={{ color: 'var(--accent2)' }} /> Ships to: {describeShippingPolicy(shop.shipping)}
            </span>
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
        {!isLoading && !error && groups.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 14 }}>
            No active listings for this shop yet.
          </div>
        )}

        {/* One card per GROUP. A group of one renders like a single product card
            (no selector); a multi-variant group shows a price range + sold-out
            state aggregated across variants. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 18 }}>
          {groups.map((g, i) => {
            const lead = g.variants[0]; // cheapest (groupListings sorts ascending)
            const soldOut = groupSoldOut(g);
            return (
              <div
                key={g.key}
                className="fm-card fm-rise"
                onClick={() => openGroup(g)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', animationDelay: `${0.05 * i}s` }}
              >
                <ProductMedia listing={lead} aspect="1/1" fontSize={64} />
                <div style={{ padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--display)', fontSize: 21, lineHeight: 1 }}>{g.title}</span>
                    <span style={{ fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{groupPriceLabel(g)}</span>
                  </div>
                  {g.variants.length > 1 ? (
                    <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>
                      {g.variants.length} variants
                    </div>
                  ) : (
                    lead.variant && <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>{lead.variant}</div>
                  )}
                  {soldOut ? (
                    <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>Sold out</div>
                  ) : (
                    g.variants.length === 1 && <StockBadge item={lead} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {/* product modal — carries a variant selector; `selected` is the active variant */}
      {group && selected && (
        <div className="fm-overlay" onClick={closeGroup} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40, padding: 18, backdropFilter: 'blur(2px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', color: 'var(--text)', borderRadius: 20, maxWidth: 420, width: '100%', border: '1px solid var(--border)', overflow: 'hidden' }}>
            <div style={{ position: 'relative' }}>
              <ProductMedia listing={selected} aspect="16/10" fontSize={96} />
              <span className="fm-x" onClick={closeGroup} style={{ position: 'absolute', top: 14, right: 14, color: 'var(--text)', background: 'var(--surface)', borderRadius: 999, width: 28, height: 28, display: 'grid', placeItems: 'center' }}>✕</span>
            </div>
            <div style={{ padding: 22 }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: 30, lineHeight: 1 }}>{group.title}</div>
              <div style={{ color: 'var(--muted)', marginTop: 6 }}>
                {[selected.variantLabel || selected.variant, selected.description].filter(Boolean).join(' · ')}
              </div>

              {/* Variant selector (hidden for a group of one). Selecting updates
                  price/stock/images and re-targets the Buy at that listingId. */}
              <VariantSelector group={group} selectedId={selected.id} onSelect={setSelected} />

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
                <span style={{ fontFamily: 'var(--display)', fontSize: 30, color: 'var(--accent)' }}>{selected.priceFormatted}</span>
                <span style={{ color: 'var(--muted)', fontSize: 13 }}>{selected.symbol}</span>
              </div>
              {/* DISPLAY-ONLY itemization of the ON-CHAIN total (price already
                  INCLUDES shipping). Shown only when shipping is non-zero; the
                  per-variant breakdown switches with the variant selector above.
                  Shipping is FLAT (not per-region) — the contract never sees the
                  destination country (§5). */}
              {selected.hasShipping && (
                <div style={{ marginTop: 6, color: 'var(--muted)', fontSize: 13 }}>
                  item {selected.itemFormatted} {selected.symbol} + shipping {selected.shippingFormatted} {selected.symbol}
                </div>
              )}
              <StockBadge item={selected} />
              {demo ? (
                <div style={{ marginTop: 18, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', color: 'var(--muted)', fontSize: 13 }}>
                  Checkout is disabled in DEMO MODE. Set VITE_MARKETPLACE_ADDRESS + VITE_SELLER to enable the real escrow flow.
                </div>
              ) : (
                // Keyed by variant id so the Buy/Checkout state resets per variant.
                <ProductBuy key={selected.id.toString()} shop={shop} item={selected} />
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
  // Normalize the demo listings to the shape loadListings() produces, then run
  // them through the SAME pure grouping helper the real path uses — so the demo
  // exercises the real grouped card/selector UI (shared productId ⇒ one card).
  const listings = DEMO_SHOP.listings.map((l) => {
    // Run demo listings through the SAME price-itemization helper as the real
    // path so the breakdown sub-line renders in DEMO MODE (the on-chain price
    // here is the demo's priceFormatted; pricing is its optional breakdown).
    const norm = shippingFromPricing(l.pricing, l.priceFormatted);
    return {
      ...l,
      id: BigInt(l.id),
      images: l.images || [],
      productId: l.productId || '',
      variantLabel: l.variantLabel || l.variant || l.title,
      stockCount: l.stock != null ? Number(l.stock) : null,
      pricing: l.pricing || null,
      itemFormatted: norm.item,
      shippingFormatted: norm.shipping,
      hasShipping: norm.hasShipping,
    };
  });
  const shop = {
    seller: DEMO_SHOP.seller,
    ens: DEMO_SHOP.ens,
    name: DEMO_SHOP.name,
    tagline: DEMO_SHOP.tagline,
    blurb: DEMO_SHOP.blurb,
    theme: DEMO_SHOP.theme,
    shipping: DEMO_SHOP.shipping,
  };
  return <StorefrontView shop={shop} groups={groupListings(listings)} isLoading={false} error={null} hero={DEMO_SHOP.hero} demo />;
}

/** REAL path: read shop + listings from chain/Swarm (grouped by productId). */
function RealStorefront() {
  const { shop } = useShop();
  const { groups, isLoading, error } = useListings();
  return <StorefrontView shop={shop} groups={groups} isLoading={isLoading} error={error} />;
}

export default function Storefront() {
  return (
    <div style={{ minHeight: '100vh' }}>
      <Styles />
      {DEMO_MODE ? <DemoStorefront /> : <RealStorefront />}
    </div>
  );
}
