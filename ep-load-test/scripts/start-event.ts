import { realpathSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { loadStartConfigFromEnv } from './broadcast-config';
import { buildStartEventBody } from './event-status-graphql';
import { writeJsonLog } from './register-analysts-logging';
import { parseLabeledJson } from './register-analysts-json';
import { jitterBackoff } from '../lib/backoff.js';
import type { BroadcastConfig, BroadcastDeps, BroadcastRunResult } from './broadcast.types';
import type { FetchFn } from './register-analysts.types';

const MAX_ATTEMPTS = 3;

interface EventStatusResponse {
  data?: {
    startEvent?: { meetingId?: number; title?: string; status?: string } | null;
  };
  errors?: Array<{ message?: string }>;
}

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

async function callStartEvent(
  deps: BroadcastDeps,
  url: string,
  headers: Record<string, string>,
  meetingId: number,
  fetchTimeoutMs: number
): Promise<{ ok: boolean; status: number; text: string }> {
  const body = JSON.stringify(buildStartEventBody(meetingId));
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
        evt: 'ep.event.start.retry',
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

export async function startEvents(
  config: BroadcastConfig,
  overrides: Partial<BroadcastDeps> = {}
): Promise<BroadcastRunResult> {
  const deps = { ...defaultDeps(), ...overrides };
  const url = `${config.graphqlBaseUrl}/graphql`;
  const headers = {
    Authorization: `Bearer ${config.bearerToken}`,
    'Content-Type': 'application/json',
  };
  const succeeded: number[] = [];
  const failed: number[] = [];

  for (const [i, meetingId] of config.meetingIds.entries()) {
    writeJsonLog(deps, {
      lvl: 'INFO',
      evt: 'ep.event.start.begin',
      msg: 'Starting event',
      meetingId,
      index: i,
    });

    const res = await callStartEvent(deps, url, headers, meetingId, config.fetchTimeoutMs);

    if (!res.ok) {
      failed.push(meetingId);
      const isAuth = res.status === 401 || res.status === 403;
      writeJsonLog(deps, {
        lvl: 'ERROR',
        evt: isAuth ? 'ep.event.start.unauthorized' : 'ep.event.start.failed',
        msg: isAuth ? 'Auth rejected; refresh Q4_ADMIN_TOKEN' : 'startEvent failed',
        meetingId,
        status: res.status,
        bodyExcerpt: res.text.slice(0, 200),
      });
    } else {
      try {
        const body = parseLabeledJson<EventStatusResponse>(res.text, 'startEvent response');
        if (body.errors?.length) throw new Error(body.errors[0]?.message ?? 'GraphQL returned errors');
        const result = body.data?.startEvent;
        succeeded.push(meetingId);
        writeJsonLog(deps, {
          lvl: 'INFO',
          evt: 'ep.event.start.success',
          msg: 'Event started',
          meetingId,
          title: result?.title,
          status: result?.status,
        });
      } catch (err) {
        failed.push(meetingId);
        writeJsonLog(deps, {
          lvl: 'ERROR',
          evt: 'ep.event.start.invalid_response',
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
    evt: 'ep.event.start.complete',
    msg: 'Event start complete',
    succeeded: succeeded.length,
    failed: failed.length,
    total: config.meetingIds.length,
    failedMeetingIds: failed,
  });

  return { succeeded, failed, total: config.meetingIds.length };
}

async function runCli(): Promise<void> {
  const result = await startEvents(loadStartConfigFromEnv());
  if (result.failed.length > 0) process.exit(1);
}

function isCliEntry(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(pathResolve(argv1)) === realpathSync(__filename);
  } catch {
    return /start-event\.[tj]s$/i.test(String(argv1).replace(/\\/g, '/'));
  }
}

if (isCliEntry()) {
  runCli().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    writeJsonLog(
      { log: (record) => process.stdout.write(`${JSON.stringify(record)}\n`) },
      {
        lvl: 'ERROR',
        evt: 'ep.event.start.fatal',
        msg: message,
        err: err instanceof Error ? { type: err.name, msg: err.message } : { msg: message },
      }
    );
    process.exit(1);
  });
}
