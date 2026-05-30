import React, { useState } from "react";
import { ShoppingBag, X, Check, Lock, Wallet, Truck, Store, ArrowRight } from "lucide-react";

/**
 * FreeMarket — white-label storefront engine.
 *
 * One engine, many shops. Everything a merchant customizes lives in the
 * `shop` config object below: theme tokens, copy, and listings. In production
 * the `listings` come from the Gnosis `Marketplace` contract (filtered by the
 * shop's seller address) and the descriptive fields come from each listing's
 * Swarm metadata hash. Prices shown here are USDC (on-chain they're 6-dp ints).
 *
 * To launch a shop: clone this, edit the config, deploy to your own ENS + Swarm.
 */

const SHOPS = {
  fruit: {
    seller: "0xF00D…a17e",
    ens: "sunnyfield.eth",
    theme: {
      bg: "#FFF7EE", surface: "#FFFFFF", text: "#2B1A12", muted: "#9A7C68",
      accent: "#FF4D6D", accent2: "#FFA51E", border: "#F1E3D3", radius: "22px",
      display: "'Fraunces', Georgia, serif", body: "'DM Sans', sans-serif",
      hero: "radial-gradient(120% 120% at 80% 0%, #FFE6CC 0%, #FFF7EE 55%)",
    },
    name: "Sunny Field", tagline: "Freeze-dried fruit, nothing else added.",
    blurb: "Single-origin fruit, freeze-dried at harvest. Crunchy, bright, real.",
    listings: [
      { id: 1, title: "Strawberries", variant: "10 g pouch", price: 3.5, glyph: "🍓", note: "One ingredient. Whole slices." },
      { id: 2, title: "Strawberries", variant: "100 g jar", price: 14, glyph: "🍓", note: "Family jar, resealable." },
      { id: 3, title: "Bananas", variant: "10 g pouch", price: 3, glyph: "🍌", note: "Coins, no sugar coating." },
      { id: 4, title: "Bananas", variant: "100 g jar", price: 12, glyph: "🍌", note: "Snack-all-week size." },
      { id: 5, title: "Mango", variant: "100 g jar", price: 16, glyph: "🥭", note: "Alphonso, intense." },
      { id: 6, title: "Mixed Berries", variant: "100 g jar", price: 18, glyph: "🫐", note: "Strawberry · blueberry · rasp." },
    ],
  },
  auto: {
    seller: "0xCAFE…b210",
    ens: "apexdriveline.eth",
    theme: {
      bg: "#0D1014", surface: "#15191F", text: "#E8EEF4", muted: "#7E8893", accent: "#FF6A00",
      accent2: "#FFD400", border: "#242C36", radius: "4px",
      display: "'Bebas Neue', Impact, sans-serif", body: "'DM Sans', sans-serif",
      hero: "linear-gradient(135deg, #15191F 0%, #0D1014 60%), repeating-linear-gradient(45deg, #ffffff05 0 2px, transparent 2px 10px)",
    },
    name: "Apex Driveline", tagline: "OEM-spec parts. Shipped trustless.",
    blurb: "Performance and replacement parts. Escrowed payment, verified delivery.",
    listings: [
      { id: 1, title: "Brake Pads", variant: "Front · ceramic", price: 64, glyph: "🛞", note: "Low-dust, fade-resistant." },
      { id: 2, title: "Turbocharger", variant: "T3 · .63 A/R", price: 420, glyph: "🌀", note: "Billet wheel, balanced." },
      { id: 3, title: "Clutch Kit", variant: "Stage 2", price: 285, glyph: "⚙️", note: "Organic disc + pressure plate." },
      { id: 4, title: "Spark Plugs", variant: "Set of 4 · iridium", price: 38, glyph: "🔩", note: "Pre-gapped, long-life." },
      { id: 5, title: "Oil Filter", variant: "Spin-on", price: 12, glyph: "🔧", note: "High-flow media." },
      { id: 6, title: "Coilovers", variant: "32-way adj.", price: 760, glyph: "🛠️", note: "Monotube, height-adjustable." },
    ],
  },
};

