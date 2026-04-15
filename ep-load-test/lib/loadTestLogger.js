/**
 * Structured JSON logging for dial-out Artillery processor.
 *
 * Artillery HTTP engine ignores `done(err)` for `- function:` steps (it always continues the
 * scenario). The runner only increments aggregate errors when the scenario emitter receives
 * `emit('error', message)` — see emitError below.
 */

function log(record) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    svc: "ep-load-test",
    env: process.env.NODE_ENV || "development",
    ...record
  });
  process.stdout.write(line + "\n");
}

function maskPin(pin) {
  const s = String(pin);
  return s.length >= 2 ? `****${s.slice(-2)}` : "****";
}

function emitError(events, error) {
  if (!events || typeof events.emit !== "function") {
    return;
  }
  events.emit("error", error.message || String(error));
}

/** Artillery HTTP `- function:` steps ignore `done(err)`; also mark vars so later hooks skip I/O. */
function markFailed(events, context, error) {
  emitError(events, error);
  context.vars.__dialOutScenarioAborted = true;
}

function elapsedMs(vars, fallbackStartMs) {
  const start = vars.dialOutStartedAt;
  if (typeof start === "number") {
    return Date.now() - start;
  }
  if (typeof fallbackStartMs === "number") {
    return Date.now() - fallbackStartMs;
  }
  return Date.now();
}

function failScenario(events, context, error, durationMs) {
  markFailed(events, context, error);
  const v = context.vars;
  const meetingIdStr = String(v.meetingId ?? "");
  const pinStr = String(v.pin ?? "");
  const resolvedDurationMs =
    typeof durationMs === "number"
      ? durationMs
      : elapsedMs(v);
  events.emit("counter", "dialout.calls.failed", 1);
  events.emit("histogram", "dialout.call.setup_ms", resolvedDurationMs);
  log({
    lvl: "ERROR",
    evt: "ep.dialout.call.failed",
    msg: error.message || "Outbound call failed",
    meetingId: meetingIdStr,
    attendeeId: v.attendeeId,
    correlationId: v.correlationId,
    pinRedacted: maskPin(pinStr),
    durationMs: resolvedDurationMs,
    err: { type: error.name || "Error", msg: error.message }
  });
}

/**
 * @param {string} targetStatus
 * @param {{ correlationId: string, meetingId: string, attendeeId: string }} ctx
 */
function logPolling(targetStatus, ctx) {
  log({
    lvl: "INFO",
    evt: "ep.dialout.dynamo.poll_start",
    msg: "DynamoDB poll: waiting for call_connection_state",
    meetingId: ctx.meetingId,
    attendeeId: ctx.attendeeId,
    correlationId: ctx.correlationId,
    targetStatus
  });
}

/**
 * @param {boolean} expectedBoolean
 * @param {{ correlationId: string, meetingId: string, attendeeId: string }} ctx
 */
function logPollingHandFlag(expectedBoolean, ctx) {
  log({
    lvl: "INFO",
    evt: "ep.dialout.dynamo.poll_start_hand_raised",
    msg: "DynamoDB poll: waiting for hand_raised flag",
    meetingId: ctx.meetingId,
    attendeeId: ctx.attendeeId,
    correlationId: ctx.correlationId,
    targetHandRaised: expectedBoolean
  });
}

function logStartup(config) {
  log({
    lvl: "INFO",
    evt: "ep.dialout.processor.loaded",
    msg:
      "Dial-out processor: Dynamo correlation GSI poll + UpdateSipMediaApplicationCall (TransactionId from create only)",
    loadTestSmaId: config.smaId,
    region: config.region,
    dynamoTableName: config.dynamo.tableName,
    correlationIdHeader: config.correlationIdHeader,
    dynamoCorrelationGsi: config.dynamo.correlationGsi,
    dynamoQueryPartitionKeyAttr: config.dynamo.correlationAttr
  });
}

module.exports = {
  log,
  maskPin,
  elapsedMs,
  emitError,
  markFailed,
  failScenario,
  logPolling,
  logPollingHandFlag,
  logStartup
};
