/**
 * End-to-end load test orchestration:
 *
 *  1. create-events     — create meetings, write data/registration-plan.json
 *  2. register-analysts — pre-register analysts, write data/analysts-payload.csv
 *  3. start-events      — transition all meetings NOT_STARTED → STARTED
 *  4. Artillery         — dial-out participants (child process, stdio inherited)
 *     ↳ after DIAL_IN_WAIT_MS:  start-broadcasts (experience composer is ready by then)
 *     ↳ after BROADCAST_DURATION_MS: stop-broadcasts
 *     ↳ await Artillery exit
 *  5. end-events        — transition all meetings STARTED → ENDED  (always runs)
 *
 * Analyst stay time is automatically patched in the Artillery YAML so participants
 * remain connected through the full broadcast window.
 *
 * Key env vars:
 *   ARTILLERY_SCRIPT          path to Artillery YAML  (default: tests/dial-out-payload-example.yml)
 *   DIAL_IN_WAIT_MS           ms after Artillery starts before broadcast begins
 *                             (default: sum of Artillery phase durations + CONNECTION_BUFFER_MS)
 *   CONNECTION_BUFFER_MS      buffer added on top of arrival duration   (default: 90000)
 *   BROADCAST_DURATION_MS     how long to keep broadcast live           (default: 60000)
 *   HANGUP_BUFFER_MS          extra stay time after broadcast ends      (default: 30000)
 *   SKIP_CREATE_EVENTS        set to "1" to skip event creation
 *   SKIP_REGISTER_ANALYSTS    set to "1" to skip analyst registration
 *
 *   Plus all existing vars: Q4_ADMIN_TOKEN, MEETING_IDS / REGISTRATION_PLAN_PATH,
 *   EP_API_GRAPHQL_BASE_URL, LOAD_TEST_SMA_ID, LOAD_TEST_FROM_PHONE, etc.
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve as pathResolve, join as pathJoin } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { createEvents, loadConfigFromEnv as loadCreateEventsConfig } from './create-events';
import { registerAnalysts } from './register-analysts';
import { loadConfigFromEnv as loadRegisterConfig } from './register-analysts-config';
import { startEvents } from './start-event';
import { startBroadcasts } from './start-broadcast';
import { stopBroadcasts } from './stop-broadcast';
import { endEvents } from './end-event';
import { loadStartConfigFromEnv, loadStopConfigFromEnv } from './broadcast-config';
import { writeJsonLog } from './register-analysts-logging';

const log = (record: Record<string, unknown>): void => {
  process.stdout.write(`${JSON.stringify(record)}\n`);
};
const deps = { log };

// ─── types ────────────────────────────────────────────────────────────────────

interface ArtilleryStep {
  think?: number;
  function?: string;
  log?: string;
}

interface ArtilleryYaml {
  config?: {
    phases?: Array<{ duration?: number; arrivalCount?: number; name?: string }>;
  };
  scenarios?: Array<{
    flow?: ArtilleryStep[];
    [key: string]: unknown;
  }>;
}

// ─── config ──────────────────────────────────────────────────────────────────

const DEFAULT_ARTILLERY_SCRIPT = 'tests/dial-out-payload-example.yml';
const DEFAULT_CONNECTION_BUFFER_MS = 90_000;
const DEFAULT_BROADCAST_DURATION_MS = 60_000;
const DEFAULT_HANGUP_BUFFER_MS = 30_000;

// Time spent in fixed thinks before the last one (think:60 + think:60)
const FIXED_THINK_BEFORE_LAST_S = 120;
// Estimated time from dial to CONNECTED
const ESTIMATED_CONNECTION_TIME_S = 60;

function readInt(raw: string | undefined, label: string, defaultVal: number): number {
  if (!raw?.trim()) return defaultVal;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a non-negative integer, got: ${raw}`);
  return n;
}

function parseArtilleryYaml(scriptPath: string): ArtilleryYaml {
  const text = readFileSync(pathResolve(process.cwd(), scriptPath), 'utf8');
  return yaml.load(text) as ArtilleryYaml;
}

function arrivalDurationMs(parsed: ArtilleryYaml): number {
  const phases = parsed.config?.phases ?? [];
  return phases.reduce((sum, p) => sum + (p.duration ?? 0), 0) * 1000;
}

/**
 * Calculate the minimum last-think seconds so participants stay connected
 * through the full broadcast window.
 *
 * From Artillery start, the last participant:
 *   - dials at:       arrivalDurationS
 *   - connects at:    arrivalDurationS + ESTIMATED_CONNECTION_TIME_S
 *   - finishes fixed thinks at: + FIXED_THINK_BEFORE_LAST_S
 *   - must still be connected at: dialInWaitS + broadcastDurationS + hangupBufferS
 *
 * So: required last think = dialInWait + broadcastDuration + hangupBuffer
 *                         - arrivalDuration - connectionTime - fixedThinks
 */
