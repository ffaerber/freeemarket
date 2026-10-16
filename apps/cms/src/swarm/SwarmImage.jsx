/**
 * An <img> for Swarm content that survives a slow gateway.
 *
 * The image's chunks are fetched one by one from the network, and a gateway
 * that cannot get one in time answers 404/5xx or simply hangs — a plain <img>
 * then shows a broken icon and never asks again. So the bytes are fetched
 * through swarm-connect's `read` (the user's node or the gateway, with the
 * API key when there is one — which an <img src> cannot send) with a timeout,
 * retried with backoff, and the <img> only ever sees a finished blob.
 *
 * Kept in sync between apps/storefront and apps/cms (we can't import across apps).
 */
import React, { useEffect, useRef, useState } from 'react';
import { useSwarm } from './SwarmContext.jsx';
import { RETRIES, retryDelayMs } from '../lib/retry.js';

const ATTEMPT_TIMEOUT_MS = 30_000;

function Spinner({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-label="loading" style={{ color: 'var(--accent, #4F46E5)' }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

/**
 * @param {object} props
 * @param {string} props.path   Swarm path, e.g. `/bytes/<ref>` (see swarmImagePath).
 * @param {string} [props.alt]
 * @param {object} [props.style]     style for the <img> once loaded
 * @param {object} [props.boxStyle]  style for the box shown while loading / after giving up
 * @param {boolean} [props.lazy]     start fetching only when near the viewport
 */
export default function SwarmImage({ path, alt = '', style, boxStyle, lazy = false }) {
  const { read } = useSwarm();
  const boxRef = useRef(null);
  const [visible, setVisible] = useState(!lazy);
  const [phase, setPhase] = useState('waiting'); // waiting | loading | loaded | failed
  const [attempt, setAttempt] = useState(0);
  // Bumped by "tap to retry", so a manual retry reruns even when attempt is 0.
  const [round, setRound] = useState(0);
  const [blobUrl, setBlobUrl] = useState();

  useEffect(() => {
    if (visible || !boxRef.current) return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    }, { rootMargin: '200px' });
    io.observe(boxRef.current);
    return () => io.disconnect();
  }, [visible]);

  // A new reference starts over.
  useEffect(() => {
    setAttempt(0);
    setPhase('waiting');
  }, [path]);

  useEffect(() => {
    if (!visible || !path) return undefined;
    let cancelled = false;
    let url;
    let retryTimer;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

    setPhase('loading');
    // A retry must not be answered from the HTTP cache that just failed it.
    read.fetch(path, { signal: controller.signal, cache: attempt > 0 || round > 0 ? 'reload' : 'default' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setPhase('loaded');
      })
      .catch(() => {
        if (cancelled) return;
        if (attempt < RETRIES) retryTimer = setTimeout(() => setAttempt((a) => a + 1), retryDelayMs(attempt));
        else setPhase('failed');
      })
      .finally(() => clearTimeout(timer));

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(retryTimer);
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [visible, path, read, attempt, round]);

  if (phase === 'loaded' && blobUrl) {
    return (
      <img
        src={blobUrl}
        alt={alt}
        style={style}
        // A blob that is not a decodable image counts as a failed attempt.
        onError={() => (attempt < RETRIES ? setAttempt((a) => a + 1) : setPhase('failed'))}
      />
    );
  }

  const retryNow = (e) => {
    // Image tiles may sit inside a link or button; retrying must not trigger it.
    e.preventDefault();
    e.stopPropagation();
    setAttempt(0);
    setRound((r) => r + 1);
  };

  return (
    <div
      ref={boxRef}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--muted, #6B7280)', fontSize: 11, ...boxStyle }}
    >
      {phase === 'failed' ? (
        <button
          type="button"
          onClick={retryNow}
          title="The image did not load. Try again."
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', font: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
          retry
        </button>
      ) : (
        <>
          <Spinner />
          {attempt > 0 && <span>retry {attempt}/{RETRIES}</span>}
        </>
      )}
    </div>
  );
}
