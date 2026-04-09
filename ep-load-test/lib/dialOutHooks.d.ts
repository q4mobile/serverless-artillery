import type {
  ArtilleryEmitter,
  DialOutHookContext,
  DialOutHooksConfig
} from "../types/dialOut";

export function createDialOutHooks(deps: {
  config: DialOutHooksConfig;
  chime: Record<string, unknown>;
  dynamo: {
    logDynamoPollStart: (targetStatus: string, ctx: object) => void;
    waitForStatus: (correlationId: string, targetStatus: string) => Promise<void>;
    logDynamoPollHandRaised: (expectedBoolean: boolean, ctx: object) => void;
    waitForHandRaised: (
      correlationId: string,
      expectedBoolean: boolean
    ) => Promise<void>;
  };
  sleep: (ms: number) => Promise<void>;
  logJson: (r: Record<string, unknown>) => void;
  redactPin: (pin: string) => string;
  getDialOutFlowDurationMs: (vars: Record<string, unknown>) => number;
  emitDialOutFlowFailure: (
    events: ArtilleryEmitter,
    context: DialOutHookContext,
    err: Error,
    durationMs?: number
  ) => void;
}): {
  dialOutAnalyst: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  waitForAwaitingMeetingIdStatus: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  waitForAwaitingMeetingPinStatus: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  waitForConnectedStatus: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  waitForDisconnectedStatus: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  sendMeetingIdDtmf: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  sendPinDtmf: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  sendParticipantControlsDtmf: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  sendHumanIntakeDtmf: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  waitForAfterParticipantControlsStatus: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  waitForAfterHumanIntakeStatus: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  toggleHandDtmf: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  sendToggleHandDtmf: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  waitForHandRaised: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  waitForHandLowered: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
  hangUpDialOut: (
    context: DialOutHookContext,
    events: ArtilleryEmitter,
    done: (err?: Error) => void
  ) => Promise<void>;
};
