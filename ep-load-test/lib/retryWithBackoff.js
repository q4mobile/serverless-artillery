const { jitterBackoff } = require("./backoff.js");

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 8000;
const MAX_RETRIES = 3;

function isThrottleError(error) {
  return (
    error.name === "TooManyRequestsException" ||
    error.name === "ThrottledClientException"
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn`; on Chime throttle, logs and retries up to MAX_RETRIES times.
 * @template T
 * @param {() => Promise<T>} fn
 * @param {(attempt: number, backoffMs: number) => void} onThrottle
 * @returns {Promise<T>}
 */
async function withRetries(fn, onThrottle) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isThrottleError(error) || attempt >= MAX_RETRIES) {
        throw error;
      }
      const backoffMs = jitterBackoff(attempt, { initialMs: INITIAL_BACKOFF_MS, maxMs: MAX_BACKOFF_MS });
      onThrottle(attempt + 1, backoffMs);
      await sleep(backoffMs);
    }
  }
}

module.exports = {
  MAX_RETRIES,
  sleep,
  withRetries,
  isThrottleError
};
