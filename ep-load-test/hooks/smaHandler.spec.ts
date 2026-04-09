import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface SmaHandlerModule {
  handler: (event: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function asHandler(mod: unknown): SmaHandlerModule["handler"] {
  const withNamed = mod as { handler?: unknown };
  if (typeof withNamed.handler === "function") {
    return withNamed.handler as SmaHandlerModule["handler"];
  }
  const withDefault = mod as { default?: { handler?: unknown } };
  if (withDefault.default && typeof withDefault.default.handler === "function") {
    return withDefault.default.handler as SmaHandlerModule["handler"];
  }
  throw new Error("Could not resolve SMA handler export");
}

describe("sma handler", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TR-EP-SMA-001: [Given] outbound CALL_ANSWERED [When] SMA handler runs [Then] returns empty Actions (Dynamo-gated)", async () => {
    const mod = await import("../../.deploy/chime-load-test-sma/lambda_src/index.js");
    const handler = asHandler(mod);
    const result = await handler({
      InvocationEventType: "CALL_ANSWERED",
      CallDetails: {
        TransactionAttributes: {
          meetingId: "359887660",
          pin: "482916",
          loadTestDynamoGated: "true",
        },
        Participants: [
          {
            Direction: "Outbound",
            CallId: "c-1",
            ParticipantTag: "LEG-A",
          },
        ],
      },
    });

    expect(result).toEqual({ SchemaVersion: "1.0", Actions: [] });
  });

  it("TR-EP-SMA-002: [Given] new inbound call event [When] SMA handler runs [Then] returns Answer action", async () => {
    const mod = await import("../../.deploy/chime-load-test-sma/lambda_src/index.js");
    const handler = asHandler(mod);
    const result = await handler({ InvocationEventType: "NEW_INBOUND_CALL" });

    expect(result).toEqual({
      SchemaVersion: "1.0",
      Actions: [{ Type: "Answer" }],
    });
  });

  it("TR-EP-SMA-003: [Given] ACTION_SUCCESSFUL after Answer [When] SMA handler runs [Then] returns Hangup action", async () => {
    const mod = await import("../../.deploy/chime-load-test-sma/lambda_src/index.js");
    const handler = asHandler(mod);
    const result = await handler({
      InvocationEventType: "ACTION_SUCCESSFUL",
      ActionData: { Type: "Answer" },
      CallDetails: {
        Participants: [{ CallId: "c-2", ParticipantTag: "LEG-B" }],
      },
    });

    expect(result).toEqual({
      SchemaVersion: "1.0",
      Actions: [
        {
          Type: "Hangup",
          Parameters: { SipResponseCode: "0", CallId: "c-2", ParticipantTag: "LEG-B" },
        },
      ],
    });
  });

  it("TR-EP-SMA-004: [Given] outbound ACTION_SUCCESSFUL after SendDigits [When] SMA handler runs [Then] returns empty Actions", async () => {
    const mod = await import("../../.deploy/chime-load-test-sma/lambda_src/index.js");
    const handler = asHandler(mod);
    const result = await handler({
      InvocationEventType: "ACTION_SUCCESSFUL",
      ActionData: { Type: "SendDigits", Parameters: { Digits: "1#", CallId: "c-out" } },
      CallDetails: {
        TransactionAttributes: { loadTestDynamoGated: "true" },
        Participants: [
          {
            Direction: "Outbound",
            CallId: "c-out",
            ParticipantTag: "LEG-A",
          },
        ],
      },
    });

    expect(result).toEqual({ SchemaVersion: "1.0", Actions: [] });
  });

  it("TR-EP-SMA-005: [Given] CALL_UPDATE_REQUESTED with loadTestDigits on outbound leg [When] SMA handler runs [Then] returns SendDigits action", async () => {
    const mod = await import("../../.deploy/chime-load-test-sma/lambda_src/index.js");
    const handler = asHandler(mod);
    const result = await handler({
      InvocationEventType: "CALL_UPDATE_REQUESTED",
      ActionData: {
        Type: "CallUpdateRequest",
        Parameters: {
          Arguments: {
            loadTestDigits: "359887660#",
            loadTestToneMs: "100",
          },
        },
      },
      CallDetails: {
        Participants: [
          {
            Direction: "Outbound",
            CallId: "c-upd",
            ParticipantTag: "LEG-A",
          },
        ],
      },
    });

    expect(result).toEqual({
      SchemaVersion: "1.0",
      Actions: [
        {
          Type: "SendDigits",
          Parameters: {
            CallId: "c-upd",
            Digits: "359887660#",
            ToneDurationInMilliseconds: 100,
          },
        },
      ],
    });
  });

  it("TR-EP-SMA-006: [Given] CALL_UPDATE_REQUESTED with loadTestHangup on outbound [When] SMA handler runs [Then] returns Hangup", async () => {
    const mod = await import("../../.deploy/chime-load-test-sma/lambda_src/index.js");
    const handler = asHandler(mod);
    const result = await handler({
      InvocationEventType: "CALL_UPDATE_REQUESTED",
      ActionData: {
        Type: "CallUpdateRequest",
        Parameters: {
          Arguments: {
            loadTestHangup: "true",
          },
        },
      },
      CallDetails: {
        Participants: [
          {
            Direction: "Outbound",
            CallId: "c-hang",
            ParticipantTag: "LEG-A",
          },
        ],
      },
    });

    expect(result).toEqual({
      SchemaVersion: "1.0",
      Actions: [
        {
          Type: "Hangup",
          Parameters: {
            SipResponseCode: "0",
            CallId: "c-hang",
            ParticipantTag: "LEG-A",
          },
        },
      ],
    });
  });
});
