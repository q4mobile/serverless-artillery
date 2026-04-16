/**
 * Artillery processor entry: load config + Chime/Dynamo clients, export dial-out hooks.
 *
 * See ../lib/scenarioSteps.js for the scenario steps and ../types/dialOut.ts for vars.
 */

const { sleep } = require("../lib/retryWithBackoff.js");
const {
  loadConfig,
  validateConfig
} = require("../lib/config.js");
const {
  log,
  maskPin,
  elapsedMs,
  failScenario,
  logPolling,
  logPollingHandFlag,
  logStartup
} = require("../lib/loadTestLogger.js");
const {
  buildCallRequest,
  extractTransactionId,
  dialOut,
  sendSipUpdate
} = require("../lib/chimeClient.js");
const { waitForCallStatus, waitForHandFlag } = require("../lib/participantPoller.js");
const { createSteps, saveParticipantResult } = require("../lib/scenarioSteps.js");

const config = loadConfig();
validateConfig(config);
logStartup(config);

const chime = {
  buildCallRequest: (correlationId, meetingIdStr, attendeeId, pinStr) =>
    buildCallRequest(config, correlationId, meetingIdStr, attendeeId, pinStr),
  extractTransactionId,
  dialOut,
  sendSipUpdate: (transactionId, argumentsMap, ctx) =>
    sendSipUpdate(config.smaId, transactionId, argumentsMap, ctx)
};
const dynamo = {
  logPolling,
  waitForCallStatus: (correlationId, targetStatus) => waitForCallStatus(config, correlationId, targetStatus),
  logPollingHandFlag,
  waitForHandFlag: (correlationId, expectedBoolean) => waitForHandFlag(config, correlationId, expectedBoolean)
};

module.exports = {
  ...createSteps({
    config,
    chime,
    dynamo,
    sleep,
    log,
    maskPin,
    elapsedMs,
    failScenario
  }),
  saveParticipantResult
};
