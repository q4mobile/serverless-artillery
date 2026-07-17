---
name: ep-load-test
description: Run, report, and diagnose EP Chime PSTN dial-out load tests from ep-load-test/. Origination env and target env are independently configurable (prod→stage, prod→prod, stage→stage, stage→prod). Use when asked to run a load test, create load-test events, register analysts, generate a run report, clean up stuck calls/events, or investigate why a run failed.
---

# EP Chime dial-out load test

All commands run from `ep-load-test/` with the environment loaded:

```bash
cd ep-load-test && source .env
```

`.env` is gitignored and holds every required variable (AWS profiles, SMA ids, phone numbers, stage API hosts, `Q4_ADMIN_TOKEN`). If it is missing, copy the variable list from `ep-load-test/README.md` ("Dial-out env vars" + create-events/registration sections) and ask the user for the secret values — never invent them.

## Architecture (two independently chosen sides)

Every run has two sides, each pinned to an environment via `.env` — any combination works (prod→stage, prod→prod, stage→stage, stage→prod):

- **Origination side** — the account whose dedicated loadtest SMA (`serverless-artillery-loadtest-*`, provisioned by `.deploy/chime-load-test-sma/` with `backend.<env>.hcl`) places the outbound calls. Controlled by `LOAD_TEST_CHIME_AWS_PROFILE`, `LOAD_TEST_SMA_ID`, `LOAD_TEST_FROM_PHONE`.
- **Target side** — the environment whose IVR (`events-streaming`) answers the dial-in number and is actually under test. Controlled by `LOAD_TEST_TO_PHONE` (this alone decides which env's IVR picks up!), `DIALOUT_PARTICIPANTS_TABLE_NAME`, `LOAD_TEST_TARGET_AWS_PROFILE`, and the EP API vars (`EP_API_GRAPHQL_BASE_URL`, `EP_COMPANY_ID`, `EP_API_BASE_URL`).

Known accounts: prod `357657936979` (profile `q4events-prod`), stage `149220547089` (profile `q4events-stage`). Per-env values (SMA ids, dial-in numbers, table names, hosts) live in `.env` / team notes — when switching combos, change **both groups consistently** and double-check `LOAD_TEST_TO_PHONE`, since a mismatched number silently load-tests the wrong environment.

When the two sides are **different accounts**, one process needs both credential sets, so Artillery must run **locally** (README "Step 2b") — the serverless-artillery Lambda path cannot span two accounts. Same-account combos (prod→prod, stage→stage) work with a single profile / default credential chain.

## Pre-flight checks (do these before every run)

1. **Credentials for both sides**: `aws sts get-caller-identity --profile <each profile used>` — for SSO profiles (e.g. `q4events-stage`), an expired session means the user must run `aws sso login --profile <profile>` yourself only if the user asks you to; it's an interactive/browser flow, so by default tell the user to run it and wait — don't invoke it unprompted. An `ExpiredToken`/"The security token included in the request is expired" error is an **auth** failure, not a Chime throttle — don't misdiagnose it as `ThrottledClientException` (see Rate limits below), they look similar in an Artillery error summary but have completely different fixes.
2. **Combo sanity**: confirm with the user which combo this run is (origination env → target env) and that `LOAD_TEST_TO_PHONE`, the participants table, and the EP API hosts all belong to the **same** target env. Note: `q4events-prod-loadtest` lacks Chime/DynamoDB read access — use `q4events-prod` (SSO ReadOnlyAccess) whenever prod is the *target* side.
3. **Admin token**: `Q4_ADMIN_TOKEN` expires (~24h). A 401 from create-events/end-event means the user must refresh it from browser localStorage (`<target-env>.authToken-platform`, e.g. `stage.authToken-platform`).
4. **Plan dates**: in `data/events-plan.json`, `eventStart` must be near/past and `eventEnd` comfortably **after** the planned end of the run (runs have failed because events expired mid-test). Regenerate with fresh dates if stale.
5. **Row/phase match**: CSV data rows must equal total `arrivalCount` across `config.phases` in `tests/dial-out-payload-example.yml`, or Artillery reuses rows and double-dials analysts:
   ```bash
   wc -l < data/analysts-payload.csv   # must equal sum of arrivalCount
   ```
6. If the user didn't specify the scenario shape (events × analysts, arrival duration), ask before generating anything.

## Run workflow

Manual, step-by-step — preferred when tuning rate/shape or investigating a failure, since each phase's output is visible before moving to the next:

```bash
# 1. Create events (writes data/registration-plan.json). Re-running against the
#    same events-plan.json creates a FRESH batch of events with new meetingIds —
#    it does not reuse/revive events from a previous run.
npm run create-events

# 2. Register analysts (writes data/analysts-payload.csv — one HTTP call per
#    analyst; for thousands of analysts this can take tens of minutes, and the
#    CSV is written only once at the very end, so there's no partial-progress
#    file to check — stdout is the only signal, and it may be buffered if piped
#    through something like `tail` that only flushes at EOF).
npm run register-analysts

# 3. Start events (NOT_STARTED -> STARTED)
npm run start-event

# 4. Run — always tee the output, and set RUN_STATE_PATH explicitly for
#    anything other than the single default scenario (ramp/shard/full-scale
#    runs each need their own path so repeated or concurrent runs don't
#    clobber each other's per-participant state)
RUN_STATE_PATH=data/run-state.<name>.ndjson \
  npx artillery run tests/dial-out-payload-example.yml 2>&1 | tee data/last-run.log

# 5. Report (reads data/run-state.ndjson by default, no AWS access needed)
npm run report

# 6. If broadcasts are part of the scenario
npm run start-broadcast   # / npm run stop-broadcast

# 7. Cleanup after any run, aborted or not (ends all events from
#    registration-plan.json, which disconnects lingering participants).
#    Works even on events that were never started — NOT_STARTED -> ENDED
#    succeeds cleanly — so it's a safe blanket cleanup any time a batch of
#    created/registered events needs to be abandoned quickly.
npm run end-event
```

One-shot orchestrator (`scripts/run-load-test.ts`, `npm run load-test`) runs
create-events → register-analysts → start-events → Artillery → start-broadcast
→ (wait) → stop-broadcast → end-events as a single process, auto-extending the
Artillery YAML's last `think` step so participants stay connected through the
broadcast window:

```bash
ARTILLERY_SCRIPT=tests/dial-out-payload-example.yml npm run load-test
```

Key env vars: `DIAL_IN_WAIT_MS`, `BROADCAST_DURATION_MS`, `HANGUP_BUFFER_MS`,
`SKIP_CREATE_EVENTS=1` / `SKIP_REGISTER_ANALYSTS=1` (reuse an existing
registration-plan/CSV instead of regenerating). Use this when the scenario
includes a broadcast; for a plain dial-out-rate test the manual steps above
give clearer progress visibility and let you stop between phases.

### Rate-ramp scenarios (finding the throttle knee)

`tests/dial-out-ramp.yml` is the pattern for empirically finding a sustainable
CPS before committing to a full-scale run: a handful of 30s phases stepping
`arrivalRate` up by 1/sec each (e.g. 3→4→5→6→7), short `think` (10-20s) to keep
concurrent active calls low so the result isolates the **per-second API rate
limit** from the **account's active-call-count limit**. Bucket results by
30s-aligned windows of the success/failure event timestamps (an approximation —
Artillery phases key off scenario *launch* time, not the later
success/failure *resolution* time, so results near a phase boundary can smear
into the adjacent bucket) to find where the throttle percentage starts
climbing. See Rate limits below for the last measured knee.

For full-scale runs, prefer a **single sustained-rate phase at the proven-safe
rate with a short hold/think** (`tests/dial-out-full-7500.yml` is the current
example: 4/sec, 20s think) over a long think time (e.g. 1200s) — a long hold
lets nearly all participants be connected simultaneously by the end of the
run, which can hit the account's active-call-count limit independently of the
per-second CPS limit.

## Rate limits — the single most important constraint

There are **two independent throttle mechanisms**, one per side — don't conflate them, they have different symptoms and different fixes:

**1. Target-side: Chime PSTN Audio voice-action throttle** (`ActionExecutionThrottled` on `Speak`/`SpeakAndGetDigits`, tied to the target env's account). Measured on stage-as-target, 2026-07-14 (treat as last known data point — a quota increase may change it):

- **~4.2 calls/sec** (2500/10min): ~80% of calls failed — Chime returned `ActionExecutionThrottled` starting from the very first voice action of a call.
- **~0.83 calls/sec** (500/10min): 100% clean run.

Failure cascade when throttled: `ActionExecutionThrottled` → IVR collects empty digits → `EMPTY_INPUT` → events-streaming hangs up immediately (empty input gets **zero** retries, unlike invalid input which gets 3) → Artillery later logs `Transaction ... doesn't exist for SipMediaApplication` (the call died before our script's `sleep(4000)` in `lib/scenarioSteps.js` `enterMeetingId`/`enterPin` elapsed).

**2. Origination-side: Chime API call-rate throttle** (`ThrottledClientException: "Service received too many requests"` on `CreateSipMediaApplicationCall`/`UpdateSipMediaApplicationCall`, tied to the origination env's account — both stage and prod sit at AWS default CPS/API-rate quotas in us-east-1). Measured via a stage-origin rate ramp (`tests/dial-out-ramp.yml`), 2026-07-17:

| Rate | Throttled |
|---|---|
| 3/sec | 0% |
| 4/sec | 0% |
| 5/sec | ~14% |
| 6/sec | ~36% |
| 7/sec | ~29% (noisy — retries partly self-correct) |

Knee sits **between 4 and 5 calls/sec** for stage-origin. Treat **4/sec** as the
current proven-safe sustained origination rate until a quota increase is
requested/confirmed.

When planning a run above ~1.5 calls/sec against a stage target, or above
~4/sec origination CPS, warn the user about the relevant throttle above and
get explicit confirmation. If in doubt which one you're hitting, check which
side the errors come from: `ActionExecutionThrottled` in the target's
`conferenceEventHandler` logs (mechanism 1) vs. `ThrottledClientException` in
Artillery's own error summary / `ep.dialout.update.throttled` log lines
(mechanism 2).

## Diagnosing a failed run

Local first:
- `npm run report` / `data/run-state.ndjson` — per-participant peak state. `NEVER_REACHED_DYNAMO` = local abort before any Chime call; stuck at `AWAITING_MEETING_PIN`/`AWAITING_MEETING_ID` = IVR-side failure.
- `data/last-run.log` — Artillery errors ("Transaction doesn't exist" = call already hung up by IVR).

Target side (profile of the target env, us-east-1; substitute `<env>` = `stage`/`prod`/`dev`):
- Logs `/aws/lambda/events-streaming-<env>-conferenceEventHandler`:
  - filter `"ACTION_FAILED"` and inspect `ActionData.ErrorType` — `ActionExecutionThrottled` means the rate limit above;
  - filter `"EMPTY_INPUT"` — count of empty meeting-ID/PIN collections;
  - `'Error fetching participants for meeting 0'` / `'Error publishing participant list'` are **known background noise**, non-blocking, present in every run.
- DynamoDB `events-streaming-serverless-conference-participants-stage` (GSI `correlation_id-index`): state machine is `DIALED_IN → AWAITING_EARLY_DTMF → AWAITING_MEETING_ID → AWAITING_MEETING_PIN → CONNECTING_PARTICIPANT → CONNECTED → DISCONNECTED`. Rows with `meeting_id = 0` never got past meeting-ID entry. A healthy participant has both `JOINED` and `LEFT` activities.

Origination side (profile `LOAD_TEST_CHIME_AWS_PROFILE`, us-east-1 — this is prod, stage, or whichever account currently owns `LOAD_TEST_SMA_ID`, per the architecture section above; the loadtest SMA stack is deployed per-env via `.deploy/chime-load-test-sma/backend.<env>.hcl`):
- Logs `/aws/lambda/serverless-artillery-loadtest-sma-handler-us-east-1`. Healthy run: equal counts of `NEW_OUTBOUND_CALL`/`RINGING`/`CALL_ANSWERED` (= participant count), `CALL_UPDATE_REQUESTED` = 3× (meeting ID + PIN + hangup), `ACTION_SUCCESSFUL` = 2×. `ep.dialout.update.throttled` in Artillery's own log = throttled-but-retried `UpdateSipMediaApplicationCall` calls (mechanism 2 in Rate limits above).
- The prod IAM user (`q4events-prod`) has **no CloudWatch metrics or Service Quotas access** — use logs, not `get-metric-statistics`.

## Safety rails

- `PRODUCTION_SMA_ID` (prod's real inbound conferencing SMA — **not** the loadtest one) must stay set in `.env`; the processor refuses to start if `LOAD_TEST_SMA_ID` matches it. Never remove this guard.
- `create-events`/`end-event` create/end **real** events wherever `EP_API_GRAPHQL_BASE_URL`/`EP_COMPANY_ID` point — this now includes prod as a valid target (read the current `.env` to see which env is live; don't assume it's always stage). Confirm the target env with the user before creating events, and always re-confirm before pointing at prod if it wasn't already the agreed target.
- Copy `.env.example` → `.env` to bootstrap a new environment; `.env` itself stays gitignored and is never committed.
- Never commit: `.env`, `data/*.csv`, `data/registration-plan*.json`, `data/events-plan*.json`, run artifacts (all gitignored).
- After any aborted run, offer `npm run end-event` — lingering calls hold real PSTN legs and origination-account Chime capacity. Confirmed safe to run even before events were started.
- Real-world time pressure (e.g. an imminent unrelated production event on the same platform) can force stopping mid-setup. If so: stop any in-flight background script first (`TaskStop`/Ctrl-C), then run `npm run end-event` regardless of how far setup got — it's a no-op-safe blanket cleanup for any events already created via `create-events`, started or not.