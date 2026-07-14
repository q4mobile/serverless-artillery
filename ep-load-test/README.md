# ep-load-test

PSTN dial-out load testing via AWS Chime SDK Voice + Artillery.

---

## Quick start

```bash
cd ep-load-test
npm install
```

Two ways to run:

| Participants | Approach |
|---|---|
| Up to 20 | **serverless-artillery** — deploy + invoke on Lambda |
| 20+ | **Artillery locally** — `npx artillery run` directly on your machine |

---

## Step 0 — (Optional) Create events on the Events Platform

Skip this if you already have `meetingId` values. Otherwise create internal digital conferencing events first; the script writes `data/registration-plan.json`, which Step 1 consumes.

`Q4_ADMIN_TOKEN` is the raw JWT from browser localStorage (`dev.authToken-platform`, `stage.authToken-platform`, etc.). It expires, so refresh it when the API returns 401.

```bash
Q4_ADMIN_TOKEN="eyJhbGc..." \
EVENTS_PLAN_PATH="data/events-plan.json" \
npm run create-events
```

Plan file format (`data/events-plan.json`, copy from `data/events-plan.example.json`):

```json
[
  {
    "title": "Load Test Event #1",
    "analystCount": 250,
    "eventType": "earnings",
    "eventStart": "2026-04-29T13:00:00.000Z",
    "eventEnd": "2026-04-29T14:00:00.000Z"
  }
]
```

The payload defaults to internal Chime conferencing with dial-in speaker, layout manager, external output, captions, and dual stream enabled.

Output: `data/registration-plan.json` (overwritten on each run) shaped exactly like `data/registration-plan.example.json` so `npm run register-analysts` picks it up automatically.

### Create-events env vars

| Variable | Required | Default | Notes |
|---|---|---|---|
| `Q4_ADMIN_TOKEN` | Yes | — | **Secret.** Admin platform JWT from browser localStorage. Never logged. |
| `EP_API_GRAPHQL_BASE_URL` | No | `https://dev.events.q4inc.com` | GraphQL host root; POSTs go to `${host}/graphql`. |
| `EP_COMPANY_ID` | No | dev companyId | Sent as `x-company-id` header; must match the tenant the token can administer. Update for stage/prod. |
| `EVENTS_PLAN_PATH` | No | `data/events-plan.json` | Input plan file. |
| `REGISTRATION_PLAN_OUTPUT_PATH` | No | `data/registration-plan.json` | Output plan file (consumed by Step 1). Overwritten. |
| `CREATE_EVENT_DELAY_MS` | No | `100` | Delay between create-event requests. |
| `CREATE_EVENT_FETCH_TIMEOUT_MS` | No | `0` | `0` = disabled; otherwise per-request `AbortSignal.timeout`. |
| `CREATE_EVENT_DEFAULT_TYPE` | No | `earnings` | Default `eventType` for entries that omit it. |

