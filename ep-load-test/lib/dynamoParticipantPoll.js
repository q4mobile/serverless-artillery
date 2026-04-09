/**
 * Read-only DynamoDB polling: **Query** uses **only** the GSI partition key (e.g. `correlation_id`).
 * No other attributes participate in `KeyConditionExpression`.
 */

const { DynamoDBClient, QueryCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

/**
 * @param {object} opts
 * @param {import("@aws-sdk/client-dynamodb").DynamoDBClient} opts.client
 * @param {string} opts.tableName
 * @param {string} opts.gsiIndexName
 * @param {string} opts.gsiPartitionKeyAttr
 * @param {string} opts.gsiPartitionKeyValue
 * @param {string} opts.statusAttribute
 * @param {string} opts.targetStatus
 * @param {number} opts.timeoutMs
 * @param {number} opts.intervalMs
 * @returns {Promise<Record<string, unknown>>}
 */
async function waitForParticipantStatus(opts) {
  const {
    client,
    tableName,
    gsiIndexName,
    gsiPartitionKeyAttr,
    gsiPartitionKeyValue,
    statusAttribute,
    targetStatus,
    timeoutMs,
    intervalMs
  } = opts;

  if (!gsiIndexName || !gsiPartitionKeyAttr || gsiPartitionKeyValue == null) {
    throw new Error(
      "waitForParticipantStatus: gsiIndexName, gsiPartitionKeyAttr, and gsiPartitionKeyValue are required"
    );
  }

  const start = Date.now();
  const gsiPkPlaceholder = "#gsiPk";
  const gsiPkValuePlaceholder = ":gsiPk";

  while (Date.now() - start < timeoutMs) {
    const out = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: gsiIndexName,
        KeyConditionExpression: `${gsiPkPlaceholder} = ${gsiPkValuePlaceholder}`,
        ExpressionAttributeNames: {
          [gsiPkPlaceholder]: gsiPartitionKeyAttr
        },
        ExpressionAttributeValues: {
          [gsiPkValuePlaceholder]: { S: String(gsiPartitionKeyValue) }
        },
        Limit: 5
      })
    );

    const items = out.Items || [];
    for (const item of items) {
      const row = unmarshall(item);
      if (String(row[gsiPartitionKeyAttr] ?? "") !== String(gsiPartitionKeyValue)) {
        continue;
      }
      if (row[statusAttribute] === targetStatus) {
        return row;
      }
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `DynamoDB poll timeout after ${timeoutMs}ms: table=${tableName} gsi=${gsiIndexName} ${gsiPartitionKeyAttr}=${gsiPartitionKeyValue} expected ${statusAttribute}=${targetStatus}`
  );
}

/**
 * Same GSI Query as {@link waitForParticipantStatus}, but match a boolean attribute (e.g. events-streaming `hand_raised`).
 *
 * @param {object} opts
 * @param {string} opts.booleanAttribute — item attribute name after unmarshall
 * @param {boolean} opts.expectedBoolean — strict match (`row[attr] === expectedBoolean`)
 */
async function waitForParticipantBooleanField(opts) {
  const {
    client,
    tableName,
    gsiIndexName,
    gsiPartitionKeyAttr,
    gsiPartitionKeyValue,
    booleanAttribute,
    expectedBoolean,
    timeoutMs,
    intervalMs
  } = opts;

  if (!gsiIndexName || !gsiPartitionKeyAttr || gsiPartitionKeyValue == null) {
    throw new Error(
      "waitForParticipantBooleanField: gsiIndexName, gsiPartitionKeyAttr, and gsiPartitionKeyValue are required"
    );
  }
  if (!booleanAttribute) {
    throw new Error("waitForParticipantBooleanField: booleanAttribute is required");
  }

  const start = Date.now();
  const gsiPkPlaceholder = "#gsiPk";
  const gsiPkValuePlaceholder = ":gsiPk";

  while (Date.now() - start < timeoutMs) {
    const out = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: gsiIndexName,
        KeyConditionExpression: `${gsiPkPlaceholder} = ${gsiPkValuePlaceholder}`,
        ExpressionAttributeNames: {
          [gsiPkPlaceholder]: gsiPartitionKeyAttr
        },
        ExpressionAttributeValues: {
          [gsiPkValuePlaceholder]: { S: String(gsiPartitionKeyValue) }
        },
        Limit: 5
      })
    );

    const items = out.Items || [];
    for (const item of items) {
      const row = unmarshall(item);
      if (String(row[gsiPartitionKeyAttr] ?? "") !== String(gsiPartitionKeyValue)) {
        continue;
      }
      if (row[booleanAttribute] === expectedBoolean) {
        return row;
      }
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `DynamoDB poll timeout after ${timeoutMs}ms: table=${tableName} gsi=${gsiIndexName} ${gsiPartitionKeyAttr}=${gsiPartitionKeyValue} expected ${booleanAttribute}=${expectedBoolean}`
  );
}

function createDynamoClient(region) {
  return new DynamoDBClient({ region });
}

module.exports = {
  waitForParticipantStatus,
  waitForParticipantBooleanField,
  createDynamoClient
};
