/**
 * Env-driven configuration for batch analyst registration against the Events Platform Attendee API.
 */

/** One meeting batch: fetch token once, then register analystCount analysts. */
export interface MeetingRegistrationTarget {
  meetingId: number;
  analystCount: number;
  /** When set, used instead of RegistrationConfig.defaultRegistrationPassword for this meeting. */
  registrationPassword?: string;
}

export interface RegistrationConfig {
  baseUrl: string;
  meetings: MeetingRegistrationTarget[];
  /** Applied when a meeting omits registrationPassword (from env ANALYST_REGISTRATION_PASSWORD). */
  defaultRegistrationPassword?: string;
  /**
   * Per-request `fetch` timeout in ms (`AbortSignal.timeout`). `0` disables (default).
   * From env `REGISTRATION_FETCH_TIMEOUT_MS`.
   */
  fetchTimeoutMs: number;
  delayMs: number;
  /**
   * Artillery 1.x payload file path: CSV data rows only (no header); column order matches
   * `fields: [attendeeId, pin, email, meetingId]`.
   */
  outputPath: string;
}

/** One row in the Artillery payload CSV. */
export interface AnalystPayloadRecord {
  attendeeId: string;
  pin: string;
  email: string;
  meetingId: number;
}

/** Mirror of successful POST /attendee response (subset used by this script). */
export interface EpRegistrationResponse {
  success: boolean;
  message?: string;
  data?: {
    id: string;
    conferenceDetails?: {
      analystPin?: string;
      dialInDetails?: Record<string, string>;
    };
    webinarDetails?: {
      passcode?: string;
      id?: string;
      joinUrl?: string;
      settings?: { dialInDetails?: Record<string, string> };
    };
    type?: string;
    disasterRecovery?: { enabled?: boolean; redirectUrl?: string };
  };
}

export interface RegisterAnalystsResult {
  registered: AnalystPayloadRecord[];
  failed: number;
  total: number;
}

export interface TokenResponse {
  success: boolean;
  data?: { token: string };
}

export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface RegisterAnalystsDeps {
  fetch: FetchFn;
  log: (record: Record<string, unknown>) => void;
  sleep: (ms: number) => Promise<void>;
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<void | string>;
}
