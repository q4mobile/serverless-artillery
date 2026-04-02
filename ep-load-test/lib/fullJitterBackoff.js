/**
 * Full jitter for exponential backoff: sleep duration is uniform in [0, cap],
 * where cap = min(maxMs, initialMs * 2^attempt). Reduces synchronized retries under load.
 *
 * @param {number} attempt - 0-based retry index
 * @param {{ initialMs: number; maxMs: number }} opts
 * @returns {number} milliseconds to sleep before the next attempt
 */
function fullJitterBackoffMs(attempt, opts) {
  const { initialMs, maxMs } = opts;
  const exponential = initialMs * 2 ** attempt;
  const capped = Math.min(exponential, maxMs);
  return Math.floor(Math.random() * (capped + 1));
}

module.exports = { fullJitterBackoffMs };
