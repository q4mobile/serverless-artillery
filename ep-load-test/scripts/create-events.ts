import { realpathSync } from 'node:fs';
import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import { dirname, resolve as pathResolve } from 'node:path';
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  loadConfigFromEnv,
} from './create-events-config';
import { buildCreateEventRequestBody } from './create-events-graphql';
import { parseLabeledJson } from './register-analysts-json';
import { writeJsonLog } from './register-analysts-logging';
import { jitterBackoff } from '../lib/backoff.js';
import type { FetchFn } from './register-analysts.types';
import type {
  CreateEventConfig,
  CreateEventDeps,
  CreateEventResponse,
  CreateEventResult,
  EventPlanEntry,
  RegistrationPlanEntry,
} from './create-events.types';

export {
  DEFAULT_EVENTS_PLAN_PATH,
  eventTargetsFromJson,
  loadConfigFromEnv,
  normalizeBaseUrl,
} from './create-events-config';
export { buildCreateEventRequestBody, CREATE_EVENT_MUTATION } from './create-events-graphql';

const FAILURE_THRESHOLD = 0.1;
const MAX_ATTEMPTS = 4;

function defaultFetch(): FetchFn {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('global fetch is required (Node.js 18+)');
  }
  return globalThis.fetch.bind(globalThis) as FetchFn;
}

function defaultDeps(): CreateEventDeps {
  return {
    fetch: defaultFetch(),
    log: (record) => process.stdout.write(`${JSON.stringify(record)}\n`),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    writeFile: (path, data) => fsWriteFile(path, data, 'utf8'),
    mkdir: (path, opts) => fsMkdir(path, opts),
  };
}

function withTimeout(init: RequestInit, timeoutMs: number): RequestInit {
  const timeout = (AbortSignal as typeof AbortSignal & {
    timeout?: (ms: number) => AbortSignal;
  }).timeout;
  return timeoutMs > 0 && timeout ? { ...init, signal: timeout(timeoutMs) } : init;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

async function fetchWithRetry(
  deps: CreateEventDeps,
  url: string,
  init: RequestInit,
  event: EventPlanEntry,
  eventIndex: number,
  timeoutMs: number
): Promise<{ ok: boolean; status: number; text: string }> {
  let last = { ok: false, status: 0, text: '' };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await deps.fetch(url, withTimeout(init, timeoutMs));
      last = { ok: res.ok, status: res.status, text: await res.text() };
    } catch (err) {
      if (!isAbort(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      writeJsonLog(deps, {
        lvl: 'ERROR',
        evt: 'ep.create.event.timeout',
        msg: 'Create event request timed out',
        eventIndex,
        title: event.title,
        err: { type: err instanceof Error ? err.name : 'Error', msg },
      });
      return { ok: false, status: 0, text: msg };
    }

    if (last.ok || last.status === 401 || last.status === 403) return last;
    if (last.status !== 429 && last.status < 500) return last;

    if (attempt < MAX_ATTEMPTS - 1) {
      const backoffMs = jitterBackoff(attempt, { initialMs: 1000, maxMs: 8000 });
      writeJsonLog(deps, {
        lvl: 'WARN',
        evt: 'ep.create.event.retry',
        msg: 'Transient HTTP error, retrying',
        eventIndex,
        title: event.title,
        status: last.status,
        attempt: attempt + 1,
        maxAttempts: MAX_ATTEMPTS,
        backoffMs,
      });
      await deps.sleep(backoffMs);
    }
  }

  return last;
}

function meetingIdFromResponse(text: string): number {
  const body = parseLabeledJson<CreateEventResponse>(text, 'createEvent response');
  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'GraphQL returned errors');
  }
  const meetingId = body.data?.createEvent?.meetingId;
  if (typeof meetingId !== 'number' || !Number.isFinite(meetingId)) {
    throw new Error('createEvent response missing numeric meetingId');
  }
  return meetingId;
}

function registrationPlanEntry(
  event: EventPlanEntry,
  meetingId: number
): RegistrationPlanEntry {
  return {
    meetingId,
    analystCount: event.analystCount,
    ...(event.registrationPassword ? { registrationPassword: event.registrationPassword } : {}),
  };
}

