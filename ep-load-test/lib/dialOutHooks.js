/**
 * All Artillery scenario hooks for PSTN dial-out (create leg → Dynamo waits → DTMF).
 * Wired once from hooks/dialOutProcessor.js.
 *
 * Artillery HTTP engine passes a no-arg `done` for `- function:` steps (it never propagates
 * `done(err)`). We use `events.emit('error', msg)` for aggregate stats / ensure, and
 * `__dialOutScenarioAborted` so later hooks skip side effects after a failure.
 */

const { randomUUID } = require("crypto");
const { recordDialOutScenarioFailure } = require("./dialOutLog.js");

function callCtxFromVars(v) {
  return {
    attendeeId: v.attendeeId,
    meetingId: String(v.meetingId ?? ""),
    correlationId: v.correlationId
  };
}

function createDialOutHooks({
  config,
  chime,
  dynamo,
  sleep,
  logJson,
  redactPin,
  getDialOutFlowDurationMs,
  emitDialOutFlowFailure
}) {
  function skipIfDialOutAborted(context, done) {
    if (context.vars.__dialOutScenarioAborted) {
      done();
      return true;
    }
    return false;
  }

  // --- 1. Outbound call (sets correlationId, transactionId, dialOutStartedAt)

  async function dialOutAnalyst(context, events, done) {
    delete context.vars.__dialOutScenarioAborted;
    const { attendeeId, pin, meetingId } = context.vars;
    const meetingIdStr = String(meetingId);
    const pinStr = String(pin);
    const startMs = Date.now();
    const correlationId = randomUUID();

    try {
      const createResponse = await chime.createOutboundCall(
        chime.buildCreateCallInput(
          correlationId,
          meetingIdStr,
          attendeeId,
          pinStr
        ),
        { attendeeId, meetingId: meetingIdStr }
      );

      const legTransactionId =
        chime.transactionIdFromCreateResponse(createResponse);
      context.vars.correlationId = correlationId;

      if (!legTransactionId) {
        const err = new Error(
          "CreateSipMediaApplicationCall returned no TransactionId; cannot call UpdateSipMediaApplicationCall"
        );
        logJson({
          lvl: "ERROR",
          evt: "ep.dialout.chime.create_missing_leg",
          msg: err.message,
          meetingId: meetingIdStr,
          attendeeId,
          correlationId
        });
        recordDialOutScenarioFailure(events, context, err);
        return done(err);
      }

      context.vars.transactionId = legTransactionId;
      context.vars.dialOutStartedAt = startMs;
      return done();
    } catch (error) {
      emitDialOutFlowFailure(events, context, error, Date.now() - startMs);
      return done(error);
    }
  }

  // --- 2. Dynamo: wait until participant row reaches target status

  async function waitOnDynamo(context, events, targetStatus, counterMetric) {
    const v = context.vars;
    if (!v.correlationId) {
      throw new Error(
        `Dial-out wait (${counterMetric}): context.vars.correlationId is required`
      );
    }
    const callCtx = callCtxFromVars(v);
    dynamo.logDynamoPollStart(targetStatus, callCtx);
    await dynamo.waitForStatus(String(v.correlationId), targetStatus);
    events.emit("counter", counterMetric, 1);
  }

  async function waitForAwaitingMeetingIdStatus(context, events, done) {
    if (skipIfDialOutAborted(context, done)) {
      return;
    }
    try {
      await waitOnDynamo(
        context,
        events,
        config.dynamo.statusAwaitingMeetingId,
        "dialout.dynamo.awaiting_meeting_id"
      );
      return done();
    } catch (err) {
      emitDialOutFlowFailure(events, context, err);
      return done(err);
    }
  }

  async function waitForAwaitingMeetingPinStatus(context, events, done) {
    if (skipIfDialOutAborted(context, done)) {
      return;
    }
    try {
      await waitOnDynamo(
        context,
        events,
        config.dynamo.statusAwaitingPin,
        "dialout.dynamo.awaiting_pin"
      );
      return done();
    } catch (err) {
      emitDialOutFlowFailure(events, context, err);
      return done(err);
    }
  }

  async function waitForConnectedStatus(context, events, done) {
    if (skipIfDialOutAborted(context, done)) {
      return;
    }
    try {
      await waitOnDynamo(
        context,
        events,
        config.dynamo.statusConnected,
        "dialout.dynamo.connected"
      );
      return done();
    } catch (err) {
      emitDialOutFlowFailure(events, context, err);
      return done(err);
    }
  }

  async function waitForDisconnectedStatus(context, events, done) {
    if (skipIfDialOutAborted(context, done)) {
      return;
    }
    try {
      await waitOnDynamo(
        context,
        events,
        config.dynamo.statusDisconnected,
        "dialout.dynamo.disconnected"
      );
      return done();
    } catch (err) {
      emitDialOutFlowFailure(events, context, err);
      return done(err);
    }
  }

  async function waitOnHandRaisedFlag(
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
    dynamo.logDynamoPollHandRaised(expectedBoolean, callCtx);
    await dynamo.waitForHandRaised(String(v.correlationId), expectedBoolean);
    events.emit("counter", counterMetric, 1);
  }

  // --- 3. Chime: send DTMF (meeting id #, pin #, optional *1/*9/*0 — events-streaming ParticipantInputDigits)

  async function sendMeetingIdDtmf(context, events, done) {
    if (skipIfDialOutAborted(context, done)) {
      return;
    }
    const v = context.vars;
    const meetingIdStr = String(v.meetingId ?? "");

    try {
      if (!v.transactionId) {
        const err = new Error(
          "sendMeetingIdDtmf: context.vars.transactionId is required (run dialOutAnalyst first)"
        );
        recordDialOutScenarioFailure(events, context, err);
        return done(err);
      }
      await chime.updateSipCall(
        v.transactionId,
        { loadTestDigits: `${meetingIdStr}#`, loadTestToneMs: "100" },
        callCtxFromVars(v)
      );
      events.emit("counter", "dialout.update.meeting_id_sent", 1);
      return done();
    } catch (error) {
      emitDialOutFlowFailure(events, context, error);
      return done(error);
    }
  }

  async function sendPinDtmf(context, events, done) {
    if (skipIfDialOutAborted(context, done)) {
      return;
    }
    const v = context.vars;
    const meetingIdStr = String(v.meetingId ?? "");
    const pinStr = String(v.pin ?? "");

    try {
      if (!v.transactionId) {
        const err = new Error(
          "sendPinDtmf: context.vars.transactionId is required (run dialOutAnalyst first)"
        );
        recordDialOutScenarioFailure(events, context, err);
        return done(err);
      }
      await sleep(3000);
      await chime.updateSipCall(
        v.transactionId,
        { loadTestDigits: `${pinStr}#`, loadTestToneMs: "100" },
        callCtxFromVars(v)
      );
      events.emit("counter", "dialout.update.pin_sent", 1);

      const durationMs = getDialOutFlowDurationMs(v);
      events.emit("counter", "dialout.calls.initiated", 1);
      events.emit("histogram", "dialout.call.setup_ms", durationMs);

      logJson({
        lvl: "INFO",
        evt: "ep.dialout.call.success",
        msg: "Outbound call + Dynamo-gated DTMF sequence completed",
        meetingId: meetingIdStr,
        attendeeId: v.attendeeId,
        correlationId: v.correlationId,
        pinRedacted: redactPin(pinStr),
        durationMs,
        dynamoGated: true
      });

      return done();
    } catch (error) {
      emitDialOutFlowFailure(events, context, error);
      return done(error);
    }
  }

  /** events-streaming `ParticipantInputDigits.PARTICIPANT_CONTROLS` (*9#). */
  async function sendParticipantControlsDtmf(context, events, done) {
    if (skipIfDialOutAborted(context, done)) {
      return;
    }
    const v = context.vars;

    try {
      if (!v.transactionId) {
        const err = new Error(
          "sendParticipantControlsDtmf: context.vars.transactionId is required (run dialOutAnalyst first)"
        );
        recordDialOutScenarioFailure(events, context, err);
        return done(err);
      }
      await chime.updateSipCall(
        v.transactionId,
        { loadTestDigits: "*9", loadTestToneMs: "100" },
        callCtxFromVars(v)
      );
      events.emit("counter", "dialout.update.participant_controls_sent", 1);
      return done();
    } catch (error) {
      emitDialOutFlowFailure(events, context, error);
      return done(error);
    }
  }

  /** events-streaming `ParticipantInputDigits.HUMAN_INTAKE` (*0#) when human-intake flag is on. */
  async function sendHumanIntakeDtmf(context, events, done) {
    if (skipIfDialOutAborted(context, done)) {
      return;
    }
    const v = context.vars;

    try {
      if (!v.transactionId) {
        const err = new Error(
          "sendHumanIntakeDtmf: context.vars.transactionId is required (run dialOutAnalyst first)"
        );
        recordDialOutScenarioFailure(events, context, err);
        return done(err);
      }
      await chime.updateSipCall(
        v.transactionId,
        { loadTestDigits: "*0", loadTestToneMs: "100" },
        callCtxFromVars(v)
      );
      events.emit("counter", "dialout.update.human_intake_sent", 1);
      return done();
    } catch (error) {
      emitDialOutFlowFailure(events, context, error);
      return done(error);
    }
  }

  async function waitForAfterParticipantControlsStatus(context, events, done) {
    if (skipIfDialOutAborted(context, done)) {
      return;
    }
    try {
      await waitOnDynamo(
        context,
        events,
        config.dynamo.statusAfterStarNine,
        "dialout.dynamo.after_participant_controls"
      );
      return done();
    } catch (err) {
      emitDialOutFlowFailure(events, context, err);
      return done(err);
    }
  }

  async function waitForAfterHumanIntakeStatus(context, events, done) {
    if (skipIfDialOutAborted(context, done)) {
      return;
    }
    try {
      await waitOnDynamo(
        context,
        events,
        config.dynamo.statusAfterStarZero,
        "dialout.dynamo.after_human_intake"
      );
      return done();
    } catch (err) {
      emitDialOutFlowFailure(events, context, err);
      return done(err);
    }
  }

  /** events-streaming `ParticipantInputDigits.TOGGLE_HAND` (*1#) — toggles `hand_raised` in Dynamo. */
  async function toggleHandDtmf(context, events, done) {
    if (skipIfDialOutAborted(context, done)) {
      return;
    }
    const v = context.vars;

    try {
      if (!v.transactionId) {
        const err = new Error(
          "toggleHandDtmf: context.vars.transactionId is required (run dialOutAnalyst first)"
        );
        recordDialOutScenarioFailure(events, context, err);
        return done(err);
      }
      await chime.updateSipCall(
        v.transactionId,
        { loadTestDigits: "*1", loadTestToneMs: "100" },
        callCtxFromVars(v)
      );
      events.emit("counter", "dialout.update.toggle_hand_sent", 1);
      return done();
    } catch (error) {
      emitDialOutFlowFailure(events, context, error);
      return done(error);
    }
  }

  async function waitForHandRaised(context, events, done) {
    if (skipIfDialOutAborted(context, done)) {
      return;
    }
    try {
      await waitOnHandRaisedFlag(
        context,
        events,
        true,
        "dialout.dynamo.hand_raised_true"
      );
      return done();
    } catch (err) {
      emitDialOutFlowFailure(events, context, err);
      return done(err);
    }
  }

  async function waitForHandLowered(context, events, done) {
    if (skipIfDialOutAborted(context, done)) {
      return;
    }
    try {
      await waitOnHandRaisedFlag(
        context,
        events,
        false,
        "dialout.dynamo.hand_raised_false"
      );
      return done();
    } catch (err) {
      emitDialOutFlowFailure(events, context, err);
      return done(err);
    }
  }

  // --- 4. Hangup (UpdateSipMediaApplicationCall → SMA returns Hangup; then poll DISCONNECTED in Dynamo)

  async function hangUpDialOut(context, events, done) {
    if (skipIfDialOutAborted(context, done)) {
      return;
    }
    const v = context.vars;

    try {
      if (!v.transactionId) {
        const err = new Error(
          "hangUpDialOut: context.vars.transactionId is required (run dialOutAnalyst first)"
        );
        recordDialOutScenarioFailure(events, context, err);
        return done(err);
      }
      await chime.updateSipCall(
        v.transactionId,
        { loadTestHangup: "true" },
        callCtxFromVars(v)
      );
      events.emit("counter", "dialout.update.hangup_sent", 1);
      return done();
    } catch (error) {
      emitDialOutFlowFailure(events, context, error);
      return done(error);
    }
  }

  return {
    dialOutAnalyst,
    waitForAwaitingMeetingIdStatus,
    waitForAwaitingMeetingPinStatus,
    waitForConnectedStatus,
    waitForDisconnectedStatus,
    sendMeetingIdDtmf,
    sendPinDtmf,
    sendParticipantControlsDtmf,
    sendHumanIntakeDtmf,
    waitForAfterParticipantControlsStatus,
    waitForAfterHumanIntakeStatus,
    toggleHandDtmf,
    sendToggleHandDtmf: toggleHandDtmf,
    waitForHandRaised,
    waitForHandLowered,
    hangUpDialOut
  };
}

module.exports = { createDialOutHooks };
