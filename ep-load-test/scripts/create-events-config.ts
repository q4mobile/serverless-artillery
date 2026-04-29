import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { isPlainObject } from 'es-toolkit/predicate';
import { parseLabeledJson } from './register-analysts-json';
import type { CreateEventConfig, EventPlanEntry } from './create-events.types';

const DEFAULT_GRAPHQL_BASE_URL = 'https://dev.events.q4inc.com';
const DEFAULT_COMPANY_ID = '6406198668c0aa6df0fb1406';
const DEFAULT_DELAY_MS = 100;
export const DEFAULT_FETCH_TIMEOUT_MS = 0;
const DEFAULT_OUTPUT_PATH = 'data/registration-plan.json';
export const DEFAULT_EVENTS_PLAN_PATH = 'data/events-plan.json';
const DEFAULT_EVENT_TYPE = 'earnings';

export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
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

function readIsoStringIfPresent(
  value: unknown,
  label: string
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty ISO-8601 string`);
  }
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} is not a valid ISO-8601 date: ${value}`);
  }
  return value;
}

export function eventTargetsFromJson(
  text: string,
  label = 'Events plan'
): EventPlanEntry[] {
  const parsed: unknown = parseLabeledJson(text, label);
  let rows: unknown[];

  if (Array.isArray(parsed)) {
    rows = parsed;
  } else if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { events?: unknown }).events)
  ) {
    rows = (parsed as { events: unknown[] }).events;
  } else {
    throw new Error(
      `${label}: expected a JSON array or an object with an "events" array`
    );
  }

  if (rows.length === 0) {
    throw new Error(`${label}: at least one event entry is required`);
  }

  return rows.map((row, index): EventPlanEntry => {
    if (!isPlainObject(row)) {
      throw new Error(`${label}: entry ${index} must be an object`);
    }
    const o = row as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    if (!title) {
      throw new Error(`${label}: entry ${index} missing or empty title`);
    }
    const analystCount = Number(o.analystCount);
    if (!Number.isInteger(analystCount) || analystCount < 1) {
      throw new Error(
        `${label}: entry ${index} missing or invalid analystCount (must be integer >= 1)`
      );
    }
    const eventStart = readIsoStringIfPresent(
      o.eventStart,
      `${label}: entry ${index} eventStart`
    );
    const eventEnd = readIsoStringIfPresent(
      o.eventEnd,
      `${label}: entry ${index} eventEnd`
    );
    const eventTypeRaw = o.eventType;
    let eventType: string | undefined;
    if (eventTypeRaw !== undefined && eventTypeRaw !== null) {
      if (typeof eventTypeRaw !== 'string' || eventTypeRaw.trim() === '') {
        throw new Error(
          `${label}: entry ${index} eventType must be a non-empty string`
        );
      }
      eventType = eventTypeRaw.trim();
    }
    const pw = o.registrationPassword;
    const registrationPassword =
      typeof pw === 'string' && pw.length > 0 ? pw : undefined;

    return {
      title,
      analystCount,
      ...(eventType ? { eventType } : {}),
      ...(eventStart ? { eventStart } : {}),
      ...(eventEnd ? { eventEnd } : {}),
      ...(registrationPassword ? { registrationPassword } : {}),
    };
  });
}

function readEventsFromPlanPath(
  relativeOrAbsolutePath: string
): EventPlanEntry[] {
  const abs = pathResolve(process.cwd(), relativeOrAbsolutePath);
  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to read events plan file (${abs}): ${msg}`);
  }
  return eventTargetsFromJson(text, abs);
}

export function loadConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): CreateEventConfig {
  const bearerToken = env.Q4_ADMIN_TOKEN?.trim();
  if (!bearerToken) {
    throw new Error(
      'Q4_ADMIN_TOKEN is required (paste a fresh admin platform JWT from your browser localStorage; tokens expire ~1h)'
    );
  }

  const graphqlBaseUrl = normalizeBaseUrl(
    env.EP_API_GRAPHQL_BASE_URL?.trim() || DEFAULT_GRAPHQL_BASE_URL
  );
  const companyId = env.EP_COMPANY_ID?.trim() || DEFAULT_COMPANY_ID;
  const defaultEventType =
    env.CREATE_EVENT_DEFAULT_TYPE?.trim() || DEFAULT_EVENT_TYPE;

  const delayMs = readNonNegativeInt(
    env.CREATE_EVENT_DELAY_MS,
    'CREATE_EVENT_DELAY_MS',
    DEFAULT_DELAY_MS
  );
  const fetchTimeoutMs = readNonNegativeInt(
    env.CREATE_EVENT_FETCH_TIMEOUT_MS,
    'CREATE_EVENT_FETCH_TIMEOUT_MS',
    DEFAULT_FETCH_TIMEOUT_MS,
    '0 = disabled'
  );

  const outputPath =
    env.REGISTRATION_PLAN_OUTPUT_PATH?.trim() || DEFAULT_OUTPUT_PATH;
  const planPath = env.EVENTS_PLAN_PATH?.trim() || DEFAULT_EVENTS_PLAN_PATH;

  const events = readEventsFromPlanPath(planPath);

  return {
    graphqlBaseUrl,
    companyId,
    bearerToken,
    events,
    defaultEventType,
    outputPath,
    delayMs,
    fetchTimeoutMs,
  };
}
