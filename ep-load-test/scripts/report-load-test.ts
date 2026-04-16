/**
 * Post-load-test report: reads data/run-state.ndjson written by Artillery's
 * afterScenario hook and prints a participant-level summary.
 *
 * Peak state is captured in-process during the scenario (before cleanup / hangup),
 * so this script works entirely offline — no DynamoDB query needed.
 *
 * Usage:
 *   npm run report
 *
 * By default, reports the most recent run in the file.
 * Set RUN_ID=<id> to report a specific run.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const RUN_STATE_PATH = resolve(process.cwd(), process.env.RUN_STATE_PATH || "data/run-state.ndjson");
const REPORT_PATH = resolve(process.cwd(), process.env.REPORT_PATH || "data/run-report.json");

// States the call must pass through in order — used to determine "reached CONNECTED"
const CONNECTED_STATES = new Set(["CONNECTED", "DISCONNECTED"]);

interface RunEntry {
  runId: string;
  attendeeId: string;
  correlationId: string;
  meetingId: string | number;
  aborted: boolean;
  peakCallState: string | null;
  peakHandRaised: boolean | null;
}

function pct(n: number, total: number): string {
  if (total === 0) return "0.0";
  return ((n / total) * 100).toFixed(1);
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function main(): void {
  // ── Load run state ─────────────────────────────────────────────────────────
  let allEntries: RunEntry[];
  try {
    const text = readFileSync(RUN_STATE_PATH, "utf8");
    allEntries = text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunEntry);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Cannot read ${RUN_STATE_PATH}: ${msg}`);
    console.error("Run Artillery with afterScenario: saveParticipantResult first.");
    process.exit(1);
  }

  if (allEntries.length === 0) {
    console.error("run-state.ndjson is empty.");
    process.exit(1);
  }

  // ── Select run ─────────────────────────────────────────────────────────────
  const targetRunId = process.env.RUN_ID;
  const entries = targetRunId
    ? allEntries.filter((e) => e.runId === targetRunId)
    : (() => {
        const latest = allEntries.reduce(
          (max, e) => (e.runId > max ? e.runId : max),
          allEntries[0].runId
        );
        return allEntries.filter((e) => e.runId === latest);
      })();

  if (entries.length === 0) {
    console.error(`No entries found for runId=${targetRunId}`);
    process.exit(1);
  }

  const runId = entries[0].runId;
  const meetings = [...new Set(entries.map((e) => String(e.meetingId)))];

  // ── Aggregate ──────────────────────────────────────────────────────────────
  const total = entries.length;
  const byPeakState: Map<string, number> = new Map();

  for (const e of entries) {
    const state = e.peakCallState ?? "NEVER_REACHED_DYNAMO";
    byPeakState.set(state, (byPeakState.get(state) ?? 0) + 1);
  }

  const connectedCount = entries.filter((e) =>
    e.peakCallState !== null && CONNECTED_STATES.has(e.peakCallState)
  ).length;
  const completedCount = entries.filter((e) => e.peakCallState === "DISCONNECTED").length;
  const abortedCount = entries.filter((e) => e.aborted).length;
  const handRaisedCount = entries.filter((e) => e.peakHandRaised === true).length;

  // ── Print summary ──────────────────────────────────────────────────────────
  const divider = "─".repeat(64);
  console.log(`\nLoad test report`);
  console.log(`  Run:          ${runId}`);
  console.log(`  Meetings:     ${meetings.join(", ")}`);
  console.log(`  Participants: ${total}`);
  console.log(`\n${divider}`);
  console.log(`  Successfully connected:    ${connectedCount.toString().padStart(4)}  (${pct(connectedCount, total)}%)`);
  console.log(`  Completed full flow:       ${completedCount.toString().padStart(4)}  (${pct(completedCount, total)}%)`);
  console.log(`  Aborted (Artillery):       ${abortedCount.toString().padStart(4)}  (${pct(abortedCount, total)}%)`);
  console.log(`  Hand raised at peak:       ${handRaisedCount.toString().padStart(4)}  (${pct(handRaisedCount, total)}%)`);
  console.log(`\n  By peak call state (before cleanup):`);

  const sorted = [...byPeakState.entries()].sort((a, b) => b[1] - a[1]);
  for (const [state, count] of sorted) {
    const marker = CONNECTED_STATES.has(state) ? " ✓" : "  ";
    console.log(`  ${marker} ${pad(state, 44)} ${String(count).padStart(4)}  (${pct(count, total)}%)`);
  }
  console.log(divider);

  // ── Print stuck participants ───────────────────────────────────────────────
  const stuck = entries.filter(
    (e) => e.aborted || (e.peakCallState !== "DISCONNECTED")
  );
  if (stuck.length > 0) {
    console.log(`\n  Participants that did not complete (${stuck.length}):`);
    const header = `  ${"attendeeId".padEnd(26)} ${"meetingId".padEnd(12)} ${"peakCallState".padEnd(30)} aborted`;
    console.log(header);
    console.log("  " + "─".repeat(header.length - 2));
    for (const e of stuck) {
      console.log(
        `  ${pad(String(e.attendeeId), 26)} ${pad(String(e.meetingId), 12)} ${pad(e.peakCallState ?? "NEVER_REACHED_DYNAMO", 30)} ${e.aborted}`
      );
    }
  }

  // ── Write JSON report ──────────────────────────────────────────────────────
  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    meetings,
    summary: {
      total,
      connectedCount,
      completedCount,
      abortedCount,
      handRaisedCount,
      byPeakCallState: Object.fromEntries(sorted)
    },
    participants: entries
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(`\n  Full report → ${REPORT_PATH}\n`);
}

main();
