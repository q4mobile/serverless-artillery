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

Outbound PSTN calls are driven by `serverless-artillery invoke` using [tests/dial-out-payload-example.yml](tests/dial-out-payload-example.yml), which loads **`data/analysts-payload.csv`** (from `npm run register-analysts`) and runs [hooks/dialOutProcessor.js](hooks/dialOutProcessor.js). The processor calls `CreateSipMediaApplicationCallCommand` once per virtual user and passes `meetingId`, `pin`, and `attendeeId` via `SipHeaders` and `ArgumentsMap` to the test SMA Lambda.

**Flow:** pre-register analysts → set env vars → deploy worker Lambda → invoke test from `ep-load-test`:

Tune `config.phases` so `duration × arrivalRate` matches your CSV row count and Chime TPS limits.

### Actual run command (`serverless-artillery` deploy/invoke)

Set dial-out env vars on **deploy** so they are baked into the worker Lambda environment:

```bash
cd ep-load-test
LOAD_TEST_SMA_ID="sma-xxxxxxxx" \
LOAD_TEST_FROM_PHONE="+14155551234" \
LOAD_TEST_TO_PHONE="+14155559999" \
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

The processor logs `LOAD_TEST_SMA_ID` on load. PINs are redacted in logs (last two digits only).

### Retry and IAM implementation notes

- **Retry jitter:** both `hooks/dialOutProcessor.js` and `scripts/register-analysts.ts` use exponential backoff with **full jitter** for transient retries, via shared helper [`lib/fullJitterBackoff.js`](lib/fullJitterBackoff.js). Instead of synchronized fixed waits (`1s`, `2s`, `4s`), each retry sleeps a random duration in `[0, backoffCap]` to reduce retry storms during throttling events.
- **Dial-out types:** TypeScript types for the Artillery hook (`context.vars`, `events.emit`, `done`) live in [`types/dialOut.ts`](types/dialOut.ts) for IDE support and tests; the runtime processor stays plain JS.
- **Dial-out IAM scope:** `serverless.yml` grants only `chime:CreateSipMediaApplicationCall` and scopes `Resource` to the dedicated load-test SMA ARN derived from `LOAD_TEST_SMA_ID` (`arn:aws:chime:*:*:sma/<id>` — this must match the resource ARN in `AccessDenied` errors, not `sip-media-application/...`). This keeps load traffic constrained to the test SMA and follows least-privilege principles.
