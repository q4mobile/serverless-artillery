import type { DynamoDBClient } from "@aws-sdk/client-dynamodb";

export function waitForParticipantStatus(opts: {
  client: DynamoDBClient;
  tableName: string;
  gsiIndexName: string;
  gsiPartitionKeyAttr: string;
  gsiPartitionKeyValue: string;
  statusAttribute: string;
  targetStatus: string;
  timeoutMs: number;
  intervalMs: number;
}): Promise<Record<string, unknown>>;

export function waitForParticipantBooleanField(opts: {
  client: DynamoDBClient;
  tableName: string;
  gsiIndexName: string;
  gsiPartitionKeyAttr: string;
  gsiPartitionKeyValue: string;
  booleanAttribute: string;
  expectedBoolean: boolean;
  timeoutMs: number;
  intervalMs: number;
}): Promise<Record<string, unknown>>;

export function createDynamoClient(region: string): DynamoDBClient;
