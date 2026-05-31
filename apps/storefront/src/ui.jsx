/**
 * Shared white-label UI primitives ported from the demo template
 * (Storefront.jsx). These consume the theme CSS variables set by <Storefront>.
 */
import React from 'react';

/** Global styles + Google font imports (ported verbatim from the template). */
export function Styles() {
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

/** Accent pill label (ported from the template). */
export function Pill({ t, children }) {
  return (
    <span
      style={{
        fontFamily: 'var(--body)',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '.04em',
        color: 'var(--accent)',
        background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
        padding: '5px 11px',
        borderRadius: 999,
        textTransform: t ? 'uppercase' : 'none',
      }}
    >
      {children}
    </span>
  );
}