export function serializeRegistrationPlan(rows: RegistrationPlanEntry[]): string {
  return `${JSON.stringify(rows, null, 2)}\n`;
}

export async function createEvents(
  config: CreateEventConfig,
  overrides: Partial<CreateEventDeps> = {}
): Promise<CreateEventResult> {
  if (config.events.length === 0) {
    throw new Error('At least one event is required in config.events');
  }

  const deps = { ...defaultDeps(), ...overrides };
  const url = `${config.graphqlBaseUrl}/graphql`;
  const timeoutMs = config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const created: RegistrationPlanEntry[] = [];
  let failed = 0;

  for (const [eventIndex, event] of config.events.entries()) {
    writeJsonLog(deps, {
      lvl: 'INFO',
      evt: 'ep.create.event.start',
      msg: 'Creating event',
      eventIndex,
      title: event.title,
      eventType: event.eventType ?? config.defaultEventType,
    });

    const res = await fetchWithRetry(
      deps,
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.bearerToken}`,
          'Content-Type': 'application/json',
          'x-company-id': config.companyId,
        },
        body: JSON.stringify(
          buildCreateEventRequestBody(
            event,
            config.companyId,
            config.defaultEventType
          )
        ),
      },
      event,
      eventIndex,
      timeoutMs
    );

    if (!res.ok) {
      failed += 1;
      writeJsonLog(deps, {
        lvl: 'ERROR',
        evt: res.status === 401 || res.status === 403
          ? 'ep.create.event.unauthorized'
          : 'ep.create.event.failed',
        msg: res.status === 401 || res.status === 403
          ? 'Auth rejected; refresh Q4_ADMIN_TOKEN'
          : 'createEvent failed',
        eventIndex,
        title: event.title,
        status: res.status,
        bodyExcerpt: res.text.slice(0, 200),
      });
    } else {
      try {
        const meetingId = meetingIdFromResponse(res.text);
        created.push(registrationPlanEntry(event, meetingId));
        writeJsonLog(deps, {
          lvl: 'INFO',
          evt: 'ep.create.event.success',
          msg: 'Event created',
          eventIndex,
          title: event.title,
          meetingId,
        });
      } catch (err) {
        failed += 1;
        writeJsonLog(deps, {
          lvl: 'ERROR',
          evt: 'ep.create.event.invalid_response',
          msg: err instanceof Error ? err.message : String(err),
          eventIndex,
          title: event.title,
          bodyExcerpt: res.text.slice(0, 200),
        });
      }
    }

    if (eventIndex < config.events.length - 1 && config.delayMs > 0) {
      await deps.sleep(config.delayMs);
    }
  }

  if (failed / config.events.length > FAILURE_THRESHOLD) {
    throw new Error(
      `Event creation failure rate ${((failed / config.events.length) * 100).toFixed(1)}% exceeds 10% threshold (${failed} of ${config.events.length} failed)`
    );
  }

  await deps.mkdir(dirname(config.outputPath), { recursive: true });
  await deps.writeFile(config.outputPath, serializeRegistrationPlan(created));
  writeJsonLog(deps, {
    lvl: 'INFO',
    evt: 'ep.create.events.complete',
    msg: 'Wrote registration plan JSON',
    outputPath: config.outputPath,
    createdCount: created.length,
    failed,
    total: config.events.length,
    meetingIds: created.map((event) => event.meetingId),
  });

  return { created, failed, total: config.events.length };
}

async function runCli(): Promise<void> {
  await createEvents(loadConfigFromEnv());
}

function isCliEntry(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(pathResolve(argv1)) === realpathSync(__filename);
  } catch {
    return /create-events\.[tj]s$/i.test(String(argv1).replace(/\\/g, '/'));
  }
}

if (isCliEntry()) {
  runCli().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    writeJsonLog(
      { log: (record) => process.stdout.write(`${JSON.stringify(record)}\n`) },
      {
        lvl: 'ERROR',
        evt: 'ep.create.events.fatal',
        msg: message,
        err: err instanceof Error ? { type: err.name, msg: err.message } : { msg: message },
      }
    );
    process.exit(1);
  });
}
