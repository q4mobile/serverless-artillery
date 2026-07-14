import { realpathSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { loadStopConfigFromEnv } from './broadcast-config';
import { buildStopBroadcastBody } from './broadcast-graphql';
import { exchangeToken } from './broadcast-token-exchange';
import { writeJsonLog } from './register-analysts-logging';
import { parseLabeledJson } from './register-analysts-json';
import { jitterBackoff } from '../lib/backoff.js';
import type { BroadcastDeps, BroadcastResponse, BroadcastRunResult, StopBroadcastConfig } from './broadcast.types';
import type { FetchFn } from './register-analysts.types';

const MAX_ATTEMPTS = 3;

function defaultDeps(): BroadcastDeps {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('global fetch is required (Node.js 18+)');
  }
  return {
    fetch: globalThis.fetch.bind(globalThis) as FetchFn,
    log: (record) => process.stdout.write(`${JSON.stringify(record)}\n`),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

async function callStopBroadcast(
  deps: BroadcastDeps,
  url: string,
  headers: Record<string, string>,
  meetingId: number,
  context: string,
  fetchTimeoutMs: number
): Promise<{ ok: boolean; status: number; text: string }> {
  const body = JSON.stringify(buildStopBroadcastBody(meetingId, context));
  let last = { ok: false, status: 0, text: '' };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const init: RequestInit = { method: 'POST', headers, body };
    if (fetchTimeoutMs > 0) {
      const timeout = (AbortSignal as typeof AbortSignal & { timeout?: (ms: number) => AbortSignal }).timeout;
      if (timeout) Object.assign(init, { signal: timeout(fetchTimeoutMs) });
    }
    try {
      const res = await deps.fetch(url, init);
      last = { ok: res.ok, status: res.status, text: await res.text() };
    } catch (err) {
      return { ok: false, status: 0, text: err instanceof Error ? err.message : String(err) };
    }

    if (last.ok || last.status === 401 || last.status === 403) return last;
    if (last.status !== 429 && last.status < 500) return last;

    if (attempt < MAX_ATTEMPTS - 1) {
      const backoffMs = jitterBackoff(attempt, { initialMs: 1000, maxMs: 8000 });
      writeJsonLog(deps, {
        lvl: 'WARN',
        evt: 'ep.broadcast.stop.retry',
        msg: 'Transient error, retrying',
        meetingId,
        status: last.status,
        attempt: attempt + 1,
        backoffMs,
      });
      await deps.sleep(backoffMs);
    }
  }

  return last;
}

export async function stopBroadcasts(
  config: StopBroadcastConfig,
  overrides: Partial<BroadcastDeps> = {}
): Promise<BroadcastRunResult> {
  const deps = { ...defaultDeps(), ...overrides };
  const url = `${config.graphqlBaseUrl}/graphql`;
  const succeeded: number[] = [];
  const failed: number[] = [];

  for (const [i, meetingId] of config.meetingIds.entries()) {
    writeJsonLog(deps, {
      lvl: 'INFO',
      evt: 'ep.broadcast.stop.begin',
      msg: 'Stopping broadcast',
      meetingId,
      context: config.context,
      index: i,
    });

    let eventToken: string;
    try {
      eventToken = await exchangeToken(deps, url, config.bearerToken, meetingId, config.fetchTimeoutMs);
    } catch (err) {
      failed.push(meetingId);
      writeJsonLog(deps, {
        lvl: 'ERROR',
        evt: 'ep.broadcast.stop.token_exchange_failed',
        msg: err instanceof Error ? err.message : String(err),
        meetingId,
      });
      if (i < config.meetingIds.length - 1 && config.delayMs > 0) await deps.sleep(config.delayMs);
      continue;
    }

    const headers = {
      Authorization: `Bearer ${eventToken}`,
      'Content-Type': 'application/json',
    };

    const res = await callStopBroadcast(deps, url, headers, meetingId, config.context, config.fetchTimeoutMs);

    if (!res.ok) {
      failed.push(meetingId);
      const isAuth = res.status === 401 || res.status === 403;
      writeJsonLog(deps, {
        lvl: 'ERROR',
        evt: isAuth ? 'ep.broadcast.stop.unauthorized' : 'ep.broadcast.stop.failed',
        msg: isAuth ? 'Auth rejected; refresh Q4_ADMIN_TOKEN' : 'stopEventBroadcast failed',
        meetingId,
        status: res.status,
        bodyExcerpt: res.text.slice(0, 200),
      });
    } else {
      try {
        const body = parseLabeledJson<BroadcastResponse>(res.text, 'stopEventBroadcast response');
        if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'GraphQL returned errors');
        const result = body.data?.stopEventBroadcast;
        succeeded.push(meetingId);
        writeJsonLog(deps, {
          lvl: 'INFO',
          evt: 'ep.broadcast.stop.success',
          msg: 'Broadcast stopped',
          meetingId,
          status: result?.status,
          context: result?.context,
        });
      } catch (err) {
        failed.push(meetingId);
        writeJsonLog(deps, {
          lvl: 'ERROR',
          evt: 'ep.broadcast.stop.invalid_response',
          msg: err instanceof Error ? err.message : String(err),
          meetingId,
          bodyExcerpt: res.text.slice(0, 200),
        });
      }
    }

    if (i < config.meetingIds.length - 1 && config.delayMs > 0) {
      await deps.sleep(config.delayMs);
    }
  }

  writeJsonLog(deps, {
    lvl: failed.length > 0 ? 'WARN' : 'INFO',
    evt: 'ep.broadcast.stop.complete',
    msg: 'Broadcast stop complete',
    succeeded: succeeded.length,
    failed: failed.length,
    total: config.meetingIds.length,
    failedMeetingIds: failed,
  });

  return { succeeded, failed, total: config.meetingIds.length };
}

async function runCli(): Promise<void> {
  const result = await stopBroadcasts(loadStopConfigFromEnv());
  if (result.failed.length > 0) process.exit(1);
}

function isCliEntry(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(pathResolve(argv1)) === realpathSync(__filename);
  } catch {
    return /stop-broadcast\.[tj]s$/i.test(String(argv1).replace(/\\/g, '/'));
  }
}

if (isCliEntry()) {
  runCli().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    writeJsonLog(
      { log: (record) => process.stdout.write(`${JSON.stringify(record)}\n`) },
      {
        lvl: 'ERROR',
        evt: 'ep.broadcast.stop.fatal',
        msg: message,
        err: err instanceof Error ? { type: err.name, msg: err.message } : { msg: message },
      }
    );
    process.exit(1);
  });
}
