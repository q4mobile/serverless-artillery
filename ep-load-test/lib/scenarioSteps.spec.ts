import { describe, expect, it, vi } from "vitest";
import type { DialOutHooksConfig } from "../types/dialOut";
import { createSteps } from "./scenarioSteps.js";
import { failScenario } from "./loadTestLogger.js";

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
      logPolling: vi.fn(),
      waitForCallStatus: vi.fn(),
      logPollingHandFlag: vi.fn(),
      waitForHandFlag: vi.fn().mockResolvedValue(undefined)
    },
    sleep: vi.fn(),
    log: vi.fn(),
    maskPin: (p: string) => `****${p.slice(-2)}`,
    elapsedMs: vi.fn().mockReturnValue(5000),
    failScenario: vi.fn(),
    ...overrides
  };
}

describe("scenarioSteps", () => {
  it("TR-EP-DIAL-030: [Given] correlationId missing [When] waitForMeetingIdPrompt runs [Then] done receives error", async () => {
    const dynamo = {
      logPolling: vi.fn(),
      waitForCallStatus: vi.fn()
    };
    const { waitForMeetingIdPrompt } = createSteps(
      baseDeps({ dynamo, failScenario })
    );
    const events = { emit: vi.fn() };
    const context = { vars: { attendeeId: "a1", meetingId: "99" } };

    const err = await new Promise<Error | undefined>((resolve) => {
      waitForMeetingIdPrompt(context, events, (e?: Error) =>
        resolve(e)
      );
    });

    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toMatch(/correlationId is required/i);
    expect(dynamo.waitForCallStatus).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      "error",
      expect.stringMatching(/correlationId is required/i)
    );
    expect(
      (context.vars as Record<string, unknown>).__dialOutScenarioAborted
    ).toBe(true);
  });

  it("TR-EP-DIAL-031: [Given] correlationId set [When] waitForPinPrompt runs [Then] dynamo wait and counter", async () => {
    const dynamo = {
      logPolling: vi.fn(),
      waitForCallStatus: vi.fn().mockResolvedValue(undefined)
    };
    const { waitForPinPrompt } = createSteps(
      baseDeps({ dynamo, failScenario: vi.fn() })
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
      waitForPinPrompt(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(dynamo.logPolling).toHaveBeenCalledWith(
      "AWAITING_MEETING_PIN",
      expect.objectContaining({
        correlationId: "corr-1",
        attendeeId: "a1",
        meetingId: "100"
      })
    );
    expect(dynamo.waitForCallStatus).toHaveBeenCalledWith("corr-1", "AWAITING_MEETING_PIN");
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.dynamo.awaiting_pin",
      1
    );
  });

  it("TR-EP-DIAL-032: [Given] correlationId set [When] waitForConnected runs [Then] dynamo polls CONNECTED and counter emitted", async () => {
    const dynamo = {
      logPolling: vi.fn(),
      waitForCallStatus: vi.fn().mockResolvedValue(undefined)
    };
    const { waitForConnected } = createSteps(
      baseDeps({ dynamo, failScenario: vi.fn() })
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
      waitForConnected(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(dynamo.waitForCallStatus).toHaveBeenCalledWith("corr-2", "CONNECTED");
    expect(events.emit).toHaveBeenCalledWith("counter", "dialout.dynamo.connected", 1);
  });

  it("TR-EP-DIAL-033: [Given] prior abort flag [When] waitForPinPrompt runs [Then] dynamo not queried", async () => {
    const dynamo = {
      logPolling: vi.fn(),
      waitForCallStatus: vi.fn()
    };
    const { waitForPinPrompt } = createSteps(
      baseDeps({ dynamo, failScenario: vi.fn() })
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
      waitForPinPrompt(context, events, () => resolve());
    });

    expect(dynamo.waitForCallStatus).not.toHaveBeenCalled();
  });

  it("TR-EP-DIAL-040: [Given] transactionId missing [When] enterMeetingId runs [Then] error without sendSipUpdate", async () => {
    const failScenario = vi.fn();
    const chime = { sendSipUpdate: vi.fn() };
    const { enterMeetingId } = createSteps(
      baseDeps({ chime, failScenario })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: { attendeeId: "a1", meetingId: "10", correlationId: "c1" }
    };

    const err = await new Promise<Error | undefined>((resolve) => {
      enterMeetingId(context, events, (e?: Error) => resolve(e));
    });

    expect(err?.message).toMatch(/transactionId is required/i);
    expect(chime.sendSipUpdate).not.toHaveBeenCalled();
    expect(failScenario).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      "error",
      expect.stringMatching(/transactionId is required/i)
    );
    expect(
      (context.vars as Record<string, unknown>).__dialOutScenarioAborted
    ).toBe(true);
  });

  it("TR-EP-DIAL-041: [Given] transactionId set [When] enterMeetingId runs [Then] sendSipUpdate and counter", async () => {
    const chime = { sendSipUpdate: vi.fn().mockResolvedValue({}) };
    const { enterMeetingId } = createSteps(baseDeps({ chime }));
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
      enterMeetingId(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(chime.sendSipUpdate).toHaveBeenCalledWith(
      "txn-1",
      { loadTestDigits: "42#", loadTestToneMs: "200" },
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

  it("TR-EP-DIAL-042: [Given] transactionId set [When] sendParticipantControls runs [Then] sendSipUpdate sends *9", async () => {
    const chime = { sendSipUpdate: vi.fn().mockResolvedValue({}) };
    const { sendParticipantControls } = createSteps(
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
      sendParticipantControls(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(chime.sendSipUpdate).toHaveBeenCalledWith(
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

  it("TR-EP-DIAL-043: [Given] transactionId set [When] sendHumanIntake runs [Then] sendSipUpdate sends *0", async () => {
    const chime = { sendSipUpdate: vi.fn().mockResolvedValue({}) };
    const { sendHumanIntake } = createSteps(baseDeps({ chime }));
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
      sendHumanIntake(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(chime.sendSipUpdate).toHaveBeenCalledWith(
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

  it("TR-EP-DIAL-052: [Given] correlationId set [When] waitAfterParticipantControls runs [Then] dynamo polls CONNECTED", async () => {
    const dynamo = {
      logPolling: vi.fn(),
      waitForCallStatus: vi.fn().mockResolvedValue(undefined)
    };
    const { waitAfterParticipantControls } = createSteps(
      baseDeps({ dynamo, failScenario: vi.fn() })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: { correlationId: "c-n", attendeeId: "a1", meetingId: 9 }
    };

    await new Promise<void>((resolve, reject) => {
      waitAfterParticipantControls(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(dynamo.waitForCallStatus).toHaveBeenCalledWith("c-n", "CONNECTED");
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.dynamo.after_participant_controls",
      1
    );
  });

  it("TR-EP-DIAL-053: [Given] correlationId set [When] waitAfterHumanIntake runs [Then] dynamo polls INITIATE_TRANSFER_FROM_CHIME_TO_SUPPORT", async () => {
    const dynamo = {
      logPolling: vi.fn(),
      waitForCallStatus: vi.fn().mockResolvedValue(undefined)
    };
    const { waitAfterHumanIntake } = createSteps(
      baseDeps({ dynamo, failScenario: vi.fn() })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: { correlationId: "c-z", attendeeId: "a1", meetingId: 0 }
    };

    await new Promise<void>((resolve, reject) => {
      waitAfterHumanIntake(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(dynamo.waitForCallStatus).toHaveBeenCalledWith("c-z", "INITIATE_TRANSFER_FROM_CHIME_TO_SUPPORT");
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.dynamo.after_human_intake",
      1
    );
  });

  it("TR-EP-DIAL-044: [Given] transactionId set [When] toggleHand runs [Then] sendSipUpdate sends *1", async () => {
    const chime = { sendSipUpdate: vi.fn().mockResolvedValue({}) };
    const { toggleHand, sendToggleHandDtmf } = createSteps(
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
      toggleHand(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(chime.sendSipUpdate).toHaveBeenCalledWith(
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
    expect(sendToggleHandDtmf).toBe(toggleHand);
  });

  it("TR-EP-DIAL-054: [Given] correlationId set [When] waitForHandUp runs [Then] dynamo waitForHandFlag true and counter", async () => {
    const dynamo = {
      logPolling: vi.fn(),
      waitForCallStatus: vi.fn(),
      logPollingHandFlag: vi.fn(),
      waitForHandFlag: vi.fn().mockResolvedValue(undefined)
    };
    const { waitForHandUp } = createSteps(
      baseDeps({ dynamo, failScenario: vi.fn() })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: { correlationId: "c-hr", attendeeId: "a1", meetingId: 1 }
    };

    await new Promise<void>((resolve, reject) => {
      waitForHandUp(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(dynamo.logPollingHandFlag).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ correlationId: "c-hr" })
    );
    expect(dynamo.waitForHandFlag).toHaveBeenCalledWith("c-hr", true);
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.dynamo.hand_raised_true",
      1
    );
  });

  it("TR-EP-DIAL-055: [Given] correlationId set [When] waitForHandDown runs [Then] dynamo waitForHandFlag false and counter", async () => {
    const dynamo = {
      logPolling: vi.fn(),
      waitForCallStatus: vi.fn(),
      logPollingHandFlag: vi.fn(),
      waitForHandFlag: vi.fn().mockResolvedValue(undefined)
    };
    const { waitForHandDown } = createSteps(
      baseDeps({ dynamo, failScenario: vi.fn() })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: { correlationId: "c-hl", attendeeId: "a1", meetingId: 1 }
    };

    await new Promise<void>((resolve, reject) => {
      waitForHandDown(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(dynamo.logPollingHandFlag).toHaveBeenCalledWith(
      false,
      expect.objectContaining({ correlationId: "c-hl" })
    );
    expect(dynamo.waitForHandFlag).toHaveBeenCalledWith("c-hl", false);
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.dynamo.hand_raised_false",
      1
    );
  });

  it("TR-EP-DIAL-050: [Given] transactionId set [When] hangUp runs [Then] sendSipUpdate sends loadTestHangup and marks call hung up", async () => {
    const chime = { sendSipUpdate: vi.fn().mockResolvedValue({}) };
    const { hangUp } = createSteps(baseDeps({ chime }));
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
      hangUp(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(chime.sendSipUpdate).toHaveBeenCalledWith(
      "txn-h",
      { loadTestHangup: "true" },
      expect.objectContaining({ correlationId: "c-h" })
    );
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.update.hangup_sent",
      1
    );
    expect(context.vars).toMatchObject({ __dialOutCallHungUp: true });
  });

  it("TR-EP-DIAL-052: [Given] scenario not aborted [When] hangUpOnError runs [Then] no hangup sent", async () => {
    const chime = { sendSipUpdate: vi.fn() };
    const { hangUpOnError } = createSteps(baseDeps({ chime }));
    const events = { emit: vi.fn() };
    const context = {
      vars: {
        transactionId: "txn-c",
        attendeeId: "a1",
        meetingId: 1,
        correlationId: "c-c"
      }
    };

    await new Promise<void>((resolve) => {
      hangUpOnError(context, events, () => resolve());
    });

    expect(chime.sendSipUpdate).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it("TR-EP-DIAL-053: [Given] scenario aborted but no transactionId [When] hangUpOnError runs [Then] no hangup sent", async () => {
    const chime = { sendSipUpdate: vi.fn() };
    const { hangUpOnError } = createSteps(baseDeps({ chime }));
    const events = { emit: vi.fn() };
    const context = {
      vars: { __dialOutScenarioAborted: true, attendeeId: "a1", meetingId: 1 }
    };

    await new Promise<void>((resolve) => {
      hangUpOnError(context, events, () => resolve());
    });

    expect(chime.sendSipUpdate).not.toHaveBeenCalled();
  });

  it("TR-EP-DIAL-054: [Given] scenario aborted with live call [When] hangUpOnError runs [Then] hangup sent and call marked hung up", async () => {
    const chime = { sendSipUpdate: vi.fn().mockResolvedValue({}) };
    const { hangUpOnError } = createSteps(baseDeps({ chime }));
    const events = { emit: vi.fn() };
    const context = {
      vars: {
        __dialOutScenarioAborted: true,
        transactionId: "txn-cleanup",
        attendeeId: "a1",
        meetingId: 2,
        correlationId: "c-cleanup"
      }
    };

    await new Promise<void>((resolve) => {
      hangUpOnError(context, events, () => resolve());
    });

    expect(chime.sendSipUpdate).toHaveBeenCalledWith(
      "txn-cleanup",
      { loadTestHangup: "true" },
      expect.objectContaining({ correlationId: "c-cleanup" })
    );
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.cleanup.hangup_sent",
      1
    );
    expect(context.vars).toMatchObject({ __dialOutCallHungUp: true });
  });

  it("TR-EP-DIAL-055: [Given] scenario aborted but call already hung up [When] hangUpOnError runs [Then] no second hangup sent", async () => {
    const chime = { sendSipUpdate: vi.fn() };
    const { hangUpOnError } = createSteps(baseDeps({ chime }));
    const events = { emit: vi.fn() };
    const context = {
      vars: {
        __dialOutScenarioAborted: true,
        __dialOutCallHungUp: true,
        transactionId: "txn-already",
        attendeeId: "a1",
        meetingId: 3,
        correlationId: "c-already"
      }
    };

    await new Promise<void>((resolve) => {
      hangUpOnError(context, events, () => resolve());
    });

    expect(chime.sendSipUpdate).not.toHaveBeenCalled();
  });

  it("TR-EP-DIAL-056: [Given] cleanup hangup fails with generic error [When] hangUpOnError runs [Then] done called without error and failure counter emitted", async () => {
    const chime = {
      sendSipUpdate: vi.fn().mockRejectedValue(new Error("Chime 503"))
    };
    const { hangUpOnError } = createSteps(baseDeps({ chime }));
    const events = { emit: vi.fn() };
    const context = {
      vars: {
        __dialOutScenarioAborted: true,
        transactionId: "txn-err",
        attendeeId: "a1",
        meetingId: 4,
        correlationId: "c-err"
      }
    };

    let caughtError: Error | undefined;
    await new Promise<void>((resolve) => {
      hangUpOnError(context, events, (e?: Error) => {
        caughtError = e;
        resolve();
      });
    });

    expect(caughtError).toBeUndefined();
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.cleanup.hangup_failed",
      1
    );
  });

  it("TR-EP-DIAL-057: [Given] Chime transaction already gone (NotFoundException) [When] hangUpOnError runs [Then] treated as already-terminated and info counter emitted", async () => {
    const notFound = Object.assign(new Error("Transaction x doesn't exist"), {
      name: "NotFoundException"
    });
    const chime = { sendSipUpdate: vi.fn().mockRejectedValue(notFound) };
    const { hangUpOnError } = createSteps(baseDeps({ chime }));
    const events = { emit: vi.fn() };
    const context = {
      vars: {
        __dialOutScenarioAborted: true,
        transactionId: "txn-gone",
        attendeeId: "a1",
        meetingId: 5,
        correlationId: "c-gone"
      }
    };

    let caughtError: Error | undefined;
    await new Promise<void>((resolve) => {
      hangUpOnError(context, events, (e?: Error) => {
        caughtError = e;
        resolve();
      });
    });

    expect(caughtError).toBeUndefined();
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.cleanup.already_gone",
      1
    );
    expect(events.emit).not.toHaveBeenCalledWith(
      "counter",
      "dialout.cleanup.hangup_failed",
      expect.anything()
    );
    expect(context.vars).toMatchObject({ __dialOutCallHungUp: true });
  });

  it("TR-EP-DIAL-051: [Given] correlationId set [When] waitForDisconnected runs [Then] dynamo polls DISCONNECTED", async () => {
    const dynamo = {
      logPolling: vi.fn(),
      waitForCallStatus: vi.fn().mockResolvedValue(undefined)
    };
    const { waitForDisconnected } = createSteps(
      baseDeps({ dynamo, failScenario: vi.fn() })
    );
    const events = { emit: vi.fn() };
    const context = {
      vars: { correlationId: "c-d", attendeeId: "a1", meetingId: 9 }
    };

    await new Promise<void>((resolve, reject) => {
      waitForDisconnected(context, events, (e?: Error) => {
        if (e) reject(e);
        else resolve();
      });
    });

    expect(dynamo.waitForCallStatus).toHaveBeenCalledWith("c-d", "DISCONNECTED");
    expect(events.emit).toHaveBeenCalledWith(
      "counter",
      "dialout.dynamo.disconnected",
      1
    );
  });

  // ── Duplicate-dial guard ──────────────────────────────────────────────────

  it("TR-EP-DIAL-060: [Given] same attendeeId dialled twice in same hooks instance [When] second dialParticipant runs [Then] done receives error and no Chime call is made", async () => {
    const dialOut = vi.fn().mockResolvedValue({});
    const chime = {
      buildCallRequest: vi.fn().mockReturnValue({}),
      dialOut,
      extractTransactionId: vi.fn().mockReturnValue("txn-1")
    };
    const { dialParticipant } = createSteps(baseDeps({ chime }));
    const events = { emit: vi.fn() };

    // First call succeeds
    await new Promise<void>((resolve, reject) => {
      dialParticipant(
        { vars: { attendeeId: "a1", pin: "1234", meetingId: 111 } },
        events,
        (e?: Error) => (e ? reject(e) : resolve())
      );
    });

    // Second call with the same attendeeId must fail immediately
    events.emit = vi.fn();
    const err = await new Promise<Error | undefined>((resolve) => {
      dialParticipant(
        { vars: { attendeeId: "a1", pin: "1234", meetingId: 111 } },
        events,
        (e?: Error) => resolve(e)
      );
    });

    expect(err?.message).toMatch(/duplicate dial/i);
    // dialOut called only once (for the first VU, not the second)
    expect(dialOut).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(
      "error",
      expect.stringMatching(/duplicate dial/i)
    );
  });

  it("TR-EP-DIAL-061: [Given] different attendeeIds [When] dialParticipant runs for each [Then] both succeed without duplicate error", async () => {
    const chime = {
      buildCallRequest: vi.fn().mockReturnValue({}),
      dialOut: vi.fn().mockResolvedValue({}),
      extractTransactionId: vi.fn().mockReturnValue("txn-x")
    };
    const { dialParticipant } = createSteps(baseDeps({ chime }));
    const events = { emit: vi.fn() };

    const runDial = (attendeeId: string) =>
      new Promise<Error | undefined>((resolve) => {
        dialParticipant(
          { vars: { attendeeId, pin: "0000", meetingId: 1 } },
          events,
          (e?: Error) => resolve(e)
        );
      });

    expect(await runDial("a1")).toBeUndefined();
    expect(await runDial("a2")).toBeUndefined();
    expect(chime.dialOut).toHaveBeenCalledTimes(2);
  });
});
