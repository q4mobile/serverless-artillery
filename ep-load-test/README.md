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
- `duration × arrivalRate` in the YAML **exactly equals** the number of CSV rows

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
| `LOAD_TEST_TO_PHONE` | Yes | — | E.164 PSTN number the SMA answers on |
| `DIALOUT_PARTICIPANTS_TABLE_NAME` | Yes | — | Conference participants DynamoDB table name |
| `PRODUCTION_SMA_ID` | No | — | If set and matches `LOAD_TEST_SMA_ID`, processor refuses to start |
| `DIALOUT_POLL_TIMEOUT_MS` | No | `60000` | Max ms to wait per DynamoDB status poll |
| `DIALOUT_POLL_INTERVAL_MS` | No | `400` | DynamoDB poll interval in ms |
| `AWS_REGION` | No | `us-east-1` | AWS region for Chime and DynamoDB clients |

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

1. `duration × arrivalRate` (Artillery) equals CSV row count — otherwise the same attendee is dialled twice.
2. `DIALOUT_POLL_TIMEOUT_MS` ≥ `60000` when 5+ participants share one meeting — concurrent joins take longer to propagate through the GSI.
3. Lambda resource policy on `conferenceEventHandler` is present (see above).
4. Test SMA Lambda deployed and the SMA points to it.

---

## npm scripts

| Command | Purpose |
|---|---|
| `npm run register-analysts` | Pre-register analysts, write `data/analysts-payload.csv` |
| `npm test` | All Vitest unit tests |
| `npm run test:watch` | Vitest watch mode |
| `npm run typecheck` | TypeScript check |