**Production safety:** the defaults target dev. To create on stage / prod set `EP_API_GRAPHQL_BASE_URL` and `EP_COMPANY_ID` explicitly (values per env are in `events-platform/client/events-app/e2e/config.ts`). Do not point at prod unintentionally — events created via this CLI are real. **Current load tests target stage** (`EP_API_GRAPHQL_BASE_URL`/`EP_API_BASE_URL` → stage host, `EP_COMPANY_ID` → stage company id) even though call origination (`LOAD_TEST_SMA_ID`, the Chime SMA) runs from prod — see [Call-origination account vs. target-under-test account](#call-origination-account-vs-target-under-test-account) below.

End-to-end command sequence (with no pre-existing meetings):

```bash
Q4_ADMIN_TOKEN="eyJhbGc..." npm run create-events
ANALYST_REGISTRATION_PASSWORD="secret" npm run register-analysts
npx artillery run tests/dial-out-payload-example.yml
```

---

## Step 1 — Pre-register analysts

Run once before any load test to generate `data/analysts-payload.csv` (attendeeId, pin, email, meetingId).

```bash
# Single meeting
MEETING_ID=456606437 \
ANALYST_REGISTRATION_PASSWORD="secret" \
npm run register-analysts

# Multiple meetings, 10 analysts each
MEETING_IDS=111222333,444555666 \
ANALYST_COUNT_PER_MEETING=10 \
ANALYST_REGISTRATION_PASSWORD="secret" \
npm run register-analysts

# From a JSON plan file
REGISTRATION_PLAN_PATH=./data/registration-plan.json \
npm run register-analysts
```

Plan file format (`data/registration-plan.json`, copy from `data/registration-plan.example.json`):

**Main production-scale scenario — 4 parallel meetings, 225 analysts each (900 total):** use four rows with real `meetingId` values (replace placeholders in `registration-plan.example.json`), `analystCount: 225` each, then run `npm run register-analysts`. The generated CSV must have **900** data rows; `tests/dial-out-payload-example.yml` uses `arrivalCount: 900` and `duration: 300` to match.

```json
[
  { "meetingId": 111111111, "analystCount": 225, "registrationPassword": "optional-per-meeting-secret" },
  { "meetingId": 222222222, "analystCount": 225, "registrationPassword": "optional-per-meeting-secret" },
  { "meetingId": 333333333, "analystCount": 225, "registrationPassword": "optional-per-meeting-secret" },
  { "meetingId": 444444444, "analystCount": 225, "registrationPassword": "optional-per-meeting-secret" }
]
```

Smaller smoke example:

```json
[
  { "meetingId": 456606437, "analystCount": 20, "registrationPassword": "optional-per-meeting-secret" }
]
```

**Rules:** set exactly one of `MEETING_ID`, `MEETING_IDS`, `REGISTRATION_PLAN_PATH`, or place `data/registration-plan.json` in `ep-load-test/`. Setting more than one fails fast.

### Registration env vars

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MEETING_ID` | One of† | — | Single meeting id |
| `MEETING_IDS` | One of† | — | Comma-separated meeting ids |
| `REGISTRATION_PLAN_PATH` | One of† | — | Path to JSON plan |
| `ANALYST_COUNT` | No | `225` | Analysts per meeting (single meeting or `MEETING_IDS`) |
| `ANALYST_COUNT_PER_MEETING` | No | — | Overrides `ANALYST_COUNT` when using `MEETING_IDS` |
| `EP_API_BASE_URL` | No | `https://attendees.dev.events.q4inc.com/rest/v1` | REST base URL |
| `ANALYST_REGISTRATION_PASSWORD` | No | — | Default password; per-meeting plan entry overrides this |
| `REGISTRATION_DELAY_MS` | No | `50` | Delay between registration requests |
| `OUTPUT_PATH` | No | `data/analysts-payload.csv` | Output CSV path |

† Or place `data/registration-plan.json` in `ep-load-test/`.

---

## Step 2a — serverless-artillery (up to 20 participants)

Bake env vars into the worker Lambda on deploy, then invoke remotely:

```bash
cd ep-load-test

LOAD_TEST_SMA_ID="4f1b67ad-1c38-4874-a477-f44573ec5db4" \
LOAD_TEST_FROM_PHONE="+13656750422" \
LOAD_TEST_TO_PHONE="+18338175920" \
DIALOUT_PARTICIPANTS_TABLE_NAME="events-streaming-serverless-conference-participants-dev" \
PRODUCTION_SMA_ID="sma-prod-xxxxxxxx" \
../bin/serverless-artillery deploy

../bin/serverless-artillery invoke -p tests/dial-out-payload-example.yml
```

`AWS_REGION` is injected automatically by Lambda — do not set it in `serverless.yml`.

---

## Step 2b — Artillery locally (20+ participants)

### Prerequisites

- Test SMA deployed: see [../.deploy/chime-load-test-sma/README.md](../.deploy/chime-load-test-sma/README.md)
- `data/analysts-payload.csv` exists (Step 1)
- **Load phases** in `tests/dial-out-payload-example.yml` match the CSV data row count (see below). Default main scenario: **900** rows ↔ **`arrivalCount: 900`**.

### Load phases (ramp-up)

**IMPORTANT:** Total scenario starts in `config.phases` must equal the number of CSV **data** rows (no header). The checked-in default is **900** rows (4 meetings × 225 analysts) and **`arrivalCount: 900`**. If these differ, you get duplicate dials or unused rows.

With `payload.order: sequence`, each **new scenario** consumes the next CSV row. The **total number of scenario starts** across all `phases` must equal the number of **data** rows in `analysts-payload.csv` (excluding the header), or Artillery will reuse rows and dial the same analyst twice.

**Option A — even spacing (recommended):** `arrivalCount` + `duration`. Artillery spreads exactly `arrivalCount` new scenarios across `duration` seconds (smooth ramp of *origination times*). The default `dial-out-payload-example.yml` targets **900** starts (4 meetings × 225 analysts) over **5 minutes** → `arrivalCount: 900`, `duration: 300`. For a single meeting of 225, use `arrivalCount: 225` instead.

**Option B — stepped rate ramp:** `arrivalRate` + `rampTo` + `duration`. In this repo’s Artillery build, rates are **integers** only; total starts are **approximate** (probabilistic ramp). Use a short rehearsal and compare “Scenarios launched” to your CSV, or prefer **Option A** when the row count must match exactly.

Tune `duration` / `arrivalCount` / `arrivalRate` / `rampTo` to your target (e.g. **900** starts over 5 minutes for 4×225, or a smaller smoke run).

### Run

```bash
cd ep-load-test

LOAD_TEST_SMA_ID="4f1b67ad-1c38-4874-a477-f44573ec5db4" \
LOAD_TEST_FROM_PHONE="+13656750422" \
LOAD_TEST_TO_PHONE="+18338175920" \
DIALOUT_PARTICIPANTS_TABLE_NAME="events-streaming-serverless-conference-participants-dev" \
npx artillery run tests/dial-out-payload-example.yml
```

Set `PRODUCTION_SMA_ID` to your prod SMA id as a safety guard — the processor will refuse to start if `LOAD_TEST_SMA_ID` matches it.

### Scenario flow

Each virtual user runs these steps in order:

```
dialParticipant                → CreateSipMediaApplicationCall (Chime)
waitForMeetingIdPrompt         → poll DynamoDB until call_connection_state = AWAITING_MEETING_ID
enterMeetingId                 → UpdateSipMediaApplicationCall with digits "<meetingId>#"
waitForPinPrompt               → poll DynamoDB until call_connection_state = AWAITING_MEETING_PIN
enterPin                       → UpdateSipMediaApplicationCall with digits "<pin>#"
waitForConnected               → poll DynamoDB until call_connection_state = CONNECTED
think: 60
toggleHand                     → UpdateSipMediaApplicationCall with digits "*1#"
waitForHandUp                  → poll DynamoDB until hand_raised = true
think: 60
toggleHand                     → UpdateSipMediaApplicationCall with digits "*1#"
waitForHandDown                → poll DynamoDB until hand_raised = false
think: 120
hangUp                         → UpdateSipMediaApplicationCall with loadTestHangup
waitForDisconnected            → poll DynamoDB until call_connection_state = DISCONNECTED
hangUpOnError                  → no-op on success; hangs up any call left open by an earlier error
```

Optional steps (uncomment in YAML after `waitForConnected`):

```
sendParticipantControls        → UpdateSipMediaApplicationCall with digits "*9#"
waitAfterParticipantControls   → poll DynamoDB until call_connection_state = CONNECTED
sendHumanIntake                → UpdateSipMediaApplicationCall with digits "*0#"
waitAfterHumanIntake           → poll DynamoDB until call_connection_state = INITIATE_TRANSFER_FROM_CHIME_TO_SUPPORT
```

### Dial-out env vars

| Variable | Required | Default | Notes |
|---|---|---|---|
| `LOAD_TEST_SMA_ID` | Yes | — | **Secret.** Dedicated test SMA id — never production |
| `LOAD_TEST_FROM_PHONE` | Yes | — | E.164 caller id (e.g. `+14155551234`) |
| `LOAD_TEST_TO_PHONE` | Yes | — | E.164 PSTN number the SMA answers on — this determines which environment's IVR (and therefore which environment is actually under test) picks up the call |
| `DIALOUT_PARTICIPANTS_TABLE_NAME` | Yes | — | Conference participants DynamoDB table name, in the environment under test |
| `PRODUCTION_SMA_ID` | No | — | If set and matches `LOAD_TEST_SMA_ID`, processor refuses to start |
| `DIALOUT_POLL_TIMEOUT_MS` | No | `60000` | Max ms to wait per DynamoDB status poll |
| `DIALOUT_POLL_INTERVAL_MS` | No | `400` | DynamoDB poll interval in ms |
| `AWS_REGION` | No | `us-east-1` | AWS region for Chime and DynamoDB clients |
| `LOAD_TEST_CHIME_AWS_PROFILE` | No | default credential chain | Named AWS CLI profile used **only** for Chime SDK Voice calls (`CreateSipMediaApplicationCall` / `UpdateSipMediaApplicationCall`) — the account that owns `LOAD_TEST_SMA_ID` (currently prod) |
| `LOAD_TEST_TARGET_AWS_PROFILE` | No | default credential chain | Named AWS CLI profile used **only** for the DynamoDB participant poll — the account under test (currently stage) |

### Call-origination account vs. target-under-test account

The dedicated test SMA only originates the outbound leg and blindly relays DTMF on
command (see [../.deploy/chime-load-test-sma/README.md](../.deploy/chime-load-test-sma/README.md));
the actual application under test — IVR, participant state, broadcast — is whatever
answers `LOAD_TEST_TO_PHONE`. These two can now live in **different AWS accounts**:

- **Call origination (prod, `q4events-prod` / `357657936979`)**: the `chime-load-test-sma`
  Terraform stack, `LOAD_TEST_SMA_ID`, `LOAD_TEST_FROM_PHONE`, and `LOAD_TEST_CHIME_AWS_PROFILE`.
- **Target under test (stage, `q4events-stage` / `149220547089`)**: `LOAD_TEST_TO_PHONE`,
  `DIALOUT_PARTICIPANTS_TABLE_NAME`, `LOAD_TEST_TARGET_AWS_PROFILE`, and all the
  `EP_API_GRAPHQL_BASE_URL` / `EP_COMPANY_ID` / `EP_API_BASE_URL` values used by
  `create-events`, `register-analysts`, and `start-broadcast` / `stop-broadcast`.

Set the two AWS profile env vars to named profiles in your local `~/.aws/config` that
each resolve to the correct account — `chimeClient.js` and `participantPoller.js` build
their AWS SDK clients independently, so a single run can hold credentials for both
accounts at once. `PRODUCTION_SMA_ID` still guards against accidentally pointing
`LOAD_TEST_SMA_ID` at prod's real inbound conferencing SMA, which now lives in the same
account as the dedicated test SMA.

**Step 2a (serverless-artillery / Lambda) does not support this split** — the worker
Lambda runs with a single execution role in a single account, so it can't hold separate
credentials for two accounts the way a local `npx artillery run` process can. Use
Step 2b (local Artillery) for cross-account runs; this is also what every load test
above 20 participants already uses.

---

## Infrastructure

### Test SMA Lambda

Deploy once from [../.deploy/chime-load-test-sma/](../.deploy/chime-load-test-sma/). Copy `sip_media_application_id` from Terraform output → `LOAD_TEST_SMA_ID`.

The Lambda handles:
- `CALL_ANSWERED` on outbound leg → returns empty Actions (Dynamo-gated; events-streaming handles the IVR)
- `CALL_UPDATE_REQUESTED` with `loadTestDigits` → returns `SendDigits` action
- `CALL_UPDATE_REQUESTED` with `loadTestHangup` → returns `Hangup` action

### DynamoDB GSI

The participant table must have GSI `correlation_id-index` with partition key `correlation_id` (see `lib/config.js`). Apply the DynamoDB Terraform in **events-streaming** before running.

### Lambda resource policy

`events-streaming-dev-conferenceEventHandler` must allow Chime to invoke it:

```bash
aws lambda get-policy \
  --function-name events-streaming-dev-conferenceEventHandler \
  --region us-east-1 \
  | jq '.Policy | fromjson | .Statement[] | select(.Principal.Service == "voiceconnector.chime.amazonaws.com")'
```

If missing, add it:

```bash
aws lambda add-permission \
  --function-name events-streaming-dev-conferenceEventHandler \
  --statement-id AllowChimeSMAInvoke \
  --action lambda:InvokeFunction \
  --principal voiceconnector.chime.amazonaws.com \
  --region us-east-1
```

### IAM (serverless-artillery worker Lambda)

`serverless.yml` grants:
- `chime:CreateSipMediaApplicationCall` + `chime:UpdateSipMediaApplicationCall` on the test SMA ARN (`arn:aws:chime:*:*:sma/<id>`)
- `dynamodb:Query` on the participants table and its indexes

---

## Stability checklist

1. Total scenario **starts** in Artillery `phases` equals CSV **data** row count (prefer `arrivalCount` + `duration` for an exact match) — otherwise the same attendee is dialled twice.
2. `DIALOUT_POLL_TIMEOUT_MS` ≥ `60000` when 5+ participants share one meeting — concurrent joins take longer to propagate through the GSI.
3. Lambda resource policy on `conferenceEventHandler` is present (see above).
4. Test SMA Lambda deployed and the SMA points to it.

---

## Step 3 — Post-run report

After Artillery finishes, run the report script. No AWS credentials or DynamoDB access needed — the peak state of every participant is captured in-process during the scenario (before cleanup/hangup) and written to `data/run-state.ndjson`. The example Artillery script declares `afterScenario: [saveParticipantResult]` on the scenario (the HTTP engine does not run processor exports unless they appear in the flow or in `afterScenario` / `beforeScenario`).

```bash
npm run report
```

Sample output:

```
Load test report
  Run:          2026-04-14T19:08:00.000Z
  Meetings:     456606437
  Participants: 20

────────────────────────────────────────────────────────────────
  Successfully connected:      17  (85.0%)
  Completed full flow:         15  (75.0%)
  Aborted (Artillery):          2  (10.0%)
  Hand raised at peak:          5  (25.0%)

  By peak call state (before cleanup):
   ✓ CONNECTED                                       17  (85.0%)
   ✓ DISCONNECTED                                    15  (75.0%)
     AWAITING_MEETING_PIN                             2  (10.0%)
     NEVER_REACHED_DYNAMO                             1  ( 5.0%)
────────────────────────────────────────────────────────────────

  Participants that did not complete (5):
  attendeeId                 meetingId    peakCallState                  aborted
  ──────────────────────────────────────────────────────────────────────────────
  69debc9d...                456606437    AWAITING_MEETING_PIN           false
  ...

  Full report → data/run-report.json
```

Each run gets a unique `runId` (ISO timestamp). Subsequent Artillery runs append to `data/run-state.ndjson` — the report always uses the most recent run by default. To report a specific past run:

```bash
RUN_ID="2026-04-14T19:08:00.000Z" npm run report
```

### Report env vars

| Variable | Required | Default | Notes |
|---|---|---|---|
| `RUN_STATE_PATH` | No | `data/run-state.ndjson` | Written by Artillery's `afterScenario` hook |
| `REPORT_PATH` | No | `data/run-report.json` | Full JSON output |
| `RUN_ID` | No | most recent | Report a specific past run |

---

## npm scripts

| Command | Purpose |
|---|---|
| `npm run create-events` | Create events via GraphQL `createEvent`, write `data/registration-plan.json` |
| `npm run register-analysts` | Pre-register analysts, write `data/analysts-payload.csv` |
| `npm run report` | Post-run report (reads `data/run-state.ndjson`, no DynamoDB needed) |
| `npm test` | All Vitest unit tests (same as `npm run test:scripts`) |
| `npm run test:watch` | Vitest watch mode (same as `npm run test:scripts:watch`) |
| `npm run typecheck` | TypeScript check |
