import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { parseLabeledJson } from './register-analysts-json';
import type { BroadcastConfig, BroadcastContextEnum, StopBroadcastConfig } from './broadcast.types';

const DEFAULT_GRAPHQL_BASE_URL = 'https://dev.events.q4inc.com';
const DEFAULT_DELAY_MS = 500;
const DEFAULT_FETCH_TIMEOUT_MS = 0;
const DEFAULT_PRE_START_WAIT_MS = 15000;
const DEFAULT_REGISTRATION_PLAN_PATH = 'data/registration-plan.json';
const VALID_CONTEXTS: BroadcastContextEnum[] = ['NONE', 'PAUSED', 'FINALIZED'];

function readNonNegativeInt(
  raw: string | undefined,
  label: string,
  defaultVal: number
): number {
  if (raw === undefined || raw.trim() === '') return defaultVal;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer, got: ${raw}`);
  }
  return n;
}

function readMeetingIdsFromPlan(planPath: string): number[] {
  const abs = pathResolve(process.cwd(), planPath);
  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to read registration plan (${abs}): ${msg}`);
  }
  const rows = parseLabeledJson<Array<{ meetingId?: unknown }>>(text, abs);
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${abs}: expected a non-empty JSON array`);
  }
  return rows.map((row, i) => {
    const id = Number(row.meetingId);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`${abs}: entry ${i} has missing or invalid meetingId`);
    }
    return id;
  });
}

function resolveMeetingIds(env: NodeJS.ProcessEnv): number[] {
  const raw = env.MEETING_IDS?.trim();
  if (raw) {
    return raw.split(',').map((s, i) => {
      const id = Number(s.trim());
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(`MEETING_IDS: entry ${i} is not a valid meeting id: ${s}`);
      }
      return id;
    });
  }
  const planPath = env.REGISTRATION_PLAN_PATH?.trim() || DEFAULT_REGISTRATION_PLAN_PATH;
  return readMeetingIdsFromPlan(planPath);
}

export function loadStartConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): BroadcastConfig {
  const bearerToken = env.Q4_ADMIN_TOKEN?.trim();
  if (!bearerToken) {
    throw new Error(
      'Q4_ADMIN_TOKEN is required (admin platform JWT from browser localStorage)'
    );
  }
  return {
    graphqlBaseUrl: (env.EP_API_GRAPHQL_BASE_URL?.trim() || DEFAULT_GRAPHQL_BASE_URL).replace(/\/+$/, ''),
    bearerToken,
    meetingIds: resolveMeetingIds(env),
    delayMs: readNonNegativeInt(env.BROADCAST_DELAY_MS, 'BROADCAST_DELAY_MS', DEFAULT_DELAY_MS),
    fetchTimeoutMs: readNonNegativeInt(env.BROADCAST_FETCH_TIMEOUT_MS, 'BROADCAST_FETCH_TIMEOUT_MS', DEFAULT_FETCH_TIMEOUT_MS),
    preStartWaitMs: readNonNegativeInt(env.BROADCAST_PRE_START_WAIT_MS, 'BROADCAST_PRE_START_WAIT_MS', DEFAULT_PRE_START_WAIT_MS),
  };
}

export function loadStopConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): StopBroadcastConfig {
  const base = loadStartConfigFromEnv(env);
  const rawContext = env.BROADCAST_STOP_CONTEXT?.trim().toUpperCase() as BroadcastContextEnum | undefined;
  const context: BroadcastContextEnum =
    rawContext && VALID_CONTEXTS.includes(rawContext) ? rawContext : 'FINALIZED';
  return { ...base, context };
}
