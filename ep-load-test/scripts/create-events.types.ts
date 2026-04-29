import type { FetchFn } from './register-analysts.types';

export interface EventPlanEntry {
  title: string;
  analystCount: number;
  eventType?: string;
  eventStart?: string;
  eventEnd?: string;
  registrationPassword?: string;
}

export interface CreateEventConfig {
  graphqlBaseUrl: string;
  companyId: string;
  bearerToken: string;
  events: EventPlanEntry[];
  defaultEventType: string;
  outputPath: string;
  delayMs: number;
  fetchTimeoutMs: number;
}

export interface RegistrationPlanEntry {
  meetingId: number;
  analystCount: number;
  registrationPassword?: string;
}

export interface CreateEventResult {
  created: RegistrationPlanEntry[];
  failed: number;
  total: number;
}

export interface CreateEventResponse {
  data?: {
    createEvent?: {
      meetingId?: number;
      title?: string;
    } | null;
  };
  errors?: Array<{ message?: string; extensions?: Record<string, unknown> }>;
}

export interface CreateEventDeps {
  fetch: FetchFn;
  log: (record: Record<string, unknown>) => void;
  sleep: (ms: number) => Promise<void>;
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<void | string>;
}
