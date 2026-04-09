To run load test

1. Install deps: `npm i`
2. Deploy lambda: `../bin/serverless-artillery deploy`
3. Run script, for example: `../bin/serverless-artillery invoke -p tests/attendee-rest-dev.yml`

## Analyst pre-registration (Chime / PSTN load prep)

**Node.js 18+** is required (`global fetch`).

One-shot script that registers virtual analysts via the Events Platform Attendee REST API, captures cleartext PINs (only returned at creation time), and writes **`data/analysts-payload.csv`** for Artillery **`config.payload`** (CSV data rows only, no header; Artillery 1.x in this package parses payloads with `csv-parse`).

Meetings are chosen from **exactly one** of these sources (setting more than one of `MEETING_ID`, `MEETING_IDS`, or `REGISTRATION_PLAN_PATH` fails fast with a clear error):

1. **`MEETING_ID`** — single meeting.
2. **`MEETING_IDS`** — comma-separated ids; count per meeting from **`ANALYST_COUNT_PER_MEETING`** or **`ANALYST_COUNT`** (default 225).
3. **`REGISTRATION_PLAN_PATH`** — optional path to a JSON plan (relative to cwd or absolute).
4. **Default plan file** — if none of the above env-driven sources apply and **`data/registration-plan.json`** exists under the current working directory, it is loaded. Copy from [data/registration-plan.example.json](data/registration-plan.example.json) to get started.

Plan format: top-level array of `{ "meetingId", "analystCount", "registrationPassword"? }`, or `{ "meetings": [ ... ] }`. Per-meeting `registrationPassword` overrides `ANALYST_REGISTRATION_PASSWORD` for that meeting only.

For each meeting the script calls **`GET /auth/token/{meetingId}`** once, then registers that meeting’s analysts. All rows are merged into **one** CSV (each row includes its `meetingId`).

Run this **before** `artillery run` for scenarios that need one row per virtual user.

```bash
cd ep-load-test
MEETING_ID=359887660 npm run register-analysts
# or
MEETING_IDS=111,222,333 ANALYST_COUNT_PER_MEETING=10 npm run register-analysts
# or
REGISTRATION_PLAN_PATH=./data/registration-plan.example.json npm run register-analysts
# or (no meeting env vars) after copying example to data/registration-plan.json:
cp data/registration-plan.example.json data/registration-plan.json
npm run register-analysts
```

### Environment variables

| Variable | Required | Default | Notes |
|----------|----------|---------|--------|
| `MEETING_ID` | No† | — | Single meeting id (highest precedence) |
| `MEETING_IDS` | No† | — | Comma-separated meeting ids |
| `REGISTRATION_PLAN_PATH` | No† | — | JSON plan path; overrides default file when set |
| `ANALYST_COUNT` | No | `225` | Single-meeting count, or per-meeting count when using `MEETING_IDS` |
| `ANALYST_COUNT_PER_MEETING` | No | — | When using `MEETING_IDS`, overrides `ANALYST_COUNT` for each id |
| `EP_API_BASE_URL` | No | `https://attendees.dev.events.q4inc.com/rest/v1` | REST base URL (no trailing slash) |
| `ANALYST_REGISTRATION_PASSWORD` | No | — | **Secret.** Default analyst password when a plan entry omits `registrationPassword` |
| `REGISTRATION_DELAY_MS` | No | `50` | Delay between successive registration requests (entire run) |
| `REGISTRATION_FETCH_TIMEOUT_MS` | No | `0` | Per-request `fetch` timeout in ms (`AbortSignal.timeout`); `0` disables |
| `OUTPUT_PATH` | No | `data/analysts-payload.csv` | Artillery CSV payload path (relative to current working directory) |

† You must end up with a valid source: `MEETING_ID`, `MEETING_IDS`, `REGISTRATION_PLAN_PATH`, or an existing **`data/registration-plan.json`**.

Logs are **structured JSON lines** on stdout. PINs are redacted in logs (last two digits only). Do **not** commit generated CSV or local plans with secrets; see `.gitignore`.

### Scripts

