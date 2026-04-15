/**
 * DynamoDB correlation GSI polling for dial-out.
 */

const { DynamoDBClient, QueryCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1"
});

async function queryByCorrelationId(config, correlationId) {
  const d = config.dynamo;
  const out = await dynamoClient.send(
    new QueryCommand({
      TableName: d.tableName,
      IndexName: d.correlationGsi,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: { "#pk": d.correlationAttr },
      ExpressionAttributeValues: { ":pk": { S: correlationId } },
      Limit: 5
    })
  );
  return (out.Items || []).map(unmarshall);
}

async function pollUntil(config, correlationId, match) {
  const { pollTimeoutMs, pollIntervalMs } = config.dynamo;
  const start = Date.now();
  while (Date.now() - start < pollTimeoutMs) {
    const rows = await queryByCorrelationId(config, correlationId);
    const row = rows.find(match);
    if (row) return row;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
  return null;
}

/**
 * @param {*} config
 * @param {string} correlationId
 * @param {string} targetStatus
 */
async function waitForCallStatus(config, correlationId, targetStatus) {
  const d = config.dynamo;
  const row = await pollUntil(config, correlationId, (r) => r[d.statusAttr] === targetStatus);
  if (!row) {
    throw new Error(
      `DynamoDB poll timeout after ${d.pollTimeoutMs}ms: table=${d.tableName} gsi=${d.correlationGsi} ${d.correlationAttr}=${correlationId} expected ${d.statusAttr}=${targetStatus}`
    );
  }
}

/**
 * @param {*} config
 * @param {string} correlationId
 * @param {boolean} expectedBoolean
 */
async function waitForHandFlag(config, correlationId, expectedBoolean) {
  const d = config.dynamo;
  const row = await pollUntil(config, correlationId, (r) => r[d.handRaisedAttr] === expectedBoolean);
  if (!row) {
    throw new Error(
      `DynamoDB poll timeout after ${d.pollTimeoutMs}ms: table=${d.tableName} gsi=${d.correlationGsi} ${d.correlationAttr}=${correlationId} expected ${d.handRaisedAttr}=${expectedBoolean}`
    );
  }
}

module.exports = {
  waitForCallStatus,
  waitForHandFlag
};
