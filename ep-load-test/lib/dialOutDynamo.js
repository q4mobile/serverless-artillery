/**
 * DynamoDB correlation GSI polling for dial-out (delegates to dynamoParticipantPoll).
 */

const {
  waitForParticipantStatus,
  waitForParticipantBooleanField,
  createDynamoClient
} = require("./dynamoParticipantPoll.js");

/**
 * @param {*} config - validated dial-out config from `readDialOutConfig`
 * @param {{ logJson: (r: Record<string, unknown>) => void }} deps
 */
function createDialOutDynamoApi(config, { logJson }) {
  const dynamoClient = createDynamoClient(config.region);

  function makePollContext(correlationId) {
    const d = config.dynamo;
    return {
      client: dynamoClient,
      tableName: d.tableName,
      gsiIndexName: d.correlationGsi,
      gsiPartitionKeyAttr: d.correlationAttr,
      gsiPartitionKeyValue: correlationId,
      statusAttribute: d.statusAttr,
      timeoutMs: d.pollTimeoutMs,
      intervalMs: d.pollIntervalMs
    };
  }

  function baseQueryOpts(correlationId) {
    const d = config.dynamo;
    return {
      client: dynamoClient,
      tableName: d.tableName,
      gsiIndexName: d.correlationGsi,
      gsiPartitionKeyAttr: d.correlationAttr,
      gsiPartitionKeyValue: correlationId,
      timeoutMs: d.pollTimeoutMs,
      intervalMs: d.pollIntervalMs
    };
  }

  function logDynamoPollStart(targetStatus, ctx) {
    logJson({
      lvl: "INFO",
      evt: "ep.dialout.dynamo.poll_start",
      msg: "DynamoDB Query: correlation GSI partition key only",
      dynamoQueryPartitionKeyAttr: config.dynamo.correlationAttr,
      dynamoQueryPartitionKeyValue: ctx.correlationId,
      meetingId: ctx.meetingId,
      attendeeId: ctx.attendeeId,
      correlationId: ctx.correlationId,
      targetStatus
    });
  }

  async function waitForStatus(correlationId, targetStatus) {
    await waitForParticipantStatus({
      ...makePollContext(correlationId),
      targetStatus
    });
  }

  function logDynamoPollHandRaised(expectedBoolean, ctx) {
    logJson({
      lvl: "INFO",
      evt: "ep.dialout.dynamo.poll_start_hand_raised",
      msg: "DynamoDB Query: wait for participant hand_raised flag",
      dynamoQueryPartitionKeyAttr: config.dynamo.correlationAttr,
      dynamoQueryPartitionKeyValue: ctx.correlationId,
      meetingId: ctx.meetingId,
      attendeeId: ctx.attendeeId,
      correlationId: ctx.correlationId,
      handRaisedAttr: config.dynamo.handRaisedAttr,
      targetHandRaised: expectedBoolean
    });
  }

  async function waitForHandRaised(correlationId, expectedBoolean) {
    await waitForParticipantBooleanField({
      ...baseQueryOpts(correlationId),
      booleanAttribute: config.dynamo.handRaisedAttr,
      expectedBoolean
    });
  }

  return {
    waitForStatus,
    logDynamoPollStart,
    logDynamoPollHandRaised,
    waitForHandRaised
  };
}

module.exports = { createDialOutDynamoApi };
