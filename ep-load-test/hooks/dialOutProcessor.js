/**
 * Artillery processor: originates one outbound PSTN call per virtual user
 * via CreateSipMediaApplicationCallCommand (Chime SDK Voice).
 * Payload / hook shape: see ../types/dialOut.ts (TS only).
 *
 * Each VU reads attendeeId / pin / meetingId from the CSV payload and combines
 * them with env-var SMA config to build the call.
 *
 * Required env vars: LOAD_TEST_SMA_ID, LOAD_TEST_FROM_PHONE, LOAD_TEST_TO_PHONE.
 * Optional: PRODUCTION_SMA_ID (production guard), AWS_REGION (default us-east-1).
 */

const {
  ChimeSDKVoiceClient,
  CreateSipMediaApplicationCallCommand
} = require("@aws-sdk/client-chime-sdk-voice");
const { fullJitterBackoffMs } = require("../lib/fullJitterBackoff.js");

/** Full jitter; cap limits worst-case sleep under throttling (see ep-load-test README). */
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 8000;
const MAX_RETRIES = 3;

const smaId = (process.env.LOAD_TEST_SMA_ID || "").trim();
const fromPhone = (process.env.LOAD_TEST_FROM_PHONE || "").trim();
const toPhone = (process.env.LOAD_TEST_TO_PHONE || "").trim();
const productionSmaId = (process.env.PRODUCTION_SMA_ID || "").trim() || undefined;
const region = (process.env.AWS_REGION || "").trim() || "us-east-1";

if (!smaId) {
  throw new Error(
    "LOAD_TEST_SMA_ID is required (dedicated test SIP Media Application ID)"
  );
}
if (!fromPhone) {
  throw new Error(
    "LOAD_TEST_FROM_PHONE is required (E.164 caller ID, e.g. +14155551234)"
  );
}
if (!toPhone) {
  throw new Error(
    "LOAD_TEST_TO_PHONE is required (E.164 PSTN number the SMA answers on)"
  );
}
if (productionSmaId && smaId === productionSmaId) {
  throw new Error(
    `FATAL: LOAD_TEST_SMA_ID (${smaId}) matches PRODUCTION_SMA_ID — ` +
      "refusing to route test traffic through production SMA"
  );
}

const client = new ChimeSDKVoiceClient({ region });

logJson({
  lvl: "INFO",
  evt: "ep.dialout.processor.loaded",
  msg: "Dial-out Artillery processor initialised",
  loadTestSmaId: smaId,
  region
});

function logJson(record) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    svc: "ep-load-test",
    env: process.env.NODE_ENV || "development",
    ...record
  });
  process.stdout.write(line + "\n");
}

function redactPin(pin) {
  return String(pin).length >= 2
    ? `****${String(pin).slice(-2)}`
    : "****";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithRetry(input, context) {
  const { attendeeId, meetingId, pin } = context;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const command = new CreateSipMediaApplicationCallCommand(input);
      return await client.send(command);
    } catch (error) {
      const isThrottled =
        error.name === "TooManyRequestsException" ||
        error.name === "ThrottledClientException";

      if (isThrottled && attempt < MAX_RETRIES) {
        const backoffMs = fullJitterBackoffMs(attempt, {
          initialMs: INITIAL_BACKOFF_MS,
          maxMs: MAX_BACKOFF_MS
        });
        logJson({
          lvl: "WARN",
          evt: "ep.dialout.call.throttled",
          msg: "Throttled by Chime SDK, retrying",
          meetingId,
          attendeeId,
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          backoffMs
        });
        await sleep(backoffMs);
        continue;
      }
      throw error;
    }
  }
}

/**
 * Artillery `function:` step — originates one PSTN call for the current VU's analyst.
 *
 * Reads `attendeeId`, `pin`, `meetingId` from `context.vars` (CSV payload).
 * Sets `context.vars.transactionId` on success for use in subsequent steps.
 */
const dialOutAnalyst = async (context, events, done) => {
  const { attendeeId, pin, meetingId } = context.vars;
  const meetingIdStr = String(meetingId);
  const pinStr = String(pin);
  const startMs = Date.now();

  const input = {
    SipMediaApplicationId: smaId,
    FromPhoneNumber: fromPhone,
    ToPhoneNumber: toPhone,
    SipHeaders: {
      "X-Meeting-Id": meetingIdStr,
      "X-Attendee-Id": attendeeId
    },
    ArgumentsMap: {
      meetingId: meetingIdStr,
      pin: pinStr,
      attendeeId
    }
  };

  try {
    const response = await sendWithRetry(input, {
      attendeeId,
      meetingId: meetingIdStr,
      pin: pinStr
    });
    const transactionId =
      response.SipMediaApplicationCall?.TransactionId ?? "";
    context.vars.transactionId = transactionId;

    const durationMs = Date.now() - startMs;
    events.emit("counter", "dialout.calls.initiated", 1);
    events.emit("histogram", "dialout.call.setup_ms", durationMs);

    logJson({
      lvl: "INFO",
      evt: "ep.dialout.call.success",
      msg: "Outbound PSTN call initiated",
      meetingId: meetingIdStr,
      attendeeId,
      transactionId,
      pinRedacted: redactPin(pinStr),
      durationMs
    });

    return done();
  } catch (error) {
    const durationMs = Date.now() - startMs;
    events.emit("counter", "dialout.calls.failed", 1);
    events.emit("histogram", "dialout.call.setup_ms", durationMs);

    logJson({
      lvl: "ERROR",
      evt: "ep.dialout.call.failed",
      msg: error.message || "Outbound call failed",
      meetingId: meetingIdStr,
      attendeeId,
      pinRedacted: redactPin(pinStr),
      durationMs,
      err: { type: error.name || "Error", msg: error.message }
    });

    return done(error);
  }
};

module.exports = { dialOutAnalyst };
