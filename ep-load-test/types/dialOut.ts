/**
 * Artillery 1.x hook surface for PSTN dial-out (CSV payload → Chime SMA, Dynamo-gated DTMF only).
 */

export interface DialOutPayloadVars {
  attendeeId: string;
  pin: string;
  meetingId: string | number;
  /** Chime `TransactionId` from `CreateSipMediaApplicationCall` — passed only to `UpdateSipMediaApplicationCall`. */
  transactionId?: string;
  /** UUID sent in SIP correlation header; Dynamo poll uses Query on GSI keyed by `correlation_id`. */
  correlationId?: string;
  /** Set by `dialOutAnalyst` for end-to-end setup duration in later hooks. */
  dialOutStartedAt?: number;
  /** Internal: set after a hook failure so later steps skip side effects (Artillery ignores `done(err)`). */
  __dialOutScenarioAborted?: boolean;
}

/** Artillery scenario emitter: `counter` / `histogram` (metric + number), or `error` (message only). */
export interface ArtilleryEmitter {
  emit(eventType: string, metricOrMessage: string, value?: number): void;
}

export type ArtilleryDone = (err?: Error) => void;

export interface DialOutArtilleryContext {
  vars: DialOutPayloadVars;
}

/** Context for `function:` steps; `vars` is populated by Artillery CSV + dial-out hooks. */
export type DialOutHookContext = { vars: Record<string, unknown> };

/**
 * Dynamo status strings read by `createDialOutHooks` (`lib/dialOutHooks.js`).
 * Full runtime config from `readDialOutConfig()` includes more fields for Chime/Dynamo wiring.
 */
export interface DialOutHooksDynamoConfig {
  statusAwaitingMeetingId: string;
  statusAwaitingPin: string;
  statusConnected: string;
  statusDisconnected: string;
  statusAfterStarNine: string;
  statusAfterStarZero: string;
}

export interface DialOutHooksConfig {
  dynamo: DialOutHooksDynamoConfig;
}
