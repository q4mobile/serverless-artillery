/**
 * Post-run cleanup + verification.
 *
 * `npm run end-event` only flips the event's status to ENDED — it does not send
 * any Hangup to Chime (confirmed: events-streaming's updateEventStatus mutation
 * has no cascade-hangup side effect). And a meetingId-keyed hangup (e.g. the
 * conferenceHangup mutation) can't reach legs that failed before ever resolving
 * a real meeting id (participant record stuck at meeting_id=0) — exactly the
 * class of leg that orphaned ~1,648 calls in the Q3 load test (see
 * EP "Q3 Chime Load Test — Orphaned Calls & AWS Cost Impact").
 *
 * TWO SMAs, TWO LEGS PER ANALYST. We dial LOAD_TEST_FROM_PHONE -> LOAD_TEST_TO_PHONE,
 * and both numbers live in the same AWS account. So each analyst holds an outbound leg
 * on LOAD_TEST_SMA_ID *and* an inbound leg on the events-streaming SMA that answers
 * LOAD_TEST_TO_PHONE (CONFERENCE_SMA_ID). A transactionId is scoped to one SMA:
 * probing the conference-side id against the load-test SMA returns NotFoundException,
 * which reads as "already closed". Sweeping a single SMA therefore misses half the legs
 * and still prints a green all-clear.
 *
 * The one identifier every launched call has from the first millisecond is the
 * Chime transactionId returned by CreateSipMediaApplicationCall. This script:
 *   1. Reads every transactionId from run-state.ndjson and attempts
 *      UpdateSipMediaApplicationCall against EVERY configured SMA for each one.
 *      NotFoundException means that SMA has no record of it (fine) —
 *      anything else means we just closed a leg that was genuinely still open.
 *   2. Cross-checks the target participants table for any row still
 *      call_connection_state=CONNECTED whose meeting_id belongs to this run,
 *      and attempts the same hangup against that row's own transaction_id too
 *      (it may differ from the launch-time transactionId after a retry).
 *   3. Re-sweeps after a grace period and only then declares success. Step 1
 *      returning "hungUp" means Chime accepted the request, NOT that the leg died:
 *      the conference SMA routes it through a state machine that can decline to act.
 *   4. Prints a pass/fail summary and writes data/cleanup-report.json.
 *
 * Usage:
 *   npm run cleanup-run
 *
 * Env:
 *   RUN_STATE_PATH      - defaults to data/run-state.ndjson (same file as `npm run report`)
 *   RUN_ID              - defaults to the most recent run in the file
 *   CLEANUP_CONCURRENCY - defaults to 10
 *   CLEANUP_REPORT_PATH - defaults to data/cleanup-report.json
 *   CONFERENCE_SMA_ID   - events-streaming SMA answering LOAD_TEST_TO_PHONE. Without it
 *                         only half of each call is swept, so the run is reported as
 *                         UNVERIFIED rather than clean.
 *   CLEANUP_VERIFY_DELAY_MS - grace period before the verification sweep (default 20000)
 *
 * Exits non-zero if anything failed to close, is still CONNECTED afterward, or could
 * not be verified.
 *
 * Legs the state machine refuses to drop: if a participant row is already DISCONNECTED
 * the conference SMA ignores `action: hangup`, leaving the leg up forever. Deleting the
 * Chime meeting (primary + replicas) drops every leg bridged into it and is the
 * reliable escape hatch.
 */

