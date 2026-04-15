import { realpathSync } from 'node:fs';
import { dirname, resolve as pathResolve } from 'node:path';
import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import { faker } from '@faker-js/faker';
import { v4 as uuidv4 } from 'uuid';
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  loadConfigFromEnv,
} from './register-analysts-config';
import { stripUndefined, writeJsonLog } from './register-analysts-logging';
import { parseLabeledJson } from './register-analysts-json';
import { jitterBackoff } from '../lib/backoff.js';
import type {
  AnalystPayloadRecord,
  EpRegistrationResponse,
  FetchFn,
  MeetingRegistrationTarget,
  RegisterAnalystsDeps,
  RegisterAnalystsResult,
  RegistrationConfig,
  TokenResponse,
} from './register-analysts.types';

export {
  DEFAULT_REGISTRATION_PLAN_PATH,
  loadConfigFromEnv,
  meetingIdFromString,
  normalizeBaseUrl,
  registrationTargetsFromJson,
} from './register-analysts-config';

const FAILURE_THRESHOLD = 0.1;
const INITIAL_TRANSIENT_BACKOFF_MS = 1000;
const MAX_TRANSIENT_BACKOFF_MS = 8000;
const MAX_ATTEMPTS = 4;

/** Redact PIN for logs: last two digits only, e.g. `****16`. Shorter PINs fully masked. */
export function redactPin(pin: string): string {
  if (pin.length >= 2) {
    return `****${pin.slice(-2)}`;
  }
  return '****';
}

/** Escape a field for CSV (RFC-style quoting when needed). */
export function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Artillery 1.x payload CSV: data rows only, no header; column order matches config.payload.fields.
 */
export function serializeAnalystsCsv(rows: AnalystPayloadRecord[]): string {
  if (rows.length === 0) {
    return '';
  }
  const lines = rows.map((r) =>
    [
      escapeCsvField(r.attendeeId),
      escapeCsvField(r.pin),
      escapeCsvField(r.email),
      escapeCsvField(String(r.meetingId)),
    ].join(',')
  );
  return `${lines.join('\n')}\n`;
}

function defaultLog(record: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function getDefaultFetch(): FetchFn {
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('global fetch is required (Node.js 18+)');
  }
  return globalThis.fetch.bind(globalThis) as FetchFn;
}

function defaultDeps(): RegisterAnalystsDeps {
  return {
    fetch: getDefaultFetch(),
    log: defaultLog,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    writeFile: (path, data) => fsWriteFile(path, data, 'utf8'),
    mkdir: (path, opts) => fsMkdir(path, opts),
  };
}

export interface AnalystIdentity {
  firstName: string;
  lastName: string;
  email: string;
  wsConnectionId: string;
}

/**
 * Realistic-looking analyst profile for load registration. Email is always under
 * `loadtest.q4inc.com` with a short UUID suffix so addresses stay unique for the API.
 */
export function generateAnalystIdentity(): AnalystIdentity {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const handle = faker.internet
    .username({ firstName, lastName })
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 48);
  const suffix = uuidv4().replace(/-/g, '').slice(0, 10);
  const local = `${handle || 'analyst'}.${suffix}`;
  const email = `${local}@loadtest.q4inc.com`.toLowerCase();
  return {
    firstName,
    lastName,
    email,
    wsConnectionId: uuidv4(),
  };
}

function buildAttendeeBody(
  meetingId: number,
  registrationPassword: string | undefined,
  identity: AnalystIdentity
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    meetingId,
    email: identity.email,
    firstName: identity.firstName,
    lastName: identity.lastName,
    attendeeType: 'ANALYST',
    wsConnectionId: identity.wsConnectionId,
    registrationType: 'LOBBY',
    type: 'Q4_LOGIN',
    investorType: 'individual',
    sendReminderEmail: false,
  };
  if (registrationPassword !== undefined) {
    body.analystRegistrationPassword = registrationPassword;
  }
  return body;
}

/** Request body safe to log (password stripped). */
export function sanitizeBodyForLog(body: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...body };
  if ('analystRegistrationPassword' in copy) {
    copy.analystRegistrationPassword = '[REDACTED]';
  }
  return copy;
}

/** True when the API body explicitly reports failure (`success: false`). */
export function responseIndicatesFailure(body: unknown): boolean {
  if (typeof body !== 'object' || body === null || !('success' in body)) {
    return false;
  }
  return (body as { success: unknown }).success === false;
}

function requestInitWithTimeout(
  init: RequestInit | undefined,
  timeoutMs: number
): RequestInit | undefined {
  if (timeoutMs <= 0) {
    return init;
  }
  const AS = AbortSignal as typeof AbortSignal & {
    timeout?: (ms: number) => AbortSignal;
  };
  if (typeof AS.timeout !== 'function') {
    return init;
  }
  return { ...init, signal: AS.timeout(timeoutMs) };
}

