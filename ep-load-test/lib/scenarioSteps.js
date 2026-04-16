/**
 * All Artillery scenario hooks for PSTN dial-out (create leg → Dynamo waits → DTMF).
 * Wired once from hooks/dialOutProcessor.js.
 *
 * Artillery HTTP engine passes a no-arg `done` for `- function:` steps (it never propagates
 * `done(err)`). We use `events.emit('error', msg)` for aggregate stats / ensure, and
 * `__dialOutScenarioAborted` so later hooks skip side effects after a failure.
 */

const { randomUUID } = require("crypto");
const { appendFileSync, mkdirSync } = require("fs");
const { resolve, dirname } = require("path");
const { markFailed } = require("./loadTestLogger.js");

// Single run id shared across all VUs in this Artillery process.
const RUN_ID = new Date().toISOString();

function runStatePath() {
  return resolve(process.cwd(), process.env.RUN_STATE_PATH || "data/run-state.ndjson");
}

/**
 * Artillery afterScenario hook — appends one JSON line per participant to run-state.ndjson.
 * Peak state is captured in scenario vars during the flow; `npm run report` reads this file only (no DynamoDB).
 */
function saveParticipantResult(context, events, done) {
  const v = context.vars;
  const record = JSON.stringify({
    runId: RUN_ID,
    attendeeId: v.attendeeId,
    correlationId: v.correlationId,
    meetingId: v.meetingId,
    aborted: Boolean(v.__dialOutScenarioAborted),
    peakCallState: v.__peakCallState ?? null,
    peakHandRaised: v.__peakHandRaised ?? null
  });
  try {
    const p = runStatePath();
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, record + "\n", "utf8");
  } catch (err) {
    console.warn("[ep-load-test] saveParticipantResult: could not write run state:", err.message);
  }
  return done();
}

function callCtxFromVars(v) {
  return {
    attendeeId: v.attendeeId,
    meetingId: String(v.meetingId ?? ""),
    correlationId: v.correlationId
  };
}

