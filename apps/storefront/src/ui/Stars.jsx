/**
 * Stars — render an on-chain star rating (CLAUDE.md §reviews), display + input.
 *
 * <Stars value={4.3} /> renders a read-only row of filled/half/empty stars.
 * <Stars value={q} onChange={setQ} /> renders an interactive 1–5 picker.
 *
 * Pure presentational: no contract reads. Feed it numbers from
 * summarizeSellerRating (averages) or local state (the buyer's picks).
 */
import { Star, StarHalf } from 'lucide-react';
import { starParts } from '../lib/rating.js';

export function Stars({ value = 0, size = 16, onChange, color = 'var(--accent)' }) {
  // Interactive picker: 5 clickable whole stars (no half-steps on input).
  if (onChange) {
    return (
      <span style={{ display: 'inline-flex', gap: 3 }} role="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            size={size}
            onClick={() => onChange(n)}
            role="radio"
            aria-checked={n === value}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            style={{ cursor: 'pointer', color }}
            fill={n <= value ? color : 'none'}
          />
        ))}
      </span>
    );
  }

  // Read-only display: supports half stars from an averaged value.
  const { full, half, empty } = starParts(value);
  return (
    <span style={{ display: 'inline-flex', gap: 2, verticalAlign: 'middle' }} aria-label={`${value} out of 5 stars`}>
      {Array.from({ length: full }).map((_, i) => (
        <Star key={`f${i}`} size={size} style={{ color }} fill={color} />
      ))}
      {half ? <StarHalf size={size} style={{ color }} fill={color} /> : null}
      {Array.from({ length: empty }).map((_, i) => (
        <Star key={`e${i}`} size={size} style={{ color: 'var(--border-strong, var(--border))' }} fill="none" />
      ))}
    </span>
  );
}
