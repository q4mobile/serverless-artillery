const {
  ChimeSDKVoiceClient,
  CreateSipMediaApplicationCallCommand,
  UpdateSipMediaApplicationCallCommand
} = require("@aws-sdk/client-chime-sdk-voice");
const { fromIni } = require("@aws-sdk/credential-providers");
const {
  MAX_RETRIES,
  withRetries
} = require("./retryWithBackoff.js");
const { log } = require("./loadTestLogger.js");

// The dial-out SMA lives in whichever AWS account originates the call (e.g. prod),
// which may differ from the account under test (see LOAD_TEST_TARGET_AWS_PROFILE
// in participantPoller.js). Set LOAD_TEST_CHIME_AWS_PROFILE to a named AWS CLI
// profile for that account; omit it to fall back to the default credential chain.
const chimeAwsProfile = process.env.LOAD_TEST_CHIME_AWS_PROFILE;

const chimeClient = new ChimeSDKVoiceClient({
  region: process.env.AWS_REGION || "us-east-1",
  ...(chimeAwsProfile ? { credentials: fromIni({ profile: chimeAwsProfile }) } : {})
});

/**
 * @param {*} config - validated dial-out config from `loadConfig`
 * @param {string} correlationId
 * @param {string} meetingIdStr
 * @param {string} attendeeId
 * @param {string} pinStr
 */
function buildCallRequest(config, correlationId, meetingIdStr, attendeeId, pinStr) {
  return {
    SipMediaApplicationId: config.smaId,
    FromPhoneNumber: config.fromPhone,
    ToPhoneNumber: config.toPhone,
    SipHeaders: {
      [config.correlationIdHeader]: correlationId,
      "X-Meeting-Id": meetingIdStr,
      "X-Attendee-Id": attendeeId
    },
    ArgumentsMap: {
      meetingId: meetingIdStr,
      pin: pinStr,
      attendeeId,
      loadTestDynamoGated: "true"
    }
  };
}

/**
 * @param {object} response - CreateSipMediaApplicationCallCommand response
 * @returns {string}
 */
function extractTransactionId(response) {
  return response.SipMediaApplicationCall?.TransactionId ?? "";
}

/**
 * @param {object} input - output of buildCallRequest
 * @param {{ attendeeId: string, meetingId: string }} ctx
 */
async function dialOut(input, { attendeeId, meetingId }) {
  return withRetries(
    () => chimeClient.send(new CreateSipMediaApplicationCallCommand(input)),
    (attempt, backoffMs) => {
      log({
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

/**
 * @param {string} smaId
 * @param {string} transactionId
 * @param {Record<string, string>} argumentsMap
 * @param {{ attendeeId: string, meetingId: string, correlationId: string }} ctx
 */
async function sendSipUpdate(smaId, transactionId, argumentsMap, ctx) {
  const { attendeeId, meetingId, correlationId } = ctx;
  return withRetries(
    () =>
      chimeClient.send(
        new UpdateSipMediaApplicationCallCommand({
          SipMediaApplicationId: smaId,
          TransactionId: transactionId,
          Arguments: argumentsMap
        })
      ),
    (attempt, backoffMs) => {
      log({
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

module.exports = {
  buildCallRequest,
  extractTransactionId,
  dialOut,
  sendSipUpdate
};
