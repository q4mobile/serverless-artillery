export const MAX_RETRIES: number;

export function sleep(ms: number): Promise<void>;

export function withChimeThrottleRetries<T>(
  fn: () => Promise<T>,
  onThrottle: (attempt: number, backoffMs: number) => void
): Promise<T>;

export function isChimeThrottleError(error: { name?: string }): boolean;
