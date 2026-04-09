/**
 * Structured JSON logging for dial-out Artillery processor.
 *
 * Artillery HTTP engine ignores `done(err)` for `- function:` steps (it always continues the
 * scenario). The runner only increments aggregate errors when the scenario emitter receives
 * `emit('error', message)` — see notifyArtilleryScenarioError below.
 */

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
  const s = String(pin);
  return s.length >= 2 ? `****${s.slice(-2)}` : "****";
}

function notifyArtilleryScenarioError(events, error) {
  if (!events || typeof events.emit !== "function") {
    return;
  }
  events.emit("error", error.message || String(error));
}

/** Artillery HTTP `- function:` steps ignore `done(err)`; also mark vars so later hooks skip I/O. */
function recordDialOutScenarioFailure(events, context, error) {
  notifyArtilleryScenarioError(events, error);
  context.vars.__dialOutScenarioAborted = true;
}

function getDialOutFlowDurationMs(vars, fallbackStartMs) {
  const start = vars.dialOutStartedAt;
  if (typeof start === "number") {
    return Date.now() - start;
  }
  if (typeof fallbackStartMs === "number") {
    return Date.now() - fallbackStartMs;
  }
  return Date.now();
}

function emitDialOutFlowFailure(events, context, error, durationMs) {
  recordDialOutScenarioFailure(events, context, error);
  const v = context.vars;
  const meetingIdStr = String(v.meetingId ?? "");
  const pinStr = String(v.pin ?? "");
  const resolvedDurationMs =
    typeof durationMs === "number"
      ? durationMs
      : getDialOutFlowDurationMs(v);
  events.emit("counter", "dialout.calls.failed", 1);
  events.emit("histogram", "dialout.call.setup_ms", resolvedDurationMs);
  logJson({
    lvl: "ERROR",
    evt: "ep.dialout.call.failed",
    msg: error.message || "Outbound call failed",
    meetingId: meetingIdStr,
    attendeeId: v.attendeeId,
    correlationId: v.correlationId,
    pinRedacted: redactPin(pinStr),
    durationMs: resolvedDurationMs,
    err: { type: error.name || "Error", msg: error.message }
  });
}

function logDialOutProcessorLoaded(config) {
  logJson({
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
  logJson,
  redactPin,
  getDialOutFlowDurationMs,
  notifyArtilleryScenarioError,
  recordDialOutScenarioFailure,
  emitDialOutFlowFailure,
  logDialOutProcessorLoaded
};
