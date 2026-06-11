/**
 * Shared admin UI primitives for the CMS.
 *
 * These keep their original component API (so the section components don't
 * change) but now render the shared design-system classes from
 * src/design/identity.css — the clean web3 look. Inputs already used .fm-input;
 * buttons/cards/pills/fields now map to .fm-btn / .fm-card / .fm-pill / .fm-field.
 */
import React from 'react';
import { AlertTriangle } from 'lucide-react';

/** Kept for import-compatibility; global styling now lives in design/identity.css. */
export function Styles() {
  return null;
}

/** Pill label. tone 'accent2' → green trust pill, 'price' → blue, else neutral. */
export function Pill({ tone, children }) {
  const cls = tone === 'accent2' ? 'fm-pill fm-pill--trust' : tone === 'price' ? 'fm-pill fm-pill--price' : 'fm-pill';
  return <span className={cls}>{children}</span>;
}

/** Primary (filled blue) button. */
export function Button({ children, onClick, disabled, type = 'button', style }) {
  return (
    <button type={type} className="fm-btn fm-btn--primary" onClick={onClick} disabled={disabled} style={{ opacity: disabled ? 0.5 : 1, ...style }}>
      {children}
    </button>
  );
}

/** Secondary (outlined) button. */
export function GhostButton({ children, onClick, disabled, style }) {
  return (
    <button type="button" className="fm-btn fm-btn--ghost" onClick={onClick} disabled={disabled} style={{ opacity: disabled ? 0.5 : 1, ...style }}>
      {children}
    </button>
  );
}

/** Labeled form field wrapping any input. */
export function Field({ label, hint, children }) {
  return (
    <label className="fm-field" style={{ marginBottom: 14 }}>
      <span className="fm-label">{label}</span>
      {children}
      {hint && <span className="fm-small" style={{ lineHeight: 1.45 }}>{hint}</span>}
    </label>
  );
}

export function Input(props) {
  return <input className="fm-input" {...props} />;
}

export function Textarea(props) {
  return <textarea className="fm-input fm-textarea" style={{ resize: 'vertical', ...props.style }} {...props} />;
}

export function Select(props) {
  return <select className="fm-select" {...props} />;
}

/** Card surface — the standard admin container (design .fm-card + padding). */
export function Card({ children, style }) {
  return (
    <div className="fm-card" style={{ padding: 22, ...style }}>
      {children}
    </div>
  );
}

/** Section header with a title + optional subtitle/right slot. */
export function SectionHeader({ title, subtitle, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
      <div>
        <h2 className="fm-h3">{title}</h2>
        {subtitle && <p className="fm-body" style={{ margin: '8px 0 0', maxWidth: '64ch', fontSize: 14.5 }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

/** Inline warning/info/error banner. */
export function Banner({ tone = 'warn', children }) {
  const map = {
    error: { c: '#D92D55', bg: 'rgba(217,45,85,0.07)', b: 'rgba(217,45,85,0.32)' },
    info: { c: 'var(--neon-700)', bg: 'var(--blue-tint)', b: 'rgba(62,120,255,0.32)' },
    warn: { c: 'var(--amber-700, #A46B14)', bg: 'rgba(243,149,16,0.08)', b: 'rgba(243,149,16,0.35)' },
  };
  const s = map[tone] || map.warn;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '13px 15px', borderRadius: 'var(--radius-md)', border: `1.5px solid ${s.b}`, background: s.bg, color: 'var(--fg)', fontSize: 13.5, lineHeight: 1.5, marginBottom: 16 }}>
      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: s.c }} />
      <div>{children}</div>
    </div>
  );
}

/** Inline error note (wagmi/viem error shape aware). */
export function ErrorNote({ error }) {
  if (!error) return null;
  const msg = error.shortMessage || error.message || String(error);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, color: '#D92D55', fontSize: 13 }}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{msg}</span>
    </div>
  );
}