| Command | Purpose |
|---------|---------|
| `npm run register-analysts` | Pre-register analysts and write Artillery CSV payload |
| `npm run test:scripts` | Unit tests (Vitest) for registration script |
| `npm run test:scripts:watch` | Vitest watch mode |
| `npm run typecheck` | TypeScript check |

## PSTN dial-out (`serverless-artillery` + Chime SMA)

### Test SMA (Terraform)

To create a **dedicated load-test** SIP Media Application and minimal handler Lambda in AWS, apply the stack under [../.deploy/chime-load-test-sma/README.md](../.deploy/chime-load-test-sma/README.md). Copy `sip_media_application_id` from Terraform outputs into `LOAD_TEST_SMA_ID`.

Outbound PSTN calls use [tests/dial-out-payload-example.yml](tests/dial-out-payload-example.yml) and [hooks/dialOutProcessor.js](hooks/dialOutProcessor.js). **Only Dynamo-gated DTMF is supported:** `CreateSipMediaApplicationCall` with `loadTestDynamoGated=true`, then **read-only** **`Query`** on the **`correlation_id`** GSI against **`DIALOUT_PARTICIPANTS_TABLE_NAME`** until `AWAITING_MEETING_ID` / `AWAITING_MEETING_PIN`, then **`UpdateSipMediaApplicationCall`** on the load-test SMA so the Lambda handles **`CALL_UPDATE_REQUESTED`** with `SendDigits` ([`.deploy/chime-load-test-sma/lambda_src/index.js`](../.deploy/chime-load-test-sma/lambda_src/index.js)). Chime **`TransactionId`** appears **only** as the parameter to **`UpdateSipMediaApplicationCall`**; it is taken **only** from **`CreateSipMediaApplicationCall`** (not from DynamoDB).

Each outbound call sends a fresh **correlation id** (UUID) in SIP header **`X-Correlation-Id`** (same as **events-streaming** `DIGITAL_CALL_HEADER.X_Correlation_Id`); the value is **`context.vars.correlationId`**. **events-streaming** stores it as attribute **`correlation_id`** on the participant item (participant **`id`** stays a separate UUID). The conference-participants table must expose GSI **`correlation_id-index`** on partition key **`correlation_id`** (see **`lib/dialOutConfig.js`**). Apply the DynamoDB Terraform in **events-streaming** so the GSI exists before running dial-out.

**GSI reads** are eventually consistent; the worker already polls in a loop, which covers normal replication lag.

**Flow:** pre-register analysts → set env vars (including **`DIALOUT_PARTICIPANTS_TABLE_NAME`**) → deploy worker Lambda → deploy/update test SMA Lambda → invoke from `ep-load-test`:

Optional steps after **`waitForConnectedStatus`**: **`sendParticipantControlsDtmf`** / **`waitForAfterParticipantControlsStatus`** (participant-controls menu, **`*9#`**), then **`sendHumanIntakeDtmf`** / **`waitForAfterHumanIntakeStatus`** (operator intake, **`*0#`** when human intake is enabled), mirroring **events-streaming** `ParticipantInputDigits`. Hardcoded values in **`lib/dialOutConfig.js`** match **`CallConnectionStates`**: **`CONNECTED`** after *9 (call-connection state usually unchanged), **`INITIATE_TRANSFER_FROM_CHIME_TO_SUPPORT`** after *0 when the analyst meeting leg is connected. If **`IS_ANALYST_CONNECTED_TO_CALL`** is false, **events-streaming** may write **`TRANSFERRING_TO_SUPPORT`** instead — change **`statusAfterStarZero`** in **`lib/dialOutConfig.js`** for that branch.

**Toggle hand:** **`toggleHandDtmf`** sends **`*1#`** (events-streaming **`ParticipantInputDigits.TOGGLE_HAND`**). It flips **`hand_raised`** on the participant item — use **`waitForHandRaised`** after a toggle when you expect the hand up, and **`waitForHandLowered`** when you expect it down. Those hooks poll the **`hand_raised`** attribute (not **`call_connection_state`**). Alias: **`sendToggleHandDtmf`** (same as **`toggleHandDtmf`**).