function isTimeoutOrAbort(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === 'AbortError' || e.name === 'TimeoutError')
  );
}

async function pauseBetweenAnalystsIfNeeded(
  deps: RegisterAnalystsDeps,
  config: RegistrationConfig,
  meetingIndex: number,
  analystIndex: number,
  meeting: MeetingRegistrationTarget
): Promise<void> {
  const isLastInMeeting = analystIndex === meeting.analystCount - 1;
  const isLastMeeting = meetingIndex === config.meetings.length - 1;
  if ((!isLastInMeeting || !isLastMeeting) && config.delayMs > 0) {
    await deps.sleep(config.delayMs);
  }
}

async function fetchWithRetry(
  deps: RegisterAnalystsDeps,
  url: string,
  init: RequestInit | undefined,
  context: { meetingId: number; analystIndex?: number; phase: string },
  timeoutMs: number
): Promise<{ ok: boolean; status: number; bodyText: string }> {
  let lastStatus = 0;
  let lastBody = '';
  const mergedInit = requestInitWithTimeout(init, timeoutMs);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await deps.fetch(url, mergedInit);
    } catch (e) {
      if (isTimeoutOrAbort(e)) {
        const msg = e instanceof Error ? e.message : String(e);
        writeJsonLog(deps, {
          lvl: 'ERROR',
          evt: 'ep.register.fetch.timeout',
          msg: 'Fetch aborted (timeout or user abort)',
          ...stripUndefined({
            meetingId: context.meetingId,
            analystIndex: context.analystIndex,
            phase: context.phase,
            err: {
              type: e instanceof Error ? e.name : 'Error',
              msg,
            },
          }),
        });
        return { ok: false, status: 0, bodyText: msg };
      }
      throw e;
    }
    lastStatus = res.status;
    lastBody = await res.text();
    if (res.ok) {
      return { ok: true, status: res.status, bodyText: lastBody };
    }
    const transient = res.status === 429 || res.status >= 500;
    if (!transient) {
      return { ok: false, status: res.status, bodyText: lastBody };
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      const backoffMs = jitterBackoff(attempt, {
        initialMs: INITIAL_TRANSIENT_BACKOFF_MS,
        maxMs: MAX_TRANSIENT_BACKOFF_MS,
      });
      writeJsonLog(deps, {
        lvl: 'WARN',
        evt: 'ep.register.retry',
        msg: 'Transient HTTP error, retrying',
        ...stripUndefined({
          meetingId: context.meetingId,
          analystIndex: context.analystIndex,
          phase: context.phase,
          status: res.status,
          attempt: attempt + 1,
          maxAttempts: MAX_ATTEMPTS,
          backoffMs,
        }),
      });
      await deps.sleep(backoffMs);
    }
  }
  return { ok: false, status: lastStatus, bodyText: lastBody };
}

