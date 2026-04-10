/**
 * Chime SDK Voice: CreateSipMediaApplicationCall + UpdateSipMediaApplicationCall for dial-out.
 */

const {
  ChimeSDKVoiceClient,
  CreateSipMediaApplicationCallCommand,
  UpdateSipMediaApplicationCallCommand
} = require("@aws-sdk/client-chime-sdk-voice");
const {
  MAX_RETRIES,
  withChimeThrottleRetries
} = require("./chimeThrottleRetry.js");

/**
 * @param {*} config - validated dial-out config from `readDialOutConfig`
 * @param {{ logJson: (r: Record<string, unknown>) => void }} deps
 */
function createDialOutChimeApi(config, { logJson }) {
  const chimeClient = new ChimeSDKVoiceClient({ region: config.region });

  function buildCreateCallInput(correlationId, meetingIdStr, attendeeId, pinStr) {
    const argumentsMap = {
      meetingId: meetingIdStr,
      pin: pinStr,
      attendeeId,
      loadTestDynamoGated: "true"
    };
    return {
      SipMediaApplicationId: config.smaId,
      FromPhoneNumber: config.fromPhone,
      ToPhoneNumber: config.toPhone,
      SipHeaders: {
        [config.correlationIdHeader]: correlationId,
        "X-Meeting-Id": meetingIdStr,
        "X-Attendee-Id": attendeeId
      },
      ArgumentsMap: argumentsMap
    };
  }

  function transactionIdFromCreateResponse(response) {
    return response.SipMediaApplicationCall?.TransactionId ?? "";
  }

  async function createOutboundCall(input, { attendeeId, meetingId }) {
    return withChimeThrottleRetries(
      () => chimeClient.send(new CreateSipMediaApplicationCallCommand(input)),
      (attempt, backoffMs) => {
        logJson({
          lvl: "WARN",
          evt: "ep.dialout.call.throttled",
          msg: "Throttled by Chime SDK, retrying",
          meetingId,
          attendeeId,
          attempt,
          maxRetries: MAX_RETRIES,
          backoffMs
        });
      }
    );
  }

  async function updateSipCall(transactionId, argumentsMap, ctx) {
    const { attendeeId, meetingId, correlationId } = ctx;
    return withChimeThrottleRetries(
      () =>
        chimeClient.send(
          new UpdateSipMediaApplicationCallCommand({
            SipMediaApplicationId: config.smaId,
            TransactionId: transactionId,
            Arguments: argumentsMap
          })
        ),
      (attempt, backoffMs) => {
        logJson({
          lvl: "WARN",
          evt: "ep.dialout.update.throttled",
          msg: "UpdateSipMediaApplicationCall throttled, retrying",
          meetingId,
          attendeeId,
          correlationId,
          attempt,
          maxRetries: MAX_RETRIES,
          backoffMs
        });
      }
    );
  }

  return {
    buildCreateCallInput,
    transactionIdFromCreateResponse,
    createOutboundCall,
    updateSipCall
  };
}

module.exports = { createDialOutChimeApi };
