import { describe, expect, it, vi } from "vitest";
import type { DialOutHooksConfig } from "../types/dialOut";
import { createDialOutHooks } from "./dialOutHooks.js";
import { emitDialOutFlowFailure } from "./dialOutLog.js";

const config: DialOutHooksConfig = {
  dynamo: {
    statusAwaitingMeetingId: "AWAITING_MEETING_ID",
    statusAwaitingPin: "AWAITING_MEETING_PIN",
    statusConnected: "CONNECTED",
    statusDisconnected: "DISCONNECTED",
    statusAfterStarNine: "CONNECTED",
    statusAfterStarZero: "INITIATE_TRANSFER_FROM_CHIME_TO_SUPPORT"
  }
};

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    config,
    chime: {},
    dynamo: {
      logDynamoPollStart: vi.fn(),
      waitForStatus: vi.fn(),
      logDynamoPollHandRaised: vi.fn(),
      waitForHandRaised: vi.fn().mockResolvedValue(undefined)
    },
    sleep: vi.fn(),
    logJson: vi.fn(),
    redactPin: (p: string) => `****${p.slice(-2)}`,
    getDialOutFlowDurationMs: vi.fn().mockReturnValue(5000),
    emitDialOutFlowFailure: vi.fn(),
    ...overrides
  };
}

