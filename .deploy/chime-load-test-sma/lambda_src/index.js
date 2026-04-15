/**
 * Chime SIP Media Application Lambda Event Handler for load test traffic.
 */

"use strict";

/**
 * @param {Record<string, unknown>} event
 * @returns {Record<string, unknown> | undefined}
 */
function firstParticipant(event) {
  const details = event.CallDetails;
  const participants = details && details.Participants;
  if (Array.isArray(participants) && participants.length > 0) {
    return participants[0];
  }
  return undefined;
}

/**
 * @param {Record<string, unknown> | undefined} participant
 * @returns {string}
 */
function participantDirection(participant) {
  if (
    participant &&
    typeof participant === "object" &&
    participant !== null &&
    "Direction" in participant
  ) {
    return String(participant.Direction);
  }
  return "";
}

/**
 * @param {Record<string, unknown> | undefined} participant
 * @returns {Record<string, string>}
 */
function hangupParameters(participant) {
  /** @type {Record<string, string>} */
  const params = { SipResponseCode: "0" };
  if (
    participant &&
    typeof participant === "object" &&
    participant !== null
  ) {
    if ("CallId" in participant && participant.CallId) {
      params.CallId = String(participant.CallId);
    }
    if ("ParticipantTag" in participant && participant.ParticipantTag) {
      params.ParticipantTag = String(participant.ParticipantTag);
    }
  }
  return params;
}

function emptyActionsResponse() {
  return { SchemaVersion: "1.0", Actions: [] };
}

/**
 * @param {Record<string, unknown> | undefined} participant
 */
function hangupResponse(participant) {
  return {
    SchemaVersion: "1.0",
    Actions: [{ Type: "Hangup", Parameters: hangupParameters(participant) }]
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function redactPin(value) {
  const s = String(value);
  return s.length >= 2 ? `****${s.slice(-2)}` : "****";
}

/**
 * @param {Record<string, unknown>} event
 */
function logStructured(event, extra) {
  const type = event.InvocationEventType;
  const participant = firstParticipant(event);
  const sipHeaders =
    participant &&
    typeof participant === "object" &&
    participant !== null &&
    "SipHeaders" in participant
      ? /** @type {Record<string, string>} */ (participant.SipHeaders)
      : undefined;

  let args;
  const actionData = event.ActionData;
  if (
    actionData &&
    typeof actionData === "object" &&
    actionData !== null &&
    "Parameters" in actionData
  ) {
    const params = /** @type {{ Parameters?: { Arguments?: Record<string, string> } }} */ (
      actionData
    ).Parameters;
    if (params && typeof params === "object" && params.Arguments) {
      args = params.Arguments;
    }
  }

  const pinRaw = args && args.pin;
  const direction =
    participant &&
    typeof participant === "object" &&
    participant !== null &&
    "Direction" in participant
      ? participant.Direction
      : undefined;

  const ta =
    event.CallDetails &&
    typeof event.CallDetails === "object" &&
    event.CallDetails !== null &&
    "TransactionAttributes" in event.CallDetails
      ? /** @type {Record<string, string>} */ (
          /** @type {{ TransactionAttributes?: Record<string, string> }} */ (
            event.CallDetails
          ).TransactionAttributes
        )
      : undefined;

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    lvl: extra?.lvl || "INFO",
    svc: "chime-load-test-sma",
    evt: extra?.evt || "sma.invocation",
    msg: extra?.msg || "SMA handler invoked",
    InvocationEventType: type,
    Direction: direction,
    meetingId:
      sipHeaders && sipHeaders["X-Meeting-Id"] !== undefined
        ? sipHeaders["X-Meeting-Id"]
        : ta?.meetingId ?? args?.meetingId,
    attendeeId:
      sipHeaders && sipHeaders["X-Attendee-Id"] !== undefined
        ? sipHeaders["X-Attendee-Id"]
        : ta?.attendeeId ?? args?.attendeeId,
    pinRedacted: pinRaw !== undefined ? redactPin(pinRaw) : ta?.pin ? redactPin(ta.pin) : undefined,
    actionType:
      actionData &&
      typeof actionData === "object" &&
      actionData !== null &&
      "Type" in actionData
        ? actionData.Type
        : undefined,
    ...(extra?.err ? { err: extra.err } : {})
  });
  console.log(line);
}

/**
 * @param {Record<string, unknown>} event
 * @returns {Promise<Record<string, unknown>>}
 */
exports.handler = async (event) => {
  logStructured(event);

  const type = event.InvocationEventType;
  const participant = firstParticipant(event);
  const direction = participantDirection(participant);

  switch (type) {
    case "NEW_OUTBOUND_CALL":
    case "RINGING":
      return emptyActionsResponse();

    case "NEW_INBOUND_CALL":
      return {
        SchemaVersion: "1.0",
        Actions: [{ Type: "Answer" }]
      };

    case "CALL_UPDATE_REQUESTED": {
      if (participantDirection(participant) !== "Outbound") {
        return emptyActionsResponse();
      }
      const actionData = event.ActionData;
      const params =
        actionData &&
        typeof actionData === "object" &&
        actionData !== null &&
        "Parameters" in actionData
          ? /** @type {{ Parameters?: { Arguments?: Record<string, string> } }} */ (
              actionData
            ).Parameters
          : undefined;
      const updateArgs =
        params && typeof params === "object" && params.Arguments
          ? params.Arguments
          : undefined;
      const wantsHangup =
        updateArgs &&
        (updateArgs.loadTestHangup === "true" ||
          updateArgs.loadTestHangup === "1");
      if (wantsHangup && participant?.CallId) {
        return hangupResponse(participant);
      }
      const digits = updateArgs && updateArgs.loadTestDigits;
      if (!digits || !participant?.CallId) {
        return emptyActionsResponse();
      }
      const toneRaw = updateArgs.loadTestToneMs;
      const tone =
        toneRaw !== undefined && toneRaw !== ""
          ? parseInt(String(toneRaw), 10)
          : 100;
      return {
        SchemaVersion: "1.0",
        Actions: [
          {
            Type: "SendDigits",
            Parameters: {
              CallId: String(participant.CallId),
              Digits: String(digits),
              ToneDurationInMilliseconds: Number.isFinite(tone) ? tone : 100
            }
          }
        ]
      };
    }

    case "CALL_ANSWERED":
      return emptyActionsResponse();

    case "ACTION_SUCCESSFUL": {
      if (direction === "Outbound") {
        return emptyActionsResponse();
      }

      if (
        event.ActionData &&
        typeof event.ActionData === "object" &&
        "Type" in event.ActionData &&
        event.ActionData.Type === "Answer"
      ) {
        return hangupResponse(participant);
      }
      return emptyActionsResponse();
    }

    case "ACTION_FAILED": {
      if (direction === "Outbound") {
        const ad = event.ActionData;
        logStructured(event, {
          lvl: "ERROR",
          evt: "sma.action.failed",
          msg: "Outbound SendDigits action failed",
          err: {
            type:
              ad &&
              typeof ad === "object" &&
              ad !== null &&
              "ErrorType" in ad
                ? String(ad.ErrorType)
                : "Unknown",
            msg:
              ad &&
              typeof ad === "object" &&
              ad !== null &&
              "ErrorMessage" in ad
                ? String(ad.ErrorMessage)
                : ""
          }
        });
        return hangupResponse(participant);
      }
      return emptyActionsResponse();
    }

    case "HANGUP":
      logStructured(event, {
        evt: "sma.call.ended",
        msg: "Hangup event received"
      });
      return emptyActionsResponse();

    default:
      return emptyActionsResponse();
  }
};
