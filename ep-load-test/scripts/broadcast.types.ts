import type { FetchFn } from './register-analysts.types';

export type BroadcastContextEnum = 'NONE' | 'PAUSED' | 'FINALIZED';

export interface BroadcastConfig {
  graphqlBaseUrl: string;
  bearerToken: string;
  meetingIds: number[];
  delayMs: number;
  fetchTimeoutMs: number;
  preStartWaitMs: number;
}

export interface StopBroadcastConfig extends BroadcastConfig {
  context: BroadcastContextEnum;
}

export interface BroadcastResult {
  status?: string;
  context?: string;
  startTime?: string;
  broadcastUrl?: string;
  backupBroadcastUrl?: string;
  captionsUrl?: string;
  backupCaptionsUrl?: string;
}

export interface BroadcastResponse {
  data?: {
    startEventBroadcast?: BroadcastResult | null;
    stopEventBroadcast?: BroadcastResult | null;
  };
  errors?: Array<{ message?: string }>;
}

export interface BroadcastDeps {
  fetch: FetchFn;
  log: (record: Record<string, unknown>) => void;
  sleep: (ms: number) => Promise<void>;
}

export interface BroadcastRunResult {
  succeeded: number[];
  failed: number[];
  total: number;
}
