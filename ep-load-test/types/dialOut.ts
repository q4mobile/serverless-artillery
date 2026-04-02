/**
 * Artillery 1.x hook surface for PSTN dial-out (CSV payload → Chime SMA).
 */

export interface DialOutPayloadVars {
  attendeeId: string;
  pin: string;
  meetingId: string | number;
  /** Set by dialOutAnalyst on success */
  transactionId?: string;
}

export interface ArtilleryEmitter {
  emit(eventType: string, metric: string, value: number): void;
}

export type ArtilleryDone = (err?: Error) => void;

export interface DialOutArtilleryContext {
  vars: DialOutPayloadVars;
}
