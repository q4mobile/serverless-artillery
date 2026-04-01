export function fullJitterBackoffMs(
  attempt: number,
  opts: { initialMs: number; maxMs: number }
): number;
