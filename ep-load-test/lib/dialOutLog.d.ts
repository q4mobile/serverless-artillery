export function logJson(record: Record<string, unknown>): void;

export function redactPin(pin: string): string;

export function getDialOutFlowDurationMs(
  vars: Record<string, unknown>,
  fallbackStartMs?: number
): number;

export function notifyArtilleryScenarioError(
  events: { emit: (type: string, msg: string) => void } | undefined,
  error: Error
): void;

export function recordDialOutScenarioFailure(
  events: { emit: (type: string, msg: string) => void } | undefined,
  context: { vars: Record<string, unknown> },
  error: Error
): void;

export function emitDialOutFlowFailure(
  events: { emit: (type: string, metric: string, value: number) => void },
  context: { vars: Record<string, unknown> },
  error: Error,
  durationMs?: number
): void;

export function logDialOutProcessorLoaded(config: Record<string, unknown>): void;
