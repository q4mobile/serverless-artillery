import { pickBy } from 'es-toolkit/object';
import type { RegisterAnalystsDeps } from './register-analysts.types';

const SVC = 'ep-load-test';

/** Drop keys whose values are `undefined` (keeps `false` and `0`). */
export function stripUndefined<T extends Record<string, unknown>>(
  obj: T
): Record<string, unknown> {
  return pickBy(obj, (v) => v !== undefined) as Record<string, unknown>;
}

export function serviceLogFields(): { svc: string; env: string } {
  return { svc: SVC, env: process.env.NODE_ENV || 'development' };
}

type LogLevel = 'ERROR' | 'WARN' | 'INFO';

/**
 * One JSON log line: injects `ts` and service metadata, drops `undefined` extras.
 */
export function writeJsonLog(
  deps: Pick<RegisterAnalystsDeps, 'log'>,
  record: { lvl: LogLevel; evt: string; msg: string } & Record<string, unknown>
): void {
  const { lvl, evt, msg, ...rest } = record;
  const cleaned = stripUndefined(rest as Record<string, unknown>);
  deps.log({
    ts: new Date().toISOString(),
    lvl,
    ...serviceLogFields(),
    evt,
    msg,
    ...cleaned,
  });
}