function requiredLastThinkS(
  dialInWaitMs: number,
  broadcastDurationMs: number,
  hangupBufferMs: number,
  arrivalDurMs: number
): number {
  const required =
    dialInWaitMs / 1000 +
    broadcastDurationMs / 1000 +
    hangupBufferMs / 1000 -
    arrivalDurMs / 1000 -
    ESTIMATED_CONNECTION_TIME_S -
    FIXED_THINK_BEFORE_LAST_S;

  return Math.max(30, Math.ceil(required)); // always leave at least 30s
}

/**
 * Patch the last think entry in the first scenario's flow.
 * Returns the patched YAML string, or null if no patch was needed.
 */
function patchedArtilleryYaml(
  parsed: ArtilleryYaml,
  minLastThinkS: number
): string | null {
  const flow = parsed.scenarios?.[0]?.flow;
  if (!flow) return null;

  let lastThinkIndex = -1;
  for (let i = flow.length - 1; i >= 0; i -= 1) {
    if (typeof flow[i].think === 'number') {
      lastThinkIndex = i;
      break;
    }
  }
  if (lastThinkIndex === -1) return null;

  const current = flow[lastThinkIndex].think as number;
  if (minLastThinkS <= current) return null; // already sufficient

  flow[lastThinkIndex] = { think: minLastThinkS };
  return yaml.dump(parsed, { lineWidth: -1 });
}

function loadRunConfig(): {
  artilleryScript: string;
  dialInWaitMs: number;
  broadcastDurationMs: number;
  hangupBufferMs: number;
  skipCreateEvents: boolean;
  skipRegisterAnalysts: boolean;
  parsed: ArtilleryYaml;
} {
  const artilleryScript = process.env.ARTILLERY_SCRIPT?.trim() || DEFAULT_ARTILLERY_SCRIPT;
  const parsed = parseArtilleryYaml(artilleryScript);
  const arrivalMs = arrivalDurationMs(parsed);
  const connectionBufferMs = readInt(process.env.CONNECTION_BUFFER_MS, 'CONNECTION_BUFFER_MS', DEFAULT_CONNECTION_BUFFER_MS);
  const dialInWaitMs = readInt(process.env.DIAL_IN_WAIT_MS, 'DIAL_IN_WAIT_MS', arrivalMs + connectionBufferMs);
  const broadcastDurationMs = readInt(process.env.BROADCAST_DURATION_MS, 'BROADCAST_DURATION_MS', DEFAULT_BROADCAST_DURATION_MS);
  const hangupBufferMs = readInt(process.env.HANGUP_BUFFER_MS, 'HANGUP_BUFFER_MS', DEFAULT_HANGUP_BUFFER_MS);

  return {
    artilleryScript,
    dialInWaitMs,
    broadcastDurationMs,
    hangupBufferMs,
    skipCreateEvents: process.env.SKIP_CREATE_EVENTS === '1',
    skipRegisterAnalysts: process.env.SKIP_REGISTER_ANALYSTS === '1',
    parsed,
  };
}

// ─── artillery child process ──────────────────────────────────────────────────

