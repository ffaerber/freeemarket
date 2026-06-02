/**
 * Shared admin UI primitives for the CMS.
 *
 * Built on the SAME theme-CSS-variable language as the storefront's ui.jsx
 * (`--bg`/`--surface`/`--accent`/… consumed via inline styles), so the visual
 * vocabulary carries over. The difference: the CMS is NOT white-label per shop —
 * it sets a single neutral dark admin theme (config.ADMIN_THEME) on a root
 * wrapper. These primitives are the admin shell: page chrome, cards, buttons,
 * inputs, pills, banners.
 */
import React from 'react';
import { AlertTriangle } from 'lucide-react';

/** Global styles + Google font imports (DM Sans, shared with the storefront). */
export function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap');
      .fm * { box-sizing: border-box; }
      .fm-btn { transition: transform .12s ease, filter .2s ease, background .2s; cursor: pointer; }
      .fm-btn:hover:not(:disabled) { filter: brightness(1.08); }
      .fm-btn:active:not(:disabled) { transform: scale(.98); }
      .fm-input {
        width: 100%; padding: 11px 13px; border-radius: 10px;
        border: 1px solid var(--border); background: var(--bg); color: var(--text);
        font-family: var(--body); font-size: 14px; outline: none;
      }
      .fm-input:focus { border-color: var(--accent); }
      .fm-tab { transition: color .15s, border-color .15s; cursor: pointer; }
    `}</style>
  );
}

/** Accent pill label (ported from the storefront template). */
export function Pill({ t, tone = 'accent', children }) {
  const color = tone === 'accent2' ? 'var(--accent2)' : 'var(--accent)';
  return (
    <span
      style={{
        fontFamily: 'var(--body)',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '.04em',
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        padding: '4px 10px',
        borderRadius: 999,
        textTransform: t ? 'uppercase' : 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/** Primary (accent-filled) button. */
export function Button({ children, onClick, disabled, type = 'button', style }) {
  return (
    <button
      type={type}
      className="fm-btn"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: 'none',
        background: 'var(--accent)',
        color: '#06121f',
        fontFamily: 'var(--body)',
        fontWeight: 700,
        fontSize: 14,
        padding: '11px 16px',
        borderRadius: 10,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Secondary (outlined) button. */
export function GhostButton({ children, onClick, disabled, style }) {
  return (
    <button
      type="button"
      className="fm-btn"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: '1px solid var(--border)',
        background: 'transparent',
        color: 'var(--text)',
        fontFamily: 'var(--body)',
        fontWeight: 600,
        fontSize: 14,
        padding: '10px 15px',
        borderRadius: 10,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/** Labeled form field wrapping any input. */
export function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
        {label}
      </div>
      {children}
      {hint && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 5, lineHeight: 1.45 }}>
          {hint}
        </div>
      )}
    </label>
  );
}

/** Plain text input bound to the shared .fm-input style. */
export function Input(props) {
  return <input className="fm-input" {...props} />;
}

/** Multi-line text input. */
export function Textarea(props) {
  return <textarea className="fm-input" style={{ resize: 'vertical', ...props.style }} {...props} />;
}

/** Native dropdown bound to the shared .fm-input style. */
export function Select(props) {
  return <select className="fm-input" {...props} />;
}

/** Card surface — the standard admin container. */
export function Card({ children, style }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Section header with a title + optional subtitle/right slot. */
export function SectionHeader({ title, subtitle, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18 }}>
      <div>
        <h2 style={{ fontFamily: 'var(--display)', fontSize: 24, fontWeight: 700, margin: 0 }}>{title}</h2>
        {subtitle && (
          <p style={{ color: 'var(--muted)', fontSize: 14, margin: '6px 0 0', maxWidth: '60ch', lineHeight: 1.5 }}>
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </div>
  );
}

/** Inline warning/info banner. */
export function Banner({ tone = 'warn', children }) {
  const color = tone === 'error' ? '#ff6b6b' : tone === 'info' ? 'var(--accent)' : 'var(--accent2)';
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '12px 14px',
        borderRadius: 10,
        border: `1px solid color-mix(in srgb, ${color} 40%, var(--border))`,
        background: `color-mix(in srgb, ${color} 8%, transparent)`,
        color: 'var(--text)',
        fontSize: 13,
        lineHeight: 1.5,
        marginBottom: 16,
      }}
    >
      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color }} />
      <div>{children}</div>
    </div>
  );
}

/** Inline error note (wagmi/viem error shape aware). */
export function ErrorNote({ error }) {
  if (!error) return null;
  const msg = error.shortMessage || error.message || String(error);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10, color: '#ff6b6b', fontSize: 13 }}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{msg}</span>
    </div>
  );
}
