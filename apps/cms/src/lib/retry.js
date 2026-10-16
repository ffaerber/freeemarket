/**
 * Backoff for Swarm reads. A gateway that could not fetch a chunk in time
 * often has it on the next try (the first attempt pulled it into its cache),
 * so a few spaced retries turn most "failed to load" into a short wait.
 *
 * Kept in sync between apps/storefront and apps/cms (we can't import across apps).
 */
export const RETRIES = 4; // after the first attempt: waits 1s, 2s, 4s, 8s

export const retryDelayMs = (attempt) => 1000 * 2 ** attempt;

/**
 * Run fn, retrying with backoff until it succeeds or retries run out.
 * @template T
 * @param {(attempt: number) => Promise<T>} fn
 * @param {() => boolean} [isCancelled]
 * @returns {Promise<T>}
 */
export async function withRetry(fn, isCancelled = () => false) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (attempt >= RETRIES || isCancelled()) throw e;
      await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
      if (isCancelled()) throw e;
    }
  }
}
