import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import {
  waitForParticipantStatus,
  waitForParticipantBooleanField
} from "./dynamoParticipantPoll.js";

describe("dynamoParticipantPoll", () => {
  beforeEach(() => {
    vi.spyOn(DynamoDBClient.prototype, "send").mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TR-EP-DD-001: [Given] Query returns item with matching Status [When] waitForParticipantStatus runs [Then] resolves with row", async () => {
    vi.spyOn(DynamoDBClient.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof QueryCommand) {
        return {
          Items: [
            {
              id: { S: "p1" },
              correlation_id: { S: "corr-1" },
              Status: { S: "AWAITING_MEETING_ID" },
            },
          ],
        };
      }
      return {};
    });

    const client = new DynamoDBClient({ region: "us-east-1" });
    const row = await waitForParticipantStatus({
      client,
      tableName: "participants-dev",
      gsiIndexName: "correlation_id-index",
      gsiPartitionKeyAttr: "correlation_id",
      gsiPartitionKeyValue: "corr-1",
      statusAttribute: "Status",
      targetStatus: "AWAITING_MEETING_ID",
      timeoutMs: 2000,
      intervalMs: 50,
    });

    expect(row.Status).toBe("AWAITING_MEETING_ID");
    expect(row.correlation_id).toBe("corr-1");
  });

  it("TR-EP-DD-002: [Given] empty Items then item with target status [When] waitForParticipantStatus runs [Then] resolves after retry", async () => {
    let n = 0;
    vi.spyOn(DynamoDBClient.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof QueryCommand) {
        n += 1;
        if (n === 1) {
          return { Items: [] };
        }
        return {
          Items: [
            {
              id: { S: "p2" },
              correlation_id: { S: "corr-2" },
              Status: { S: "AWAITING_MEETING_PIN" },
            },
          ],
        };
      }
      return {};
    });

    const client = new DynamoDBClient({ region: "us-east-1" });
    const row = await waitForParticipantStatus({
      client,
      tableName: "participants-dev",
      gsiIndexName: "correlation_id-index",
      gsiPartitionKeyAttr: "correlation_id",
      gsiPartitionKeyValue: "corr-2",
      statusAttribute: "Status",
      targetStatus: "AWAITING_MEETING_PIN",
      timeoutMs: 5000,
      intervalMs: 10,
    });

    expect(row.Status).toBe("AWAITING_MEETING_PIN");
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("TR-EP-DD-003: [Given] Query returns item with hand_raised BOOL true [When] waitForParticipantBooleanField runs [Then] resolves with row", async () => {
    vi.spyOn(DynamoDBClient.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof QueryCommand) {
        return {
          Items: [
            {
              id: { S: "p3" },
              correlation_id: { S: "corr-3" },
              hand_raised: { BOOL: true },
            },
          ],
        };
      }
      return {};
    });

    const client = new DynamoDBClient({ region: "us-east-1" });
    const row = await waitForParticipantBooleanField({
      client,
      tableName: "participants-dev",
      gsiIndexName: "correlation_id-index",
      gsiPartitionKeyAttr: "correlation_id",
      gsiPartitionKeyValue: "corr-3",
      booleanAttribute: "hand_raised",
      expectedBoolean: true,
      timeoutMs: 2000,
      intervalMs: 50,
    });

    expect(row.hand_raised).toBe(true);
    expect(row.correlation_id).toBe("corr-3");
  });
});