function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,900&family=DM+Sans:wght@400;500;700&family=Bebas+Neue&display=swap');
      @keyframes fmRise { from { opacity:0; transform: translateY(14px);} to {opacity:1; transform:none;} }
      @keyframes fmFade { from { opacity:0 } to { opacity:1 } }
      .fm * { box-sizing: border-box; }
      .fm-card { transition: transform .25s cubic-bezier(.2,.8,.2,1), box-shadow .25s; cursor: pointer; }
      .fm-card:hover { transform: translateY(-6px); }
      .fm-btn { transition: transform .12s ease, filter .2s ease, background .2s; cursor: pointer; }
      .fm-btn:hover { filter: brightness(1.06); }
      .fm-btn:active { transform: scale(.98); }
      .fm-rise { animation: fmRise .5s both; }
      .fm-overlay { animation: fmFade .2s both; }
      .fm-x { transition: opacity .15s; opacity:.6; cursor:pointer; }
      .fm-x:hover { opacity: 1; }
    `}</style>
  );
}

function Pill({ t, children }) {
  return (
    <span style={{ fontFamily: "var(--body)", fontSize: 12, fontWeight: 700, letterSpacing: ".04em",
      color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 12%, transparent)",
      padding: "5px 11px", borderRadius: 999, textTransform: t ? "uppercase" : "none" }}>{children}</span>
  );
}

function Checkout({ shop, item, onClose }) {
  const [step, setStep] = useState(0);
  const steps = [
    { icon: Wallet, title: "Connect wallet", body: "Connect on Gnosis Chain.", call: "wagmi · connect()" },
    { icon: Lock, title: "Approve USDC", body: `Allow the marketplace to pull $${item.price.toFixed(2)} USDC.`, call: "usdc.approve(market, price)" },
    { icon: ShoppingBag, title: "Pay into escrow", body: "Funds are held by the contract, not the seller, until you confirm delivery.", call: "market.buy(listingId, shippingRef)" },
    { icon: Truck, title: "Send shipping address", body: "Your address is encrypted to the shop's key and sent over Swarm PSS — never on-chain in plaintext.", call: "pss.send(shopKey, encrypt(address))" },
  ];
  const done = step >= steps.length;
  const S = done ? null : steps[step];
  return (
    <div className="fm-overlay" onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)",
      display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50, backdropFilter: "blur(3px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, background: "var(--surface)",
        color: "var(--text)", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <Pill t>Checkout · preview</Pill>
          <X size={20} className="fm-x" onClick={onClose} style={{ color: "var(--text)" }} />
        </div>
        {done ? (
          <div style={{ textAlign: "center", padding: "18px 0 8px" }}>
            <div style={{ width: 56, height: 56, borderRadius: 999, background: "var(--accent)", color: "#fff",
              display: "grid", placeItems: "center", margin: "0 auto 16px" }}><Check size={28} /></div>
            <div style={{ fontFamily: "var(--display)", fontSize: 26, marginBottom: 6 }}>Order placed</div>
            <div style={{ fontFamily: "var(--body)", color: "var(--muted)", fontSize: 14, lineHeight: 1.5 }}>
              ${item.price.toFixed(2)} USDC is escrowed on Gnosis. It releases to {shop.name} when you confirm the
              package arrived — or auto-releases after the timeout. Dispute any time before that.
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
              {steps.map((_, i) => (
                <div key={i} style={{ flex: 1, height: 4, borderRadius: 4,
                  background: i <= step ? "var(--accent)" : "var(--border)", transition: "background .3s" }} />
              ))}
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 22 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "color-mix(in srgb, var(--accent) 14%, transparent)",
                color: "var(--accent)", display: "grid", placeItems: "center", flexShrink: 0 }}><S.icon size={22} /></div>
              <div>
                <div style={{ fontFamily: "var(--display)", fontSize: 22, lineHeight: 1.05 }}>{S.title}</div>
                <div style={{ fontFamily: "var(--body)", color: "var(--muted)", fontSize: 14, marginTop: 4, lineHeight: 1.5 }}>{S.body}</div>
                <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 11.5, color: "var(--accent)",
                  background: "color-mix(in srgb, var(--accent) 8%, transparent)", padding: "3px 7px", borderRadius: 6,
                  display: "inline-block", marginTop: 10 }}>{S.call}</code>
              </div>
            </div>
            <button className="fm-btn" onClick={() => setStep(step + 1)} style={{ width: "100%", border: "none",
              background: "var(--accent)", color: "#fff", fontFamily: "var(--body)", fontWeight: 700, fontSize: 15,
              padding: "15px", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {step === steps.length - 1 ? "Place order" : "Continue"} <ArrowRight size={17} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Storefront({ shop }) {
  const t = shop.theme;
  const [item, setItem] = useState(null);
  const vars = {
    "--bg": t.bg, "--surface": t.surface, "--text": t.text, "--muted": t.muted,
    "--accent": t.accent, "--accent2": t.accent2, "--border": t.border,
    "--radius": t.radius, "--display": t.display, "--body": t.body,
  };
  return (
    <div className="fm" style={{ ...vars, background: t.bg, color: t.text, minHeight: "100%", fontFamily: "var(--body)" }}>
      {/* hero */}
      <header style={{ background: t.hero, borderBottom: `1px solid var(--border)`, padding: "54px 22px 46px" }}>
        <div style={{ maxWidth: 1040, margin: "0 auto" }}>
          <div className="fm-rise" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
            <Store size={18} style={{ color: "var(--accent)" }} />
            <span style={{ fontWeight: 700, letterSpacing: ".02em" }}>{shop.ens}</span>
          </div>
          <h1 className="fm-rise" style={{ fontFamily: "var(--display)", fontSize: "clamp(40px, 9vw, 76px)",
            lineHeight: .95, margin: 0, fontWeight: 900, maxWidth: 14 + "ch", animationDelay: ".05s" }}>{shop.name}</h1>
          <p className="fm-rise" style={{ fontSize: "clamp(16px,2.4vw,20px)", color: "var(--muted)", marginTop: 16,
            maxWidth: "46ch", animationDelay: ".12s" }}>{shop.tagline}</p>
          <div className="fm-rise" style={{ marginTop: 20, animationDelay: ".18s" }}><Pill>Pays in USDC · escrow on Gnosis</Pill></div>
        </div>
      </header>

      {/* grid */}
      <main style={{ maxWidth: 1040, margin: "0 auto", padding: "40px 22px 80px" }}>
        <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 24, maxWidth: "60ch" }}>{shop.blurb}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 18 }}>
          {shop.listings.map((l, i) => (
            <div key={l.id} className="fm-card fm-rise" onClick={() => setItem(l)}
              style={{ background: "var(--surface)", border: `1px solid var(--border)`, borderRadius: "var(--radius)",
                overflow: "hidden", animationDelay: `${0.05 * i}s` }}>
              <div style={{ aspectRatio: "1/1", display: "grid", placeItems: "center", fontSize: 64,
                background: `color-mix(in srgb, var(--accent) 8%, var(--surface))` }}>{l.glyph}</div>
              <div style={{ padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: "var(--display)", fontSize: 21, lineHeight: 1 }}>{l.title}</span>
                  <span style={{ fontWeight: 700, color: "var(--accent)", whiteSpace: "nowrap" }}>${l.price.toFixed(2)}</span>
                </div>
                <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 6 }}>{l.variant}</div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* product modal */}
      {item && (
        <div className="fm-overlay" onClick={() => setItem(null)} style={{ position: "fixed", inset: 0,
          background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 40, padding: 18, backdropFilter: "blur(2px)" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", color: "var(--text)",
            borderRadius: 20, maxWidth: 420, width: "100%", border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ aspectRatio: "16/10", display: "grid", placeItems: "center", fontSize: 96,
              background: `color-mix(in srgb, var(--accent) 10%, var(--surface))`, position: "relative" }}>
              {item.glyph}
              <X size={20} className="fm-x" onClick={() => setItem(null)} style={{ position: "absolute", top: 14, right: 14, color: "var(--text)" }} />
            </div>
            <div style={{ padding: 22 }}>
              <div style={{ fontFamily: "var(--display)", fontSize: 30, lineHeight: 1 }}>{item.title}</div>
              <div style={{ color: "var(--muted)", marginTop: 6 }}>{item.variant} · {item.note}</div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 20 }}>
                <span style={{ fontFamily: "var(--display)", fontSize: 30, color: "var(--accent)" }}>${item.price.toFixed(2)}</span>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>USDC</span>
              </div>
              <ProductBuy shop={shop} item={item} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProductBuy({ shop, item }) {
  const [checkout, setCheckout] = useState(false);
  return (
    <>
      <button className="fm-btn" onClick={() => setCheckout(true)} style={{ width: "100%", marginTop: 18, border: "none",
        background: "var(--accent)", color: "#fff", fontFamily: "var(--body)", fontWeight: 700, fontSize: 15,
        padding: "15px", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <ShoppingBag size={17} /> Buy with USDC
      </button>
      {checkout && <Checkout shop={shop} item={item} onClose={() => setCheckout(false)} />}
    </>
  );
}

export default function App() {
  const [key, setKey] = useState("fruit");
  const keys = Object.keys(SHOPS);
  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a" }}>
      <Styles />
      {/* demo control — NOT part of a real storefront */}
      <div style={{ background: "#0a0a0a", color: "#fff", padding: "10px 16px", display: "flex",
        alignItems: "center", gap: 14, justifyContent: "center", fontFamily: "'DM Sans', sans-serif", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12.5, opacity: .65 }}>Same engine, different shop config →</span>
        <div style={{ display: "flex", gap: 4, background: "#1b1b1b", padding: 4, borderRadius: 999 }}>
          {keys.map((k) => (
            <button key={k} onClick={() => setKey(k)} className="fm-btn" style={{ border: "none",
              background: key === k ? "#fff" : "transparent", color: key === k ? "#000" : "#aaa",
              fontWeight: 700, fontSize: 13, padding: "7px 16px", borderRadius: 999 }}>
              {SHOPS[k].name}
            </button>
          ))}
        </div>
      </div>
      <Storefront key={key} shop={SHOPS[key]} />
    </div>
  );
}
