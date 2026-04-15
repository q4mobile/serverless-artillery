import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { waitForCallStatus, waitForHandFlag } from "./participantPoller.js";

const testConfig = {
  dynamo: {
    tableName: "participants-dev",
    correlationGsi: "correlation_id-index",
    correlationAttr: "correlation_id",
    statusAttr: "Status",
    handRaisedAttr: "hand_raised",
    pollTimeoutMs: 2000,
    pollIntervalMs: 50
  }
};

describe("participantPoller", () => {
  beforeEach(() => {
    vi.spyOn(DynamoDBClient.prototype, "send").mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TR-EP-DD-001: [Given] Query returns item with matching Status [When] waitForCallStatus runs [Then] resolves without error", async () => {
    vi.spyOn(DynamoDBClient.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof QueryCommand) {
        return {
          Items: [
            {
              id: { S: "p1" },
              correlation_id: { S: "corr-1" },
              Status: { S: "AWAITING_MEETING_ID" }
            }
          ]
        };
      }
      return {};
    });

    await expect(waitForCallStatus(testConfig, "corr-1", "AWAITING_MEETING_ID")).resolves.toBeUndefined();
  });

  it("TR-EP-DD-002: [Given] empty Items then item with target status [When] waitForCallStatus runs [Then] resolves after retry", async () => {
    let n = 0;
    vi.spyOn(DynamoDBClient.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof QueryCommand) {
        n += 1;
        if (n === 1) return { Items: [] };
        return {
          Items: [
            {
              id: { S: "p2" },
              correlation_id: { S: "corr-2" },
              Status: { S: "AWAITING_MEETING_PIN" }
            }
          ]
        };
      }
      return {};
    });

    const cfg = { dynamo: { ...testConfig.dynamo, pollTimeoutMs: 5000, pollIntervalMs: 10 } };
    await expect(waitForCallStatus(cfg, "corr-2", "AWAITING_MEETING_PIN")).resolves.toBeUndefined();
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("TR-EP-DD-003: [Given] Query returns item with hand_raised true [When] waitForHandFlag runs [Then] resolves without error", async () => {
    vi.spyOn(DynamoDBClient.prototype, "send").mockImplementation(async (command) => {
      if (command instanceof QueryCommand) {
        return {
          Items: [
            {
              id: { S: "p3" },
              correlation_id: { S: "corr-3" },
              hand_raised: { BOOL: true }
            }
          ]
        };
      }
      return {};
    });

    await expect(waitForHandFlag(testConfig, "corr-3", true)).resolves.toBeUndefined();
  });

  it("TR-EP-DD-004: [Given] timeout elapses without matching item [When] waitForCallStatus runs [Then] rejects with timeout error message", async () => {
    vi.spyOn(DynamoDBClient.prototype, "send").mockResolvedValue({ Items: [] });

    const cfg = { dynamo: { ...testConfig.dynamo, pollTimeoutMs: 100, pollIntervalMs: 20 } };
    await expect(waitForCallStatus(cfg, "corr-timeout", "AWAITING_MEETING_PIN")).rejects.toThrow(
      /DynamoDB poll timeout after 100ms/
    );
  });
});