Tune `config.phases` so `duration × arrivalRate` matches your CSV row count and Chime TPS limits.

### Actual run command (`serverless-artillery` deploy/invoke)

Set dial-out env vars on **deploy** so they are baked into the worker Lambda environment:

```bash
cd ep-load-test
LOAD_TEST_SMA_ID="sma-xxxxxxxx" \
LOAD_TEST_FROM_PHONE="+14155551234" \
LOAD_TEST_TO_PHONE="+14155559999" \
DIALOUT_PARTICIPANTS_TABLE_NAME="events-streaming-serverless-conference-participants-dev" \
PRODUCTION_SMA_ID="sma-prod-xxxxxxxx" \
../bin/serverless-artillery deploy

../bin/serverless-artillery invoke -p tests/dial-out-payload-example.yml
```

`AWS_REGION` is reserved by Lambda and must not be set under `serverless.yml` function environment.
Region still resolves at runtime from Lambda (`AWS_REGION`) or falls back to `us-east-1` in the hook.

### Environment variables (dial-out processor)

| Variable | Required | Default | Notes |
|----------|----------|---------|--------|
| `LOAD_TEST_SMA_ID` | Yes | — | **Secret.** Dedicated **test** SIP Media Application ID — **never** the production SMA |
| `LOAD_TEST_FROM_PHONE` | Yes | — | **Secret.** E.164 caller ID (e.g. `+14155551234`) |
| `LOAD_TEST_TO_PHONE` | Yes | — | **Secret.** E.164 PSTN number the SMA answers on |
| `AWS_REGION` | No | `us-east-1` | Region for `ChimeSDKVoiceClient` |
| `PRODUCTION_SMA_ID` | No | — | If set and equals `LOAD_TEST_SMA_ID`, the processor throws on load (blocks accidental production SMA) |
| `DIALOUT_PARTICIPANTS_TABLE_NAME` | **Yes** | — | Conference participants table (read-only `Query` on correlation GSI); processor fails at load if unset. |
| `DIALOUT_POLL_TIMEOUT_MS` | No | `20000` | Max wait per status. |
| `DIALOUT_POLL_INTERVAL_MS` | No | `400` | Poll interval. |

**Not env:** SIP correlation header (**`X-Correlation-Id`**), Dynamo correlation GSI (**`correlation_id-index`** / **`correlation_id`**), participant field names (**`call_connection_state`**, **`hand_raised`**), and **`CallConnectionStates`** strings used by wait hooks are fixed in **`lib/dialOutConfig.js`** to match **events-streaming**.

The processor logs `LOAD_TEST_SMA_ID` on load. PINs are redacted in logs (last two digits only).

**Artillery `function` steps:** the bundled HTTP engine does not propagate `done(err)` for `- function:` flow steps, so dial-out hooks call `events.emit('error', message)` (and set `__dialOutScenarioAborted`) so aggregate errors and `ensure.maxErrorRate` reflect real failures.

### Retry and IAM implementation notes

- **Retry jitter:** both `hooks/dialOutProcessor.js` and `scripts/register-analysts.ts` use exponential backoff with **full jitter** for transient retries, via shared helper [`lib/fullJitterBackoff.js`](lib/fullJitterBackoff.js). Instead of synchronized fixed waits (`1s`, `2s`, `4s`), each retry sleeps a random duration in `[0, backoffCap]` to reduce retry storms during throttling events.
- **Dial-out types:** TypeScript types for the Artillery hook (`context.vars`, `events.emit`, `done`) live in [`types/dialOut.ts`](types/dialOut.ts) for IDE support and tests; the runtime processor stays plain JS.
- **Dial-out IAM scope:** `serverless.yml` grants `chime:CreateSipMediaApplicationCall` and `chime:UpdateSipMediaApplicationCall` on the load-test SMA ARN, plus `dynamodb:Query` (template uses `Resource: '*'` — restrict to your participant table ARN and its indexes). Chime `Resource` must use `arn:aws:chime:*:*:sma/<id>` as in `AccessDenied` messages.