export async function registerAnalysts(
  config: RegistrationConfig,
  partialDeps?: Partial<RegisterAnalystsDeps>
): Promise<RegisterAnalystsResult> {
  if (config.meetings.length === 0) {
    throw new Error('At least one meeting is required in config.meetings');
  }
  const deps: RegisterAnalystsDeps = { ...defaultDeps(), ...partialDeps };
  const registered: AnalystPayloadRecord[] = [];
  let failed = 0;
  const total = config.meetings.reduce((s, m) => s + m.analystCount, 0);
  const attendeeUrl = `${config.baseUrl}/attendee`;
  const timeoutMs = config.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  for (
    let meetingIndex = 0;
    meetingIndex < config.meetings.length;
    meetingIndex += 1
  ) {
    const target = config.meetings[meetingIndex];
    const meetingPassword =
      target.registrationPassword ?? config.defaultRegistrationPassword;

    const tokenUrl = `${config.baseUrl}/auth/token/${target.meetingId}`;
    const tokenRes = await fetchWithRetry(
      deps,
      tokenUrl,
      undefined,
      { meetingId: target.meetingId, phase: 'auth_token' },
      timeoutMs
    );
    if (!tokenRes.ok) {
      throw new Error(
        `Failed to obtain auth token for meetingId ${target.meetingId}: HTTP ${tokenRes.status} ${tokenRes.bodyText.slice(0, 200)}`
      );
    }
    const tokenJson = parseLabeledJson<TokenResponse>(tokenRes.bodyText, 'Token response');
    if (responseIndicatesFailure(tokenJson)) {
      throw new Error(
        `Token API returned success:false for meetingId ${target.meetingId}: ${tokenRes.bodyText.slice(0, 200)}`
      );
    }
    const token = tokenJson.data?.token;
    if (!token) {
      throw new Error(
        `Token response missing data.token for meetingId ${target.meetingId}`
      );
    }

    for (let analystIndex = 0; analystIndex < target.analystCount; analystIndex++) {
      const identity = generateAnalystIdentity();
      const { email } = identity;
      const body = buildAttendeeBody(
        target.meetingId,
        meetingPassword,
        identity
      );

      const postRes = await fetchWithRetry(
        deps,
        attendeeUrl,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
        {
          meetingId: target.meetingId,
          analystIndex,
          phase: 'register_attendee',
        },
        timeoutMs
      );

      if (!postRes.ok) {
        if (postRes.status === 400 || postRes.status === 409) {
          writeJsonLog(deps, {
            lvl: 'WARN',
            evt: 'ep.register.attendee.skipped',
            msg: 'Registration skipped for analyst',
            meetingId: target.meetingId,
            analystIndex,
            status: postRes.status,
            request: sanitizeBodyForLog(body),
          });
          failed += 1;
        } else {
          writeJsonLog(deps, {
            lvl: 'ERROR',
            evt: 'ep.register.attendee.failed',
            msg: 'Registration failed after retries',
            meetingId: target.meetingId,
            analystIndex,
            status: postRes.status,
            request: sanitizeBodyForLog(body),
          });
          failed += 1;
        }
      } else {
        const regJson = parseLabeledJson<EpRegistrationResponse>(
          postRes.bodyText,
          'Registration response'
        );
        if (responseIndicatesFailure(regJson)) {
          writeJsonLog(deps, {
            lvl: 'ERROR',
            evt: 'ep.register.attendee.api_failure',
            msg: 'HTTP 200 but API body success:false',
            meetingId: target.meetingId,
            analystIndex,
            request: sanitizeBodyForLog(body),
          });
          failed += 1;
          await pauseBetweenAnalystsIfNeeded(
            deps,
            config,
            meetingIndex,
            analystIndex,
            target
          );
          continue;
        }
        const attendeeId = regJson.data?.id;
        const pin = regJson.data?.conferenceDetails?.analystPin;
        if (!attendeeId || !pin) {
          writeJsonLog(deps, {
            lvl: 'ERROR',
            evt: 'ep.register.attendee.invalid_response',
            msg: 'Success HTTP but missing id or analystPin',
            meetingId: target.meetingId,
            analystIndex,
            request: sanitizeBodyForLog(body),
          });
          failed += 1;
        } else {
          registered.push({
            attendeeId,
            pin,
            email,
            meetingId: target.meetingId,
          });
          writeJsonLog(deps, {
            lvl: 'INFO',
            evt: 'ep.register.attendee.success',
            msg: 'Analyst registered',
            meetingId: target.meetingId,
            analystIndex,
            attendeeId,
            email,
            pinRedacted: redactPin(pin),
          });
        }
      }

      await pauseBetweenAnalystsIfNeeded(
        deps,
        config,
        meetingIndex,
        analystIndex,
        target
      );
    }
  }

  const failureRate = failed / total;
  if (failureRate > FAILURE_THRESHOLD) {
    throw new Error(
      `Registration failure rate ${(failureRate * 100).toFixed(1)}% exceeds 10% threshold (${failed} of ${total} failed)`
    );
  }

  const outDir = dirname(config.outputPath);
  await deps.mkdir(outDir, { recursive: true });
  await deps.writeFile(config.outputPath, serializeAnalystsCsv(registered));

  writeJsonLog(deps, {
    lvl: 'INFO',
    evt: 'ep.register.complete',
    msg: 'Wrote Artillery payload CSV',
    meetingIds: config.meetings.map((m) => m.meetingId),
    meetingCount: config.meetings.length,
    outputPath: config.outputPath,
    registeredCount: registered.length,
    failed,
    total,
  });

  return { registered, failed, total };
}

async function runCli(): Promise<void> {
  const config = loadConfigFromEnv();
  await registerAnalysts(config);
}

function isRegisterAnalystsCliEntry(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) {
    return false;
  }
  try {
    const entry = realpathSync(pathResolve(argv1));
    const self = realpathSync(__filename);
    return entry === self;
  } catch {
    return /register-analysts\.[tj]s$/i.test(
      String(argv1).replace(/\\/g, '/')
    );
  }
}

if (isRegisterAnalystsCliEntry()) {
  runCli().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    writeJsonLog(
      { log: defaultLog },
      {
        lvl: 'ERROR',
        evt: 'ep.register.fatal',
        msg: message,
        err:
          err instanceof Error
            ? { type: err.name, msg: err.message }
            : { msg: String(err) },
      }
    );
    process.exit(1);
  });
}