import { realpathSync } from 'node:fs';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sendSipUpdate } = require('../lib/chimeClient.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadConfig } = require('../lib/config.js');

const RUN_STATE_PATH = resolve(process.cwd(), process.env.RUN_STATE_PATH || 'data/run-state.ndjson');
const REPORT_PATH = resolve(process.cwd(), process.env.CLEANUP_REPORT_PATH || 'data/cleanup-report.json');
const CONCURRENCY = parseInt(process.env.CLEANUP_CONCURRENCY || '10', 10);
const VERIFY_DELAY_MS = parseInt(process.env.CLEANUP_VERIFY_DELAY_MS || '20000', 10);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface RunEntry {
  runId: string;
  attendeeId: string;
  correlationId: string;
  meetingId: string | number;
  transactionId?: string | null;
  aborted: boolean;
  peakCallState: string | null;
  hungUpByScenario?: boolean;
}

type Outcome = 'hungUp' | 'alreadyGone' | 'failed';

interface HangupResult {
  transactionId: string;
  outcome: Outcome;
  error?: string;
  smaId?: string;
}

/**
 * One SMA to sweep, with the hangup arguments its own handler understands.
 * The load-test SMA answers to our bespoke `loadTestHangup` flag; the
 * events-streaming SMA expects `action: hangup` (ChimeSipMediaApplicationAction.HANGUP).
 */
interface SweepTarget {
  smaId: string;
  label: string;
  args: Record<string, string>;
}

function sweepTargets(config: any): SweepTarget[] {
  const targets: SweepTarget[] = [
    {
      smaId: config.smaId,
      label: `origination / load-test SMA ${config.smaId}`,
      args: { loadTestHangup: 'true' },
    },
  ];
  if (config.conferenceSmaId) {
    targets.push({
      smaId: config.conferenceSmaId,
      label: `conference / events-streaming SMA ${config.conferenceSmaId}`,
      args: { action: 'hangup' },
    });
  }
  return targets;
}

function loadEntries(): RunEntry[] {
  let all: RunEntry[];
  try {
    const text = readFileSync(RUN_STATE_PATH, 'utf8');
    all = text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunEntry);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Cannot read ${RUN_STATE_PATH}: ${msg}`);
    process.exit(1);
  }
  if (all.length === 0) {
    console.error(`${RUN_STATE_PATH} is empty.`);
    process.exit(1);
  }

  const targetRunId = process.env.RUN_ID;
  const entries = targetRunId
    ? all.filter((e) => e.runId === targetRunId)
    : (() => {
        const latest = all.reduce((max, e) => (e.runId > max ? e.runId : max), all[0].runId);
        return all.filter((e) => e.runId === latest);
      })();

  if (entries.length === 0) {
    console.error(`No entries found for runId=${targetRunId}`);
    process.exit(1);
  }
  return entries;
}

async function hangupTransactionIds(
  target: SweepTarget,
  transactionIds: string[],
  concurrency: number
): Promise<HangupResult[]> {
  const results: HangupResult[] = [];
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < transactionIds.length) {
      const transactionId = transactionIds[idx++];
      try {
        await sendSipUpdate(target.smaId, transactionId, target.args, {
          attendeeId: 'cleanup-run',
          meetingId: '',
          correlationId: '',
        });
        results.push({ transactionId, outcome: 'hungUp', smaId: target.smaId });
      } catch (error: any) {
        if (error?.name === 'NotFoundException') {
          results.push({ transactionId, outcome: 'alreadyGone', smaId: target.smaId });
        } else {
          results.push({
            transactionId,
            outcome: 'failed',
            error: error?.name || String(error),
            smaId: target.smaId,
          });
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(transactionIds.length, 1)) }, worker)
  );
  return results;
}

async function hangupWithThrottleRetry(
  target: SweepTarget,
  transactionIds: string[]
): Promise<HangupResult[]> {
  if (transactionIds.length === 0) return [];
  let results = await hangupTransactionIds(target, transactionIds, CONCURRENCY);

  const throttled = results.filter((r) => r.outcome === 'failed' && r.error === 'ThrottledClientException');
  if (throttled.length > 0) {
    console.log(`  ${throttled.length} attempt(s) hit Chime throttling — retrying at lower concurrency...`);
    const retried = await hangupTransactionIds(
      target,
      throttled.map((r) => r.transactionId),
      3
    );
    const byId = new Map(retried.map((r) => [r.transactionId, r]));
    results = results.map((r) => byId.get(r.transactionId) ?? r);
  }
  return results;
}

/**
 * Sweep the same transaction ids across every configured SMA. A given id only exists
 * on one of them, so `alreadyGone` from the other SMA is the expected, meaningless
 * half of each pair — which is precisely why a single-SMA sweep looks clean.
 */
async function sweepAllSmas(
  targets: SweepTarget[],
  transactionIds: string[],
  stepLabel: string
): Promise<HangupResult[]> {
  const all: HangupResult[] = [];
  for (const target of targets) {
    console.log(`  ↳ ${target.label}`);
    const results = await hangupWithThrottleRetry(target, transactionIds);
    printOutcomeCounts(`${stepLabel} @ ${target.smaId}`, results);
    all.push(...results);
  }
  return all;
}

async function findLeftoverConnected(meetingIds: Set<string>): Promise<Record<string, any>[]> {
  const config = loadConfig();
  const targetProfile = process.env.LOAD_TEST_TARGET_AWS_PROFILE;
  const client = new DynamoDBClient({
    region: config.region,
    ...(targetProfile ? { credentials: fromIni({ profile: targetProfile }) } : {})
  });

  const leftovers: Record<string, any>[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const out = await client.send(
      new ScanCommand({
        TableName: config.dynamo.tableName,
        FilterExpression: '#s = :connected',
        ExpressionAttributeNames: { '#s': config.dynamo.statusAttr },
        ExpressionAttributeValues: { ':connected': { S: config.dynamo.statusConnected } },
        ExclusiveStartKey: lastKey
      })
    );
    for (const item of out.Items ?? []) {
      const row = unmarshall(item);
      if (meetingIds.has(String(row.meeting_id))) leftovers.push(row);
    }
    lastKey = out.LastEvaluatedKey as Record<string, any> | undefined;
  } while (lastKey);

  return leftovers;
}

function printOutcomeCounts(label: string, results: HangupResult[]): void {
  const hungUp = results.filter((r) => r.outcome === 'hungUp').length;
  const alreadyGone = results.filter((r) => r.outcome === 'alreadyGone').length;
  const failed = results.filter((r) => r.outcome === 'failed').length;
  console.log(`  ${label}: hungUp=${hungUp} alreadyGone=${alreadyGone} failed=${failed}`);
  if (hungUp > 0) {
    console.log(`    ⚠ ${hungUp} leg(s) were still genuinely open at Chime and have now been closed.`);
  }
  if (failed > 0) {
    for (const r of results.filter((x) => x.outcome === 'failed')) {
      console.log(`    ✗ ${r.transactionId}: ${r.error}`);
    }
  }
}

export interface CleanupRunResult {
  runId: string;
  ok: boolean;
  launchResults: HangupResult[];
  leftoverRowsFound: number;
  leftoverResults: HangupResult[];
  /** Legs Chime still accepted an update for after the grace period — genuinely stuck. */
  stillLive: HangupResult[];
  /** False when CONFERENCE_SMA_ID is unset, i.e. only half of each call was swept. */
  verified: boolean;
}

export async function cleanupRun(): Promise<CleanupRunResult> {
  const entries = loadEntries();
  const runId = entries[0].runId;
  const meetingIds = new Set(entries.map((e) => String(e.meetingId)));
  const transactionIds = [...new Set(entries.map((e) => e.transactionId).filter((t): t is string => Boolean(t)))];

  console.log(`\nCleanup for run ${runId}`);
  console.log(`  Participants: ${entries.length}`);
  console.log(`  Distinct transaction ids captured at launch: ${transactionIds.length}`);
  const missingTxId = entries.length - transactionIds.length;
  if (missingTxId > 0) {
    console.log(
      `  ⚠ ${missingTxId} participant(s) have no transactionId in run-state (older run predating this capture, or the call never reached CreateSipMediaApplicationCall) — these cannot be swept here.`
    );
  }

  const config = loadConfig();
  const targets = sweepTargets(config);
  const verified = Boolean(config.conferenceSmaId);
  if (!verified) {
    console.log(
      '\n  ⚠ CONFERENCE_SMA_ID is not set. Each analyst holds a leg on the events-streaming\n' +
        '    SMA too, and those cannot be swept without it. This run will be reported as\n' +
        '    UNVERIFIED — do not read a green launch sweep as "nothing left open".'
    );
  }

  console.log(`\nStep 1/3 — sweeping launch-time transaction ids across ${targets.length} SMA(s)...`);
  const launchResults = await sweepAllSmas(targets, transactionIds, 'Launch-time sweep');

  console.log(`\nStep 2/3 — checking target participants table for leftover CONNECTED rows...`);
  const leftovers = await findLeftoverConnected(meetingIds);
  let leftoverResults: HangupResult[] = [];
  if (leftovers.length === 0) {
    console.log(`  None found — no participant in this run is still marked CONNECTED.`);
  } else {
    console.log(`  ⚠ Found ${leftovers.length} row(s) still CONNECTED for this run's meetings:`);
    for (const row of leftovers) {
      console.log(`    - id=${row.id} meeting_id=${row.meeting_id} transaction_id=${row.transaction_id} updated_at=${row.updated_at}`);
    }
    const leftoverTxIds = [...new Set(leftovers.map((r) => r.transaction_id).filter(Boolean))];
    leftoverResults = await sweepAllSmas(targets, leftoverTxIds, 'Leftover-row sweep');
  }

  // A "hungUp" above only means Chime accepted the CALL_UPDATE_REQUESTED. On the
  // conference SMA the state machine may decline to act (notably when the participant
  // row is already DISCONNECTED), leaving the leg up. Only a second sweep that comes
  // back all-NotFoundException proves the legs are actually gone.
  const sweptIds = [...new Set([...transactionIds, ...leftovers.map((r) => r.transaction_id).filter(Boolean)])];
  console.log(`\nStep 3/3 — waiting ${VERIFY_DELAY_MS}ms, then verifying the legs are really gone...`);
  await sleep(VERIFY_DELAY_MS);
  const verifyResults = await sweepAllSmas(targets, sweptIds, 'Verification sweep');
  const stillLive = verifyResults.filter((r) => r.outcome === 'hungUp');

  const allResults = [...launchResults, ...leftoverResults, ...verifyResults];
  const stillFailed = allResults.filter((r) => r.outcome === 'failed');
  const ok = stillFailed.length === 0 && stillLive.length === 0 && verified;

  console.log(`\n${'─'.repeat(64)}`);
  if (ok) {
    console.log('  ✓ Cleanup verified — every leg confirmed gone on every SMA.');
  } else {
    if (stillLive.length > 0) {
      console.log(`  ✗ ${stillLive.length} leg(s) STILL LIVE after hangup — the state machine refused to drop them.`);
      for (const r of stillLive.slice(0, 10)) console.log(`      ${r.transactionId} @ ${r.smaId}`);
      if (stillLive.length > 10) console.log(`      ... and ${stillLive.length - 10} more (see report)`);
      console.log('      Escape hatch: delete the Chime meeting (primary + replicas) to drop');
      console.log('      every leg bridged into it — aws chime-sdk-meetings delete-meeting.');
    }
    if (stillFailed.length > 0) {
      console.log(`  ✗ ${stillFailed.length} transaction(s) errored and could not be confirmed closed.`);
    }
    if (!verified) {
      console.log('  ✗ UNVERIFIED — CONFERENCE_SMA_ID unset, conference-side legs were never swept.');
    }
  }
  console.log('─'.repeat(64) + '\n');

  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        runId,
        generatedAt: new Date().toISOString(),
        smaIds: targets.map((t) => t.smaId),
        verified,
        launchTimeSweep: launchResults,
        leftoverRowsFound: leftovers.length,
        leftoverSweep: leftoverResults,
        verificationSweep: verifyResults,
        stillLive,
        ok
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(`Full report → ${REPORT_PATH}\n`);

  return {
    runId,
    ok,
    launchResults,
    leftoverRowsFound: leftovers.length,
    leftoverResults,
    stillLive,
    verified,
  };
}

function isCliEntry(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(resolve(argv1)) === realpathSync(__filename);
  } catch {
    return /cleanup-run\.[tj]s$/i.test(String(argv1).replace(/\\/g, '/'));
  }
}

if (isCliEntry()) {
  cleanupRun()
    .then((result) => {
      if (!result.ok) process.exit(1);
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      console.error(`FATAL: ${msg}`);
      process.exit(1);
    });
}