function spawnArtillery(scriptPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['artillery', 'run', scriptPath], {
      stdio: 'inherit',
      shell: true,
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 0));
  });
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const runConfig = loadRunConfig();

  const arrivalMs = arrivalDurationMs(runConfig.parsed);
  const minLastThinkS = requiredLastThinkS(
    runConfig.dialInWaitMs,
    runConfig.broadcastDurationMs,
    runConfig.hangupBufferMs,
    arrivalMs
  );

  // Patch YAML if participants need to stay longer than the original last think
  let artilleryScript = runConfig.artilleryScript;
  let tempScript: string | null = null;
  const patched = patchedArtilleryYaml(runConfig.parsed, minLastThinkS);
  if (patched) {
    tempScript = pathJoin(tmpdir(), `artillery-patched-${Date.now()}.yml`);
    writeFileSync(tempScript, patched, 'utf8');
    artilleryScript = tempScript;
    writeJsonLog(deps, {
      lvl: 'INFO',
      evt: 'ep.load-test.think-patched',
      msg: `Last think time patched to ${minLastThinkS}s to cover broadcast window`,
      minLastThinkS,
      tempScript,
    });
  }

  writeJsonLog(deps, {
    lvl: 'INFO',
    evt: 'ep.load-test.start',
    msg: 'Load test starting',
    artilleryScript,
    dialInWaitMs: runConfig.dialInWaitMs,
    broadcastDurationMs: runConfig.broadcastDurationMs,
    hangupBufferMs: runConfig.hangupBufferMs,
    minLastThinkS,
    skipCreateEvents: runConfig.skipCreateEvents,
    skipRegisterAnalysts: runConfig.skipRegisterAnalysts,
  });

  try {
    // ── Phase 1: Setup ─────────────────────────────────────────────────────

    if (!runConfig.skipCreateEvents) {
      writeJsonLog(deps, { lvl: 'INFO', evt: 'ep.load-test.phase', msg: 'Phase 1a: Creating events' });
      await createEvents(loadCreateEventsConfig());
    } else {
      writeJsonLog(deps, { lvl: 'INFO', evt: 'ep.load-test.phase', msg: 'Phase 1a: Skipping event creation (SKIP_CREATE_EVENTS=1)' });
    }

    if (!runConfig.skipRegisterAnalysts) {
      writeJsonLog(deps, { lvl: 'INFO', evt: 'ep.load-test.phase', msg: 'Phase 1b: Registering analysts' });
      await registerAnalysts(loadRegisterConfig());
    } else {
      writeJsonLog(deps, { lvl: 'INFO', evt: 'ep.load-test.phase', msg: 'Phase 1b: Skipping analyst registration (SKIP_REGISTER_ANALYSTS=1)' });
    }

    // Reload meeting IDs now that registration-plan.json has been written
    const broadcastConfig = loadStartConfigFromEnv();
    const stopConfig = loadStopConfigFromEnv();

    writeJsonLog(deps, {
      lvl: 'INFO',
      evt: 'ep.load-test.meetings-loaded',
      msg: 'Meeting IDs loaded',
      meetingIds: broadcastConfig.meetingIds,
    });

    // ── Phase 2: Start events ──────────────────────────────────────────────

    writeJsonLog(deps, { lvl: 'INFO', evt: 'ep.load-test.phase', msg: 'Phase 2: Starting events' });
    await startEvents(broadcastConfig);

    // ── Phase 3: Artillery + broadcast lifecycle ───────────────────────────

    writeJsonLog(deps, {
      lvl: 'INFO',
      evt: 'ep.load-test.phase',
      msg: 'Phase 3: Launching Artillery',
      artilleryScript,
    });

    let artilleryExitCode = 0;

    try {
      const artilleryPromise = spawnArtillery(artilleryScript);

      writeJsonLog(deps, {
        lvl: 'INFO',
        evt: 'ep.load-test.dial-in-wait',
        msg: `Waiting ${runConfig.dialInWaitMs}ms for participants to join before starting broadcast`,
        dialInWaitMs: runConfig.dialInWaitMs,
      });
      await new Promise((resolve) => setTimeout(resolve, runConfig.dialInWaitMs));

      writeJsonLog(deps, { lvl: 'INFO', evt: 'ep.load-test.phase', msg: 'Phase 3b: Starting broadcasts' });
      await startBroadcasts({ ...broadcastConfig, preStartWaitMs: 0 });

      writeJsonLog(deps, {
        lvl: 'INFO',
        evt: 'ep.load-test.broadcast-wait',
        msg: `Broadcast live — waiting ${runConfig.broadcastDurationMs}ms before stopping`,
        broadcastDurationMs: runConfig.broadcastDurationMs,
      });
      await new Promise((resolve) => setTimeout(resolve, runConfig.broadcastDurationMs));

      writeJsonLog(deps, { lvl: 'INFO', evt: 'ep.load-test.phase', msg: 'Phase 3c: Stopping broadcasts' });
      await stopBroadcasts(stopConfig);

      writeJsonLog(deps, { lvl: 'INFO', evt: 'ep.load-test.phase', msg: 'Waiting for Artillery to complete' });
      artilleryExitCode = await artilleryPromise;
    } catch (err) {
      writeJsonLog(deps, {
        lvl: 'ERROR',
        evt: 'ep.load-test.phase3.error',
        msg: err instanceof Error ? err.message : String(err),
      });
    }

    // ── Phase 4: End events (always runs) ──────────────────────────────────

    writeJsonLog(deps, { lvl: 'INFO', evt: 'ep.load-test.phase', msg: 'Phase 4: Ending events' });
    await endEvents(broadcastConfig);

    writeJsonLog(deps, {
      lvl: artilleryExitCode === 0 ? 'INFO' : 'WARN',
      evt: 'ep.load-test.complete',
      msg: 'Load test complete',
      artilleryExitCode,
    });

    if (artilleryExitCode !== 0) process.exit(artilleryExitCode);
  } finally {
    if (tempScript) {
      try { unlinkSync(tempScript); } catch { /* ignore */ }
    }
  }
}

run().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  writeJsonLog(deps, {
    lvl: 'ERROR',
    evt: 'ep.load-test.fatal',
    msg: message,
    err: err instanceof Error ? { type: err.name, msg: err.message } : { msg: message },
  });
  process.exit(1);
});