describe("dialOutHooks", () => {
  it("TR-EP-DIAL-030: [Given] correlationId missing [When] waitForAwaitingMeetingIdStatus runs [Then] done receives error", async () => {
    const dynamo = {
      logDynamoPollStart: vi.fn(),
      waitForStatus: vi.fn()
    };
    const { waitForAwaitingMeetingIdStatus } = createDialOutHooks(
      baseDeps({ dynamo, emitDialOutFlowFailure })
    );
    const events = { emit: vi.fn() };
    const context = { vars: { attendeeId: "a1", meetingId: "99" } };

    const err = await new Promise<Error | undefined>((resolve) => {
      waitForAwaitingMeetingIdStatus(context, events, (e?: Error) =>
        resolve(e)
      );
    });

    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toMatch(/correlationId is required/i);
    expect(dynamo.waitForStatus).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      "error",
      expect.stringMatching(/correlationId is required/i)
    );
    expect(
      (context.vars as Record<string, unknown>).__dialOutScenarioAborted
    ).toBe(true);
  });

  it("TR-EP-DIAL-031: [Given] correlationId set [When] waitForAwaitingMeetingPinStatus runs [Then] dynamo wait and counter", async () => {
    const dynamo = {
      logDynamoPollStart: vi.fn(),
      waitForStatus: vi.fn().mockResolvedValue(undefined)
    };
    const { waitForAwaitingMeetingPinStatus } = createDialOutHooks(
      baseDeps({ dynamo, emitDialOutFlowFailure: vi.fn() })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: {
        correlationId: "corr-1",
        attendeeId: "a1",
        meetingId: 100
      }
    };

    await new Promise<void>((resolve, reject) => {
      waitForAwaitingMeetingPinStatus(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(dynamo.logDynamoPollStart).toHaveBeenCalledWith(
      "AWAITING_MEETING_PIN",
      expect.objectContaining({
        correlationId: "corr-1",
        attendeeId: "a1",
        meetingId: "100"
      })
    );
    expect(dynamo.waitForStatus).toHaveBeenCalledWith(
      "corr-1",
      "AWAITING_MEETING_PIN"
    );
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.dynamo.awaiting_pin",
      1
    );
  });

  it("TR-EP-DIAL-032: [Given] correlationId set [When] waitForConnectedStatus runs [Then] dynamo polls CONNECTED and counter emitted", async () => {
    const dynamo = {
      logDynamoPollStart: vi.fn(),
      waitForStatus: vi.fn().mockResolvedValue(undefined)
    };
    const { waitForConnectedStatus } = createDialOutHooks(
      baseDeps({ dynamo, emitDialOutFlowFailure: vi.fn() })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: {
        correlationId: "corr-2",
        attendeeId: "a2",
        meetingId: 200
      }
    };

    await new Promise<void>((resolve, reject) => {
      waitForConnectedStatus(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(dynamo.waitForStatus).toHaveBeenCalledWith("corr-2", "CONNECTED");
    expect(events.emit).toHaveBeenCalledWith("counter", "dialout.dynamo.connected", 1);
  });

  it("TR-EP-DIAL-033: [Given] prior abort flag [When] waitForAwaitingMeetingPinStatus runs [Then] dynamo not queried", async () => {
    const dynamo = {
      logDynamoPollStart: vi.fn(),
      waitForStatus: vi.fn()
    };
    const { waitForAwaitingMeetingPinStatus } = createDialOutHooks(
      baseDeps({ dynamo, emitDialOutFlowFailure: vi.fn() })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: {
        __dialOutScenarioAborted: true,
        correlationId: "c1",
        attendeeId: "a1",
        meetingId: 1
      }
    };

    await new Promise<void>((resolve) => {
      waitForAwaitingMeetingPinStatus(context, events, () => resolve());
    });

    expect(dynamo.waitForStatus).not.toHaveBeenCalled();
  });

  it("TR-EP-DIAL-040: [Given] transactionId missing [When] sendMeetingIdDtmf runs [Then] error without updateSipCall", async () => {
    const emitDialOutFlowFailure = vi.fn();
    const chime = { updateSipCall: vi.fn() };
    const { sendMeetingIdDtmf } = createDialOutHooks(
      baseDeps({ chime, emitDialOutFlowFailure })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: { attendeeId: "a1", meetingId: "10", correlationId: "c1" }
    };

    const err = await new Promise<Error | undefined>((resolve) => {
      sendMeetingIdDtmf(context, events, (e?: Error) => resolve(e));
    });

    expect(err?.message).toMatch(/transactionId is required/i);
    expect(chime.updateSipCall).not.toHaveBeenCalled();
    expect(emitDialOutFlowFailure).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      "error",
      expect.stringMatching(/transactionId is required/i)
    );
    expect(
      (context.vars as Record<string, unknown>).__dialOutScenarioAborted
    ).toBe(true);
  });

  it("TR-EP-DIAL-041: [Given] transactionId set [When] sendMeetingIdDtmf runs [Then] updateSipCall and counter", async () => {
    const chime = { updateSipCall: vi.fn().mockResolvedValue({}) };
    const { sendMeetingIdDtmf } = createDialOutHooks(baseDeps({ chime }));
    const events = { emit: vi.fn() };
    const context = {
      vars: {
        transactionId: "txn-1",
        attendeeId: "a1",
        meetingId: 42,
        correlationId: "c1"
      }
    };

    await new Promise<void>((resolve, reject) => {
      sendMeetingIdDtmf(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(chime.updateSipCall).toHaveBeenCalledWith(
      "txn-1",
      { loadTestDigits: "42#", loadTestToneMs: "100" },
      expect.objectContaining({
        attendeeId: "a1",
        meetingId: "42",
        correlationId: "c1"
      })
    );
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.update.meeting_id_sent",
      1
    );
  });

  it("TR-EP-DIAL-042: [Given] transactionId set [When] sendParticipantControlsDtmf runs [Then] updateSipCall sends *9", async () => {
    const chime = { updateSipCall: vi.fn().mockResolvedValue({}) };
    const { sendParticipantControlsDtmf } = createDialOutHooks(
      baseDeps({ chime })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: {
        transactionId: "txn-s9",
        attendeeId: "a1",
        meetingId: 1,
        correlationId: "c-s9"
      }
    };

    await new Promise<void>((resolve, reject) => {
      sendParticipantControlsDtmf(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(chime.updateSipCall).toHaveBeenCalledWith(
      "txn-s9",
      { loadTestDigits: "*9", loadTestToneMs: "100" },
      expect.objectContaining({
        attendeeId: "a1",
        meetingId: "1",
        correlationId: "c-s9"
      })
    );
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.update.participant_controls_sent",
      1
    );
  });

  it("TR-EP-DIAL-043: [Given] transactionId set [When] sendHumanIntakeDtmf runs [Then] updateSipCall sends *0", async () => {
    const chime = { updateSipCall: vi.fn().mockResolvedValue({}) };
    const { sendHumanIntakeDtmf } = createDialOutHooks(baseDeps({ chime }));
    const events = { emit: vi.fn() };
    const context = {
      vars: {
        transactionId: "txn-s0",
        attendeeId: "a1",
        meetingId: 1,
        correlationId: "c-s0"
      }
    };

    await new Promise<void>((resolve, reject) => {
      sendHumanIntakeDtmf(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(chime.updateSipCall).toHaveBeenCalledWith(
      "txn-s0",
      { loadTestDigits: "*0", loadTestToneMs: "100" },
      expect.objectContaining({
        attendeeId: "a1",
        meetingId: "1",
        correlationId: "c-s0"
      })
    );
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.update.human_intake_sent",
      1
    );
  });

  it("TR-EP-DIAL-052: [Given] correlationId set [When] waitForAfterParticipantControlsStatus runs [Then] dynamo polls CONNECTED", async () => {
    const dynamo = {
      logDynamoPollStart: vi.fn(),
      waitForStatus: vi.fn().mockResolvedValue(undefined)
    };
    const { waitForAfterParticipantControlsStatus } = createDialOutHooks(
      baseDeps({ dynamo, emitDialOutFlowFailure: vi.fn() })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: { correlationId: "c-n", attendeeId: "a1", meetingId: 9 }
    };

    await new Promise<void>((resolve, reject) => {
      waitForAfterParticipantControlsStatus(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(dynamo.waitForStatus).toHaveBeenCalledWith("c-n", "CONNECTED");
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.dynamo.after_participant_controls",
      1
    );
  });

  it("TR-EP-DIAL-053: [Given] correlationId set [When] waitForAfterHumanIntakeStatus runs [Then] dynamo polls INITIATE_TRANSFER_FROM_CHIME_TO_SUPPORT", async () => {
    const dynamo = {
      logDynamoPollStart: vi.fn(),
      waitForStatus: vi.fn().mockResolvedValue(undefined)
    };
    const { waitForAfterHumanIntakeStatus } = createDialOutHooks(
      baseDeps({ dynamo, emitDialOutFlowFailure: vi.fn() })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: { correlationId: "c-z", attendeeId: "a1", meetingId: 0 }
    };

    await new Promise<void>((resolve, reject) => {
      waitForAfterHumanIntakeStatus(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(dynamo.waitForStatus).toHaveBeenCalledWith(
      "c-z",
      "INITIATE_TRANSFER_FROM_CHIME_TO_SUPPORT"
    );
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.dynamo.after_human_intake",
      1
    );
  });

  it("TR-EP-DIAL-044: [Given] transactionId set [When] toggleHandDtmf runs [Then] updateSipCall sends *1", async () => {
    const chime = { updateSipCall: vi.fn().mockResolvedValue({}) };
    const { toggleHandDtmf, sendToggleHandDtmf } = createDialOutHooks(
      baseDeps({ chime })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: {
        transactionId: "txn-th",
        attendeeId: "a1",
        meetingId: 1,
        correlationId: "c-th"
      }
    };

    await new Promise<void>((resolve, reject) => {
      toggleHandDtmf(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(chime.updateSipCall).toHaveBeenCalledWith(
      "txn-th",
      { loadTestDigits: "*1", loadTestToneMs: "100" },
      expect.objectContaining({
        attendeeId: "a1",
        meetingId: "1",
        correlationId: "c-th"
      })
    );
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.update.toggle_hand_sent",
      1
    );
    expect(sendToggleHandDtmf).toBe(toggleHandDtmf);
  });

  it("TR-EP-DIAL-054: [Given] correlationId set [When] waitForHandRaised runs [Then] dynamo waitForHandRaised true and counter", async () => {
    const dynamo = {
      logDynamoPollStart: vi.fn(),
      waitForStatus: vi.fn(),
      logDynamoPollHandRaised: vi.fn(),
      waitForHandRaised: vi.fn().mockResolvedValue(undefined)
    };
    const { waitForHandRaised } = createDialOutHooks(
      baseDeps({ dynamo, emitDialOutFlowFailure: vi.fn() })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: { correlationId: "c-hr", attendeeId: "a1", meetingId: 1 }
    };

    await new Promise<void>((resolve, reject) => {
      waitForHandRaised(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(dynamo.logDynamoPollHandRaised).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ correlationId: "c-hr" })
    );
    expect(dynamo.waitForHandRaised).toHaveBeenCalledWith("c-hr", true);
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.dynamo.hand_raised_true",
      1
    );
  });

  it("TR-EP-DIAL-055: [Given] correlationId set [When] waitForHandLowered runs [Then] dynamo waitForHandRaised false and counter", async () => {
    const dynamo = {
      logDynamoPollStart: vi.fn(),
      waitForStatus: vi.fn(),
      logDynamoPollHandRaised: vi.fn(),
      waitForHandRaised: vi.fn().mockResolvedValue(undefined)
    };
    const { waitForHandLowered } = createDialOutHooks(
      baseDeps({ dynamo, emitDialOutFlowFailure: vi.fn() })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: { correlationId: "c-hl", attendeeId: "a1", meetingId: 1 }
    };

    await new Promise<void>((resolve, reject) => {
      waitForHandLowered(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(dynamo.logDynamoPollHandRaised).toHaveBeenCalledWith(
      false,
      expect.objectContaining({ correlationId: "c-hl" })
    );
    expect(dynamo.waitForHandRaised).toHaveBeenCalledWith("c-hl", false);
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.dynamo.hand_raised_false",
      1
    );
  });

  it("TR-EP-DIAL-050: [Given] transactionId set [When] hangUpDialOut runs [Then] updateSipCall sends loadTestHangup", async () => {
    const chime = { updateSipCall: vi.fn().mockResolvedValue({}) };
    const { hangUpDialOut } = createDialOutHooks(baseDeps({ chime }));
    const events = { emit: vi.fn() };
    const context = {
      vars: {
        transactionId: "txn-h",
        attendeeId: "a1",
        meetingId: 1,
        correlationId: "c-h"
      }
    };

    await new Promise<void>((resolve, reject) => {
      hangUpDialOut(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(chime.updateSipCall).toHaveBeenCalledWith(
      "txn-h",
      { loadTestHangup: "true" },
      expect.objectContaining({ correlationId: "c-h" })
    );
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.update.hangup_sent",
      1
    );
  });

  it("TR-EP-DIAL-051: [Given] correlationId set [When] waitForDisconnectedStatus runs [Then] dynamo polls DISCONNECTED", async () => {
    const dynamo = {
      logDynamoPollStart: vi.fn(),
      waitForStatus: vi.fn().mockResolvedValue(undefined)
    };
    const { waitForDisconnectedStatus } = createDialOutHooks(
      baseDeps({ dynamo, emitDialOutFlowFailure: vi.fn() })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: { correlationId: "c-d", attendeeId: "a1", meetingId: 9 }
    };

    await new Promise<void>((resolve, reject) => {
      waitForDisconnectedStatus(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(dynamo.waitForStatus).toHaveBeenCalledWith("c-d", "DISCONNECTED");
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.dynamo.disconnected",
      1
    );
  });
});
