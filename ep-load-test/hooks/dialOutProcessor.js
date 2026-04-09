/**
 * Artillery processor entry: load config + Chime/Dynamo clients, export dial-out hooks.
 *
 * See ../lib/dialOutHooks.js for the scenario steps and ../types/dialOut.ts for vars.
 */

const { sleep } = require("../lib/chimeThrottleRetry.js");
const {
  readDialOutConfig,
  assertDialOutConfig
} = require("../lib/dialOutConfig.js");
const {
  logJson,
  redactPin,
  getDialOutFlowDurationMs,
  emitDialOutFlowFailure,
  logDialOutProcessorLoaded
} = require("../lib/dialOutLog.js");
const { createDialOutChimeApi } = require("../lib/dialOutChime.js");
const { createDialOutDynamoApi } = require("../lib/dialOutDynamo.js");
const { createDialOutHooks } = require("../lib/dialOutHooks.js");

const config = readDialOutConfig();
assertDialOutConfig(config);
logDialOutProcessorLoaded(config);

const chime = createDialOutChimeApi(config, { logJson });
const dynamo = createDialOutDynamoApi(config, { logJson });

module.exports = createDialOutHooks({
  config,
  chime,
  dynamo,
  sleep,
  logJson,
  redactPin,
  getDialOutFlowDurationMs,
  emitDialOutFlowFailure
});
