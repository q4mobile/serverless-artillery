export function jitterBackoff(
  attempt: number,
  opts: { initialMs: number; maxMs: number }
): number;
