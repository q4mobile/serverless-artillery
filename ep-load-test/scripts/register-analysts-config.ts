import { existsSync, readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { isPlainObject } from 'es-toolkit/predicate';
import { parseLabeledJson } from './register-analysts-json';
import type { MeetingRegistrationTarget, RegistrationConfig } from './register-analysts.types';

const DEFAULT_BASE_URL = 'https://attendees.dev.events.q4inc.com/rest/v1';
const DEFAULT_ANALYST_COUNT = 225;
const DEFAULT_DELAY_MS = 50;
/** `0` = no timeout; Node 18+ uses `AbortSignal.timeout`. */
export const DEFAULT_FETCH_TIMEOUT_MS = 0;
const DEFAULT_OUTPUT_PATH = 'data/analysts-payload.csv';
/** Used when `REGISTRATION_PLAN_PATH` is unset and this file exists under `process.cwd()`. */
export const DEFAULT_REGISTRATION_PLAN_PATH = 'data/registration-plan.json';

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function readPositiveInt(
  raw: string | undefined,
  label: string,
  defaultVal: number
): number {
  if (raw === undefined || raw.trim() === '') {
    return defaultVal;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`${label} must be a positive integer, got: ${raw}`);
  }
  return n;
}

function readNonNegativeInt(
  raw: string | undefined,
  label: string,
  defaultVal: number,
  hint?: string
): number {
  if (raw === undefined || raw.trim() === '') {
    return defaultVal;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    const suffix = hint ? ` (${hint})` : '';
    throw new Error(
      `${label} must be a non-negative integer${suffix}, got: ${raw}`
    );
  }
  return n;
}

/** Strict non-negative integer string (no leading +, no decimals, no trailing junk). */
export function meetingIdFromString(token: string, label: string): number {
  const t = token.trim();
  if (!/^(0|[1-9]\d*)$/.test(t)) {
    throw new Error(
      `${label} must contain non-negative integer meeting ids, invalid token: ${token}`
    );
  }
  const id = Number(t);
  if (!Number.isSafeInteger(id)) {
    throw new Error(`${label} meeting id out of safe integer range: ${token}`);
  }
  return id;
}

/**
 * Parse registration plan JSON: either `[{ "meetingId", "analystCount", ... }]` or
 * `{ "meetings": [ ... ] }`.
 */
export function registrationTargetsFromJson(
  text: string,
  label = 'Registration plan'
): MeetingRegistrationTarget[] {
  const parsed: unknown = parseLabeledJson(text, label);
  const rows: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        parsed !== null &&
        Array.isArray((parsed as { meetings?: unknown }).meetings)
      ? ((parsed as { meetings: unknown[] }).meetings as unknown[])
      : (() => {
          throw new Error(
            `${label}: expected a JSON array or an object with a "meetings" array`
          );
        })();

  if (rows.length === 0) {
    throw new Error(`${label}: at least one meeting entry is required`);
  }

  return rows.map((row, index) => {
    if (!isPlainObject(row)) {
      throw new Error(`${label}: entry ${index} must be an object`);
    }
    const o = row as Record<string, unknown>;
    const meetingId = Number(o.meetingId);
    const analystCount = Number(o.analystCount);
    if (!Number.isFinite(meetingId)) {
      throw new Error(`${label}: entry ${index} missing or invalid meetingId`);
    }
    if (!Number.isFinite(analystCount) || analystCount < 1) {
      throw new Error(
        `${label}: entry ${index} missing or invalid analystCount (must be >= 1)`
      );
    }
    const pw = o.registrationPassword;
    const registrationPassword =
      typeof pw === 'string' && pw.length > 0 ? pw : undefined;
    return {
      meetingId,
      analystCount,
      ...(registrationPassword ? { registrationPassword } : {}),
    };
  });
}

function readMeetingsFromPlanPath(
  relativeOrAbsolutePath: string
): MeetingRegistrationTarget[] {
  const abs = pathResolve(process.cwd(), relativeOrAbsolutePath);
  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to read registration plan file (${abs}): ${msg}`);
  }
  return registrationTargetsFromJson(text, abs);
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RegistrationConfig {
  const baseUrl = normalizeBaseUrl(
    env.EP_API_BASE_URL?.trim() || DEFAULT_BASE_URL
  );

  const delayMs = readNonNegativeInt(
    env.REGISTRATION_DELAY_MS,
    'REGISTRATION_DELAY_MS',
    DEFAULT_DELAY_MS
  );

  const fetchTimeoutMs = readNonNegativeInt(
    env.REGISTRATION_FETCH_TIMEOUT_MS,
    'REGISTRATION_FETCH_TIMEOUT_MS',
    DEFAULT_FETCH_TIMEOUT_MS,
    '0 = disabled'
  );

  const registrationPassword = env.ANALYST_REGISTRATION_PASSWORD?.trim();
  const outputPath = env.OUTPUT_PATH?.trim() || DEFAULT_OUTPUT_PATH;

  const planPathExplicit = env.REGISTRATION_PLAN_PATH?.trim();
  const meetingIdsRaw = env.MEETING_IDS?.trim();
  const meetingIdSingle = env.MEETING_ID?.trim();

  const sourceCount =
    Number(Boolean(meetingIdSingle)) +
    Number(Boolean(meetingIdsRaw)) +
    Number(Boolean(planPathExplicit));
  if (sourceCount > 1) {
    throw new Error(
      'Conflicting meeting sources: set only one of MEETING_ID, MEETING_IDS, or REGISTRATION_PLAN_PATH'
    );
  }

  let meetings: MeetingRegistrationTarget[];

  if (meetingIdSingle) {
    const meetingId = meetingIdFromString(meetingIdSingle, 'MEETING_ID');
    const analystCount = readPositiveInt(
      env.ANALYST_COUNT,
      'ANALYST_COUNT',
      DEFAULT_ANALYST_COUNT
    );
    meetings = [{ meetingId, analystCount }];
  } else if (meetingIdsRaw) {
    const ids = meetingIdsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) {
      throw new Error('MEETING_IDS is non-empty but contains no valid ids');
    }
    const perMeeting = readPositiveInt(
      env.ANALYST_COUNT_PER_MEETING,
      'ANALYST_COUNT_PER_MEETING',
      readPositiveInt(
        env.ANALYST_COUNT,
        'ANALYST_COUNT',
        DEFAULT_ANALYST_COUNT
      )
    );
    meetings = ids.map((t) => ({
      meetingId: meetingIdFromString(t, 'MEETING_IDS'),
      analystCount: perMeeting,
    }));
  } else if (planPathExplicit) {
    meetings = readMeetingsFromPlanPath(planPathExplicit);
  } else {
    const defaultAbs = pathResolve(
      process.cwd(),
      DEFAULT_REGISTRATION_PLAN_PATH
    );
    if (existsSync(defaultAbs)) {
      meetings = readMeetingsFromPlanPath(DEFAULT_REGISTRATION_PLAN_PATH);
    } else {
      throw new Error(
        `Set MEETING_ID, MEETING_IDS, REGISTRATION_PLAN_PATH, or create ${DEFAULT_REGISTRATION_PLAN_PATH} (see data/registration-plan.example.json)`
      );
    }
  }

  return {
    baseUrl,
    meetings,
    ...(registrationPassword ? { defaultRegistrationPassword: registrationPassword } : {}),
    fetchTimeoutMs,
    delayMs,
    outputPath,
  };
}