function createSteps({
  config,
  chime,
  dynamo,
  sleep,
  log,
  maskPin,
  elapsedMs,
  failScenario
}) {
  // Guard against duplicate calls to the same attendee.
  // Artillery's payload order: sequence ensures each row is used once, but if total
  // scenario starts across phases exceed CSV data rows the sequence wraps and the same
  // attendeeId is reused. We catch that here and fail the scenario early rather than placing
  // a second Chime call on a participant who is already on the line.
  const dialedAttendeeIds = new Set();

  function skipIfAborted(context, done) {
    if (context.vars.__dialOutScenarioAborted) {
      done();
      return true;
    }
    return false;
  }

  // --- 1. Outbound call (sets correlationId, transactionId, dialOutStartedAt)

  async function dialParticipant(context, events, done) {
    delete context.vars.__dialOutScenarioAborted;
    const { attendeeId, pin, meetingId } = context.vars;

    // Duplicate-dial guard: fail immediately if this attendeeId was already dialled
    // in this run. Root cause: total scenario starts in Artillery phases > CSV data rows.
    if (dialedAttendeeIds.has(attendeeId)) {
      const err = new Error(
        `Duplicate dial attempt for attendeeId=${attendeeId} — ` +
          "check that total starts in config.phases (e.g. sum of arrivalCount) does not exceed CSV data rows (900 for 4×225)"
      );
      log({
        lvl: "ERROR",
        evt: "ep.dialout.duplicate_dial",
        msg: err.message,
        attendeeId,
        meetingId: String(meetingId ?? "")
      });
      markFailed(events, context, err);
      return done(err);
    }
    const meetingIdStr = String(meetingId);
    const pinStr = String(pin);
    const startMs = Date.now();
    const correlationId = randomUUID();

    try {
      const createResponse = await chime.dialOut(
        chime.buildCallRequest(
          correlationId,
          meetingIdStr,
          attendeeId,
          pinStr
        ),
        { attendeeId, meetingId: meetingIdStr }
      );

      const legTransactionId =
        chime.extractTransactionId(createResponse);
      context.vars.correlationId = correlationId;

      if (!legTransactionId) {
        const err = new Error(
          "CreateSipMediaApplicationCall returned no TransactionId; cannot call UpdateSipMediaApplicationCall"
        );
        log({
          lvl: "ERROR",
          evt: "ep.dialout.chime.create_missing_leg",
          msg: err.message,
          meetingId: meetingIdStr,
          attendeeId,
          correlationId
        });
        markFailed(events, context, err);
        return done(err);
      }

      context.vars.transactionId = legTransactionId;
      context.vars.dialOutStartedAt = startMs;
      dialedAttendeeIds.add(attendeeId);
      return done();
    } catch (error) {
      failScenario(events, context, error, Date.now() - startMs);
      return done(error);
    }
  }

  // --- 2. Dynamo: wait until participant row reaches target status

  async function pollForStatus(context, events, targetStatus, counterMetric) {
    const v = context.vars;
    if (!v.correlationId) {
      throw new Error(
        `Dial-out wait (${counterMetric}): context.vars.correlationId is required`
      );
    }
    const callCtx = callCtxFromVars(v);
    dynamo.logPolling(targetStatus, callCtx);
    await dynamo.waitForCallStatus(String(v.correlationId), targetStatus);
    v.__peakCallState = targetStatus;
    events.emit("counter", counterMetric, 1);
  }

  async function waitForMeetingIdPrompt(context, events, done) {
    if (skipIfAborted(context, done)) {
      return;
    }
    try {
      await pollForStatus(
        context,
        events,
        config.dynamo.statusAwaitingMeetingId,
        "dialout.dynamo.awaiting_meeting_id"
      );
      return done();
    } catch (err) {
      failScenario(events, context, err);
      return done(err);
    }
  }

  async function waitForPinPrompt(context, events, done) {
    if (skipIfAborted(context, done)) {
      return;
    }
    try {
      await pollForStatus(
        context,
        events,
        config.dynamo.statusAwaitingPin,
        "dialout.dynamo.awaiting_pin"
      );
      return done();
    } catch (err) {
      failScenario(events, context, err);
      return done(err);
    }
  }

  async function waitForConnected(context, events, done) {
    if (skipIfAborted(context, done)) {
      return;
    }
    try {
      await pollForStatus(
        context,
        events,
        config.dynamo.statusConnected,
        "dialout.dynamo.connected"
      );
      return done();
    } catch (err) {
      failScenario(events, context, err);
      return done(err);
    }
  }

  async function waitForDisconnected(context, events, done) {
    if (skipIfAborted(context, done)) {
      return;
    }
    try {
      await pollForStatus(
        context,
        events,
        config.dynamo.statusDisconnected,
        "dialout.dynamo.disconnected"
      );
      return done();
    } catch (err) {
      failScenario(events, context, err);
      return done(err);
    }
  }

  async function pollForHandFlag(
    context,
    events,
    expectedBoolean,
    counterMetric
  ) {
    const v = context.vars;
    if (!v.correlationId) {
      throw new Error(
        `Dial-out wait (${counterMetric}): context.vars.correlationId is required`
      );
    }
    const callCtx = callCtxFromVars(v);
    dynamo.logPollingHandFlag(expectedBoolean, callCtx);
    await dynamo.waitForHandFlag(String(v.correlationId), expectedBoolean);
    v.__peakHandRaised = expectedBoolean;
    events.emit("counter", counterMetric, 1);
  }

  // --- 3. Chime: send DTMF (meeting id #, pin #, optional *1/*9/*0 — events-streaming ParticipantInputDigits)

  async function enterMeetingId(context, events, done) {
    if (skipIfAborted(context, done)) {
      return;
    }
    const v = context.vars;
    const meetingIdStr = String(v.meetingId ?? "");

    try {
      if (!v.transactionId) {
        const err = new Error(
          "enterMeetingId: context.vars.transactionId is required (run dialParticipant first)"
        );
        markFailed(events, context, err);
        return done(err);
      }
      await sleep(4000);
      await chime.sendSipUpdate(
        v.transactionId,
        { loadTestDigits: `${meetingIdStr}#`, loadTestToneMs: "200" },
        callCtxFromVars(v)
      );
      events.emit("counter", "dialout.update.meeting_id_sent", 1);
      return done();
    } catch (error) {
      failScenario(events, context, error);
      return done(error);
    }
  }

  async function enterPin(context, events, done) {
    if (skipIfAborted(context, done)) {
      return;
    }
    const v = context.vars;
    const meetingIdStr = String(v.meetingId ?? "");
    const pinStr = String(v.pin ?? "");

    try {
      if (!v.transactionId) {
        const err = new Error(
          "enterPin: context.vars.transactionId is required (run dialParticipant first)"
        );
        markFailed(events, context, err);
        return done(err);
      }
      await sleep(4000);
      await chime.sendSipUpdate(
        v.transactionId,
        { loadTestDigits: `${pinStr}#`, loadTestToneMs: "200" },
        callCtxFromVars(v)
      );
      events.emit("counter", "dialout.update.pin_sent", 1);

      const durationMs = elapsedMs(v);
      events.emit("counter", "dialout.calls.initiated", 1);
      events.emit("histogram", "dialout.call.setup_ms", durationMs);

      log({
        lvl: "INFO",
        evt: "ep.dialout.call.success",
        msg: "Outbound call + Dynamo-gated DTMF sequence completed",
        meetingId: meetingIdStr,
        attendeeId: v.attendeeId,
        correlationId: v.correlationId,
        pinRedacted: maskPin(pinStr),
        durationMs,
        dynamoGated: true
      });

      return done();
    } catch (error) {
      failScenario(events, context, error);
      return done(error);
    }
  }

  /** events-streaming `ParticipantInputDigits.PARTICIPANT_CONTROLS` (*9#). */
  async function sendParticipantControls(context, events, done) {
    if (skipIfAborted(context, done)) {
      return;
    }
    const v = context.vars;

    try {
      if (!v.transactionId) {
        const err = new Error(
          "sendParticipantControls: context.vars.transactionId is required (run dialParticipant first)"
        );
        markFailed(events, context, err);
        return done(err);
      }
      await chime.sendSipUpdate(
        v.transactionId,
        { loadTestDigits: "*9", loadTestToneMs: "100" },
        callCtxFromVars(v)
      );
      events.emit("counter", "dialout.update.participant_controls_sent", 1);
      return done();
    } catch (error) {
      failScenario(events, context, error);
      return done(error);
    }
  }

  /** events-streaming `ParticipantInputDigits.HUMAN_INTAKE` (*0#) when human-intake flag is on. */
  async function sendHumanIntake(context, events, done) {
    if (skipIfAborted(context, done)) {
      return;
    }
    const v = context.vars;

    try {
      if (!v.transactionId) {
        const err = new Error(
          "sendHumanIntake: context.vars.transactionId is required (run dialParticipant first)"
        );
        markFailed(events, context, err);
        return done(err);
      }
      await chime.sendSipUpdate(
        v.transactionId,
        { loadTestDigits: "*0", loadTestToneMs: "100" },
        callCtxFromVars(v)
      );
      events.emit("counter", "dialout.update.human_intake_sent", 1);
      return done();
    } catch (error) {
      failScenario(events, context, error);
      return done(error);
    }
  }

  async function waitAfterParticipantControls(context, events, done) {
    if (skipIfAborted(context, done)) {
      return;
    }
    try {
      await pollForStatus(
        context,
        events,
        config.dynamo.statusAfterStarNine,
        "dialout.dynamo.after_participant_controls"
      );
      return done();
    } catch (err) {
      failScenario(events, context, err);
      return done(err);
    }
  }

  async function waitAfterHumanIntake(context, events, done) {
    if (skipIfAborted(context, done)) {
      return;
    }
    try {
      await pollForStatus(
        context,
        events,
        config.dynamo.statusAfterStarZero,
        "dialout.dynamo.after_human_intake"
      );
      return done();
    } catch (err) {
      failScenario(events, context, err);
      return done(err);
    }
  }

  /** events-streaming `ParticipantInputDigits.TOGGLE_HAND` (*1#) — toggles `hand_raised` in Dynamo. */
  async function toggleHand(context, events, done) {
    if (skipIfAborted(context, done)) {
      return;
    }
    const v = context.vars;

    try {
      if (!v.transactionId) {
        const err = new Error(
          "toggleHand: context.vars.transactionId is required (run dialParticipant first)"
        );
        markFailed(events, context, err);
        return done(err);
      }
      await chime.sendSipUpdate(
        v.transactionId,
        { loadTestDigits: "*1", loadTestToneMs: "100" },
        callCtxFromVars(v)
      );
      events.emit("counter", "dialout.update.toggle_hand_sent", 1);
      return done();
    } catch (error) {
      failScenario(events, context, error);
      return done(error);
    }
  }

  async function waitForHandUp(context, events, done) {
    if (skipIfAborted(context, done)) {
      return;
    }
    try {
      await pollForHandFlag(
        context,
        events,
        true,
        "dialout.dynamo.hand_raised_true"
      );
      return done();
    } catch (err) {
      failScenario(events, context, err);
      return done(err);
    }
  }

  async function waitForHandDown(context, events, done) {
    if (skipIfAborted(context, done)) {
      return;
    }
    try {
      await pollForHandFlag(
        context,
        events,
        false,
        "dialout.dynamo.hand_raised_false"
      );
      return done();
    } catch (err) {
      failScenario(events, context, err);
      return done(err);
    }
  }

  // --- 4. Hangup (UpdateSipMediaApplicationCall → SMA returns Hangup; then poll DISCONNECTED in Dynamo)

  async function hangUp(context, events, done) {
    if (skipIfAborted(context, done)) {
      return;
    }
    const v = context.vars;

    try {
      if (!v.transactionId) {
        const err = new Error(
          "hangUp: context.vars.transactionId is required (run dialParticipant first)"
        );
        markFailed(events, context, err);
        return done(err);
      }
      await chime.sendSipUpdate(
        v.transactionId,
        { loadTestHangup: "true" },
        callCtxFromVars(v)
      );
      v.__dialOutCallHungUp = true;
      events.emit("counter", "dialout.update.hangup_sent", 1);
      return done();
    } catch (error) {
      failScenario(events, context, error);
      return done(error);
    }
  }

  async function hangUpOnError(context, events, done) {
    const v = context.vars;

    if (!v.__dialOutScenarioAborted || !v.transactionId || v.__dialOutCallHungUp) {
      return done();
    }

    log({
      lvl: "WARN",
      evt: "ep.dialout.cleanup.attempt",
      msg: "Scenario aborted with live Chime call — sending cleanup hangup",
      meetingId: String(v.meetingId ?? ""),
      attendeeId: v.attendeeId,
      correlationId: v.correlationId,
      transactionId: v.transactionId
    });

    try {
      await chime.sendSipUpdate(
        v.transactionId,
        { loadTestHangup: "true" },
        callCtxFromVars(v)
      );
      v.__dialOutCallHungUp = true;
      events.emit("counter", "dialout.cleanup.hangup_sent", 1);
      log({
        lvl: "INFO",
        evt: "ep.dialout.cleanup.success",
        msg: "Cleanup hangup sent — call will be terminated by SMA",
        meetingId: String(v.meetingId ?? ""),
        attendeeId: v.attendeeId,
        correlationId: v.correlationId
      });
    } catch (error) {
      // NotFoundException means Chime already ended the call (SMA hung it up
      // due to the same error). The desired state — call terminated — is already
      // reached, so treat this as informational, not an error.
      if (error.name === "NotFoundException") {
        v.__dialOutCallHungUp = true;
        events.emit("counter", "dialout.cleanup.already_gone", 1);
        log({
          lvl: "INFO",
          evt: "ep.dialout.cleanup.already_gone",
          msg: "Cleanup skipped — Chime transaction no longer exists (call already terminated)",
          meetingId: String(v.meetingId ?? ""),
          attendeeId: v.attendeeId,
          correlationId: v.correlationId,
          transactionId: v.transactionId
        });
      } else {
        events.emit("counter", "dialout.cleanup.hangup_failed", 1);
        log({
          lvl: "ERROR",
          evt: "ep.dialout.cleanup.failed",
          msg: `Cleanup hangup failed: ${error.message || String(error)}`,
          meetingId: String(v.meetingId ?? ""),
          attendeeId: v.attendeeId,
          correlationId: v.correlationId,
          transactionId: v.transactionId,
          err: { type: error.name || "Error", msg: error.message }
        });
      }
    }

    return done();
  }

  return {
    dialParticipant,
    waitForMeetingIdPrompt,
    waitForPinPrompt,
    waitForConnected,
    waitForDisconnected,
    enterMeetingId,
    enterPin,
    sendParticipantControls,
    sendHumanIntake,
    waitAfterParticipantControls,
    waitAfterHumanIntake,
    toggleHand,
    sendToggleHandDtmf: toggleHand,
    waitForHandUp,
    waitForHandDown,
    hangUp,
    hangUpOnError
  };
}

module.exports = { createSteps, saveParticipantResult };
