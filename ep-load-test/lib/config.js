/**
 * Dial-out Artillery processor: env → config object + validation.
 * See ../types/dialOut.ts and README for variable names.
 *
 * Dynamo shape, correlation GSI, SIP correlation header, and call-connection values match
 * events-streaming (fixed literals, not env).
 */

function normalizeSmaId(raw) {
  const s = String(raw || "").trim();
  if (!s) {
    return "";
  }
  const lower = s.toLowerCase();
  return lower.startsWith("sma-") ? s.slice(4) : s;
}

function readEnvTrim(key, fallback = "") {
  return String(process.env[key] ?? fallback).trim();
}

function loadConfig() {
  const productionRaw = readEnvTrim("PRODUCTION_SMA_ID");
  return {
    region: readEnvTrim("AWS_REGION", "us-east-1") || "us-east-1",
    smaId: normalizeSmaId(readEnvTrim("LOAD_TEST_SMA_ID")),
    fromPhone: readEnvTrim("LOAD_TEST_FROM_PHONE"),
    toPhone: readEnvTrim("LOAD_TEST_TO_PHONE"),
    productionSmaId: productionRaw
      ? normalizeSmaId(productionRaw)
      : undefined,
    dynamo: {
      tableName: readEnvTrim("DIALOUT_PARTICIPANTS_TABLE_NAME"),
      statusAttr: "call_connection_state",
      handRaisedAttr: "hand_raised",
      pollTimeoutMs: parseInt(
        readEnvTrim("DIALOUT_POLL_TIMEOUT_MS", "60000"),
        10
      ),
      pollIntervalMs: parseInt(
        readEnvTrim("DIALOUT_POLL_INTERVAL_MS", "400"),
        10
      ),
      statusAwaitingMeetingId: "AWAITING_MEETING_ID",
      statusAwaitingPin: "AWAITING_MEETING_PIN",
      statusConnected: "CONNECTED",
      statusDisconnected: "DISCONNECTED",
      // *9 (PARTICIPANT_CONTROLS): call_connection_state usually stays CONNECTED
      statusAfterStarNine: "CONNECTED",
      // *0 + human intake when LEG_B connected; else events-streaming may use TRANSFERRING_TO_SUPPORT
      statusAfterStarZero: "INITIATE_TRANSFER_FROM_CHIME_TO_SUPPORT",
      correlationGsi: "correlation_id-index",
      correlationAttr: "correlation_id"
    },
    correlationIdHeader: "X-Correlation-Id"
  };
}

function validateConfig(cfg) {
  const { smaId, fromPhone, toPhone, dynamo } = cfg;
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
  if (!dynamo.tableName) {
    throw new Error(
      "DIALOUT_PARTICIPANTS_TABLE_NAME is required — Dynamo-gated dial-out only; " +
        "set the conference participants DynamoDB table name (e.g. events-streaming...conference-participants-dev)."
    );
  }
  if (cfg.productionSmaId && smaId === cfg.productionSmaId) {
    throw new Error(
      `FATAL: LOAD_TEST_SMA_ID (${smaId}) matches PRODUCTION_SMA_ID — ` +
        "refusing to route test traffic through production SMA"
    );
  }
}

module.exports = {
  loadConfig,
  validateConfig
};
