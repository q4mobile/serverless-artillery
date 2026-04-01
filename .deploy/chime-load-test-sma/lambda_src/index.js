/**
 * Chime SIP Media Application Lambda for **load-test** traffic.
 *
 * **Outbound (CreateSipMediaApplicationCall)** — primary path for ep-load-test dial-out:
 * - NEW_OUTBOUND_CALL / RINGING: Chime ignores Lambda return values; respond with empty actions.
 * - CALL_ANSWERED: callee picked up; return Hangup to end the test leg quickly (no prior Answer).
 *   See: https://docs.aws.amazon.com/chime-sdk/latest/dg/use-create-call-api.html
 *
 * **Inbound** (optional, if you route PSTN into this SMA):
 * - NEW_INBOUND_CALL → Answer → ACTION_SUCCESSFUL(Answer) → Hangup
 *
 * Extend for IVR/DTMF (meetingId, pin from SipHeaders / ArgumentsMap) for full conference flows.
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
 * @param {unknown} value
 * @returns {string}
 */
function redactPin(value) {
  const s = String(value);
  return s.length >= 2 ? `****${s.slice(-2)}` : "****";
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
 * @param {Record<string, unknown>} event
 */
function logStructured(event) {
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

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    lvl: "INFO",
    svc: "chime-load-test-sma",
    evt: "sma.invocation",
    msg: "SMA handler invoked",
    InvocationEventType: type,
    Direction: direction,
    meetingId:
      sipHeaders && sipHeaders["X-Meeting-Id"] !== undefined
        ? sipHeaders["X-Meeting-Id"]
        : args && args.meetingId,
    attendeeId:
      sipHeaders && sipHeaders["X-Attendee-Id"] !== undefined
        ? sipHeaders["X-Attendee-Id"]
        : args && args.attendeeId,
    pinRedacted: pinRaw !== undefined ? redactPin(pinRaw) : undefined,
    actionType:
      actionData &&
      typeof actionData === "object" &&
      actionData !== null &&
      "Type" in actionData
        ? actionData.Type
        : undefined
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
    case "CALL_ANSWERED":
      if (direction === "Outbound") {
        return hangupResponse(participant);
      }
      return emptyActionsResponse();

    case "NEW_OUTBOUND_CALL":
    case "RINGING":
      return emptyActionsResponse();

    case "NEW_INBOUND_CALL":
      return {
        SchemaVersion: "1.0",
        Actions: [{ Type: "Answer" }]
      };

    case "ACTION_SUCCESSFUL": {
      const actionData = event.ActionData;
      if (
        actionData &&
        typeof actionData === "object" &&
        actionData !== null &&
        "Type" in actionData &&
        actionData.Type === "Answer"
      ) {
        return hangupResponse(participant);
      }
      return emptyActionsResponse();
    }

    default:
      return emptyActionsResponse();
  }
};
