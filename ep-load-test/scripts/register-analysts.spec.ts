import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REGISTRATION_PLAN_PATH,
  escapeCsvField,
  loadConfigFromEnv,
  meetingIdFromString,
  normalizeBaseUrl,
  redactPin,
  registerAnalysts,
  registrationTargetsFromJson,
  responseIndicatesFailure,
  sanitizeBodyForLog,
  serializeAnalystsCsv,
} from './register-analysts';
import type { FetchFn, RegistrationConfig } from './register-analysts.types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function baseConfig(overrides: Partial<RegistrationConfig> = {}): RegistrationConfig {
  return {
    baseUrl: normalizeBaseUrl('https://attendees.dev.example/rest/v1'),
    meetings: [{ meetingId: 359887660, analystCount: 3 }],
    fetchTimeoutMs: 0,
    delayMs: 0,
    outputPath: 'data/test-payload.csv',
    ...overrides,
  };
}

describe('registerAnalysts', () => {
  it('TR-EP-REG-001: [Given] mocked HTTP returns token and three successful registrations [When] registerAnalysts runs [Then] registered has three records and failed is zero', async () => {
    let postIndex = 0;
    const fetchMock: FetchFn = async (url, init) => {
      const u = String(url);
      if (u.endsWith('/auth/token/359887660')) {
        return jsonResponse({ success: true, data: { token: 'test-jwt' } });
      }
      if (u.endsWith('/attendee') && init?.method === 'POST') {
        const n = postIndex;
        postIndex += 1;
        return jsonResponse({
          success: true,
          data: {
            id: `id-${n}`,
            conferenceDetails: { analystPin: `10000${n}` },
          },
        });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    };
    const writes: Array<{ path: string; data: string }> = [];
    const result = await registerAnalysts(
      baseConfig({ meetings: [{ meetingId: 359887660, analystCount: 3 }] }),
      {
        fetch: fetchMock,
        sleep: () => Promise.resolve(),
        log: () => {},
        writeFile: async (p, data) => {
          writes.push({ path: p, data });
        },
        mkdir: async () => {},
      }
    );
    expect(result.registered).toHaveLength(3);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(3);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe('data/test-payload.csv');
    expect(writes[0]?.data).toMatch(/^id-0,100000/);
  });

  it('TR-EP-REG-002: [Given] one of ten registrations returns HTTP 400 [When] registerAnalysts runs [Then] nine succeed one fails and promise resolves at exactly ten percent failure rate', async () => {
    let postIndex = 0;
    const fetchMock: FetchFn = async (url, init) => {
      const u = String(url);
      if (u.includes('/auth/token/')) {
        return jsonResponse({ success: true, data: { token: 'jwt' } });
      }
      if (u.endsWith('/attendee')) {
        const i = postIndex;
        postIndex += 1;
        if (i === 5) {
          return jsonResponse({ success: false }, 400);
        }
        return jsonResponse({
          success: true,
          data: {
            id: `ok-${i}`,
            conferenceDetails: { analystPin: `20000${i}` },
          },
        });
      }
      return jsonResponse({}, 500);
    };
    const result = await registerAnalysts(
      baseConfig({ meetings: [{ meetingId: 359887660, analystCount: 10 }] }),
      {
      fetch: fetchMock,
      sleep: () => Promise.resolve(),
      log: () => {},
      writeFile: async () => {},
      mkdir: async () => {},
    }
    );
    expect(result.registered).toHaveLength(9);
    expect(result.failed).toBe(1);
  });

  it('TR-EP-REG-003: [Given] first POST returns 429 then 200 [When] registerAnalysts runs [Then] registration succeeds after retry', async () => {
    let attendeeCalls = 0;
    const fetchMock: FetchFn = async (url, init) => {
      const u = String(url);
      if (u.includes('/auth/token/')) {
        return jsonResponse({ success: true, data: { token: 'jwt' } });
      }
      if (u.endsWith('/attendee')) {
        attendeeCalls += 1;
        if (attendeeCalls === 1) {
          return jsonResponse({ retry: true }, 429);
        }
        return jsonResponse({
          success: true,
          data: {
            id: 'retry-ok',
            conferenceDetails: { analystPin: '999888' },
          },
        });
      }
      return jsonResponse({}, 500);
    };
    const result = await registerAnalysts(
      baseConfig({ meetings: [{ meetingId: 359887660, analystCount: 1 }] }),
      {
      fetch: fetchMock,
      sleep: () => Promise.resolve(),
      log: () => {},
      writeFile: async () => {},
      mkdir: async () => {},
    }
    );
    expect(result.registered).toHaveLength(1);
    expect(attendeeCalls).toBe(2);
  });

  it('TR-EP-REG-004: [Given] five registrations with three HTTP 400 responses [When] registerAnalysts runs [Then] promise rejects with threshold message', async () => {
    let postIndex = 0;
    const fetchMock: FetchFn = async (url) => {
      const u = String(url);
      if (u.includes('/auth/token/')) {
        return jsonResponse({ success: true, data: { token: 'jwt' } });
      }
      if (u.endsWith('/attendee')) {
        const i = postIndex;
        postIndex += 1;
        if (i >= 2) {
          return jsonResponse({ err: 'bad' }, 400);
        }
        return jsonResponse({
          success: true,
          data: {
            id: `ok-${i}`,
            conferenceDetails: { analystPin: `30000${i}` },
          },
        });
      }
      return jsonResponse({}, 500);
    };
    await expect(
      registerAnalysts(
        baseConfig({ meetings: [{ meetingId: 359887660, analystCount: 5 }] }),
        {
        fetch: fetchMock,
        sleep: () => Promise.resolve(),
        log: () => {},
        writeFile: async () => {},
        mkdir: async () => {},
      }
      )
    ).rejects.toSatisfy(
      (e) =>
        e instanceof Error &&
        /10%/.test(e.message) &&
        /3 of 5/.test(e.message)
    );
  });

  it('TR-EP-REG-005: [Given] a successful registration with PIN 482916 [When] all log lines are captured [Then] no log output contains the full cleartext PIN', async () => {
    const lines: string[] = [];
    const fetchMock: FetchFn = async (url) => {
      const u = String(url);
      if (u.includes('/auth/token/')) {
        return jsonResponse({ success: true, data: { token: 'jwt' } });
      }
      if (u.endsWith('/attendee')) {
        return jsonResponse({
          success: true,
          data: {
            id: 'att-1',
            conferenceDetails: { analystPin: '482916' },
          },
        });
      }
      return jsonResponse({}, 500);
    };
    await registerAnalysts(
      baseConfig({ meetings: [{ meetingId: 111111, analystCount: 1 }] }),
      {
        fetch: fetchMock,
        sleep: () => Promise.resolve(),
        log: (rec) => {
          lines.push(JSON.stringify(rec));
        },
        writeFile: async () => {},
        mkdir: async () => {},
      }
    );
    const blob = lines.join('\n');
    expect(blob).not.toContain('482916');
    expect(blob).toContain('****16');
  });

  it('TR-EP-REG-006: [Given] three successful analyst registrations [When] registerAnalysts completes [Then] GET auth token is called exactly once before any POST', async () => {
    const callLog: string[] = [];
    let postIndex = 0;
    const fetchMock: FetchFn = async (url, init) => {
      const u = String(url);
      const method = (init?.method as string) || 'GET';
      callLog.push(`${method} ${u}`);
      if (u.includes('/auth/token/')) {
        return jsonResponse({ success: true, data: { token: 'jwt' } });
      }
      if (u.endsWith('/attendee')) {
        const n = postIndex;
        postIndex += 1;
        return jsonResponse({
          success: true,
          data: {
            id: `id-${n}`,
            conferenceDetails: { analystPin: `40000${n}` },
          },
        });
      }
      return jsonResponse({}, 500);
    };
    await registerAnalysts(
      baseConfig({ meetings: [{ meetingId: 359887660, analystCount: 3 }] }),
      {
      fetch: fetchMock,
      sleep: () => Promise.resolve(),
      log: () => {},
      writeFile: async () => {},
      mkdir: async () => {},
    }
    );
    const tokenGets = callLog.filter(
      (c) => c.startsWith('GET ') && c.includes('/auth/token/')
    );
    expect(tokenGets).toHaveLength(1);
    const firstPostIdx = callLog.findIndex((c) => c.startsWith('POST '));
    const firstTokenIdx = callLog.findIndex((c) =>
      c.includes('/auth/token/')
    );
    expect(firstTokenIdx).toBeLessThan(firstPostIdx);
  });

  it('TR-EP-REG-007: [Given] two meetings with one analyst each [When] registerAnalysts runs [Then] GET auth token is called once per meeting before that meeting POSTs', async () => {
    const callLog: string[] = [];
    const fetchMock: FetchFn = async (url, init) => {
      const u = String(url);
      const method = (init?.method as string) || 'GET';
      callLog.push(`${method} ${u}`);
      if (u.endsWith('/auth/token/111')) {
        return jsonResponse({ success: true, data: { token: 'jwt-a' } });
      }
      if (u.endsWith('/auth/token/222')) {
        return jsonResponse({ success: true, data: { token: 'jwt-b' } });
      }
      if (u.endsWith('/attendee') && init?.method === 'POST') {
        const body = init.body ? JSON.parse(String(init.body)) : {};
        const mid = body.meetingId;
        return jsonResponse({
          success: true,
          data: {
            id: `id-${mid}`,
            conferenceDetails: { analystPin: `pin-${mid}` },
          },
        });
      }
      return jsonResponse({}, 500);
    };
    await registerAnalysts(
      {
        baseUrl: normalizeBaseUrl('https://attendees.dev.example/rest/v1'),
        meetings: [
          { meetingId: 111, analystCount: 1 },
          { meetingId: 222, analystCount: 1 },
        ],
        fetchTimeoutMs: 0,
        delayMs: 0,
        outputPath: 'data/test-payload.csv',
      },
      {
        fetch: fetchMock,
        sleep: () => Promise.resolve(),
        log: () => {},
        writeFile: async () => {},
        mkdir: async () => {},
      }
    );
    const token111 = callLog.findIndex(
      (c) => c.includes('/auth/token/111')
    );
    const token222 = callLog.findIndex(
      (c) => c.includes('/auth/token/222')
    );
    const post111 = callLog.findIndex(
      (c: string) => c.startsWith('POST ') && c.includes('/attendee')
    );
    let post222 = -1;
    for (let i = callLog.length - 1; i >= 0; i -= 1) {
      const c = callLog[i];
      if (c.startsWith('POST ') && c.includes('/attendee')) {
        post222 = i;
        break;
      }
    }
    expect(token111).toBeLessThan(post111);
    expect(post111).toBeLessThan(token222);
    expect(token222).toBeLessThan(post222);
  });

  it('TR-EP-REG-008: [Given] one of ten attendee POSTs returns HTTP 200 with success false [When] registerAnalysts runs [Then] that attempt counts as failed and run stays within threshold', async () => {
    let postIndex = 0;
    const fetchMock: FetchFn = async (url, init) => {
      const u = String(url);
      if (u.includes('/auth/token/')) {
        return jsonResponse({ success: true, data: { token: 'jwt' } });
      }
      if (u.endsWith('/attendee')) {
        const i = postIndex;
        postIndex += 1;
        if (i === 3) {
          return jsonResponse({ success: false, err: 'nope' }, 200);
        }
        return jsonResponse({
          success: true,
          data: {
            id: `id-${i}`,
            conferenceDetails: { analystPin: `30000${i}` },
          },
        });
      }
      return jsonResponse({}, 500);
    };
    const result = await registerAnalysts(
      baseConfig({ meetings: [{ meetingId: 359887660, analystCount: 10 }] }),
      {
        fetch: fetchMock,
        sleep: () => Promise.resolve(),
        log: () => {},
        writeFile: async () => {},
        mkdir: async () => {},
      }
    );
    expect(result.registered).toHaveLength(9);
    expect(result.failed).toBe(1);
  });

  it('TR-EP-REG-009: [Given] token GET returns HTTP 200 with success false [When] registerAnalysts runs [Then] promise rejects', async () => {
    const fetchMock: FetchFn = async (url) => {
      const u = String(url);
      if (u.includes('/auth/token/')) {
        return jsonResponse({ success: false }, 200);
      }
      return jsonResponse({}, 500);
    };
    await expect(
      registerAnalysts(
        baseConfig({ meetings: [{ meetingId: 359887660, analystCount: 1 }] }),
        {
          fetch: fetchMock,
          sleep: () => Promise.resolve(),
          log: () => {},
          writeFile: async () => {},
          mkdir: async () => {},
        }
      )
    ).rejects.toThrow(/success:false/);
  });

  it('TR-EP-REG-010: [Given] fetchTimeoutMs greater than zero [When] registerAnalysts calls fetch [Then] init includes an AbortSignal', async () => {
    let sawSignal = false;
    const fetchMock: FetchFn = async (url, init) => {
      const u = String(url);
      if (init?.signal instanceof AbortSignal) {
        sawSignal = true;
      }
      if (u.includes('/auth/token/')) {
        return jsonResponse({ success: true, data: { token: 'jwt' } });
      }
      if (u.endsWith('/attendee')) {
        return jsonResponse({
          success: true,
          data: {
            id: 'att-1',
            conferenceDetails: { analystPin: '100001' },
          },
        });
      }
      return jsonResponse({}, 500);
    };
    await registerAnalysts(
      baseConfig({ meetings: [{ meetingId: 359887660, analystCount: 1 }], fetchTimeoutMs: 5000 }),
      {
        fetch: fetchMock,
        sleep: () => Promise.resolve(),
        log: () => {},
        writeFile: async () => {},
        mkdir: async () => {},
      }
    );
    expect(sawSignal).toBe(true);
  });
});

describe('loadConfigFromEnv', () => {
  it('TR-EP-CFG-001: [Given] env with MEETING_ID and base URL [When] loadConfigFromEnv is called [Then] returns parsed meetingId and defaults for optional fields', () => {
    const c = loadConfigFromEnv({
      MEETING_ID: '42',
      EP_API_BASE_URL: 'https://x.com/rest/v1/',
    });
    expect(c.meetings).toEqual([{ meetingId: 42, analystCount: 225 }]);
    expect(c.baseUrl).toBe('https://x.com/rest/v1');
    expect(c.fetchTimeoutMs).toBe(0);
    expect(c.delayMs).toBe(50);
    expect(c.outputPath).toBe('data/analysts-payload.csv');
  });

  it('TR-EP-CFG-002: [Given] env with OUTPUT_PATH override [When] loadConfigFromEnv is called [Then] outputPath matches the override', () => {
    const c = loadConfigFromEnv({
      MEETING_ID: '1',
      OUTPUT_PATH: 'custom/rows.csv',
    });
    expect(c.outputPath).toBe('custom/rows.csv');
  });

  it('TR-EP-CFG-003: [Given] env without meeting source and no default plan file [When] loadConfigFromEnv is called [Then] throws an error describing required sources', () => {
    const prev = process.cwd();
    const emptyDir = mkdtempSync(join(tmpdir(), 'ep-reg-empty-'));
    process.chdir(emptyDir);
    try {
      expect(() => loadConfigFromEnv({})).toThrow(
        /MEETING_ID|MEETING_IDS|REGISTRATION_PLAN_PATH|registration-plan\.json/
      );
    } finally {
      process.chdir(prev);
    }
  });

  it('TR-EP-CFG-007: [Given] no meeting env vars and default plan file exists [When] loadConfigFromEnv is called [Then] meetings are loaded from data/registration-plan.json', () => {
    const prev = process.cwd();
    const dir = mkdtempSync(join(tmpdir(), 'ep-reg-plan-'));
    process.chdir(dir);
    try {
      mkdirSync(join(dir, 'data'), { recursive: true });
      writeFileSync(
        join(dir, DEFAULT_REGISTRATION_PLAN_PATH),
        '[{"meetingId":77,"analystCount":3}]',
        'utf8'
      );
      const c = loadConfigFromEnv({});
      expect(c.meetings).toEqual([{ meetingId: 77, analystCount: 3 }]);
    } finally {
      process.chdir(prev);
    }
  });

  it('TR-EP-CFG-004: [Given] MEETING_IDS and ANALYST_COUNT_PER_MEETING [When] loadConfigFromEnv is called [Then] returns one target per id', () => {
    const c = loadConfigFromEnv({
      MEETING_IDS: '10, 20,30',
      ANALYST_COUNT_PER_MEETING: '5',
    });
    expect(c.meetings).toEqual([
      { meetingId: 10, analystCount: 5 },
      { meetingId: 20, analystCount: 5 },
      { meetingId: 30, analystCount: 5 },
    ]);
  });

  it('TR-EP-CFG-008: [Given] MEETING_ID and REGISTRATION_PLAN_PATH both set [When] loadConfigFromEnv is called [Then] throws describing conflicting sources', () => {
    expect(() =>
      loadConfigFromEnv({
        MEETING_ID: '1',
        REGISTRATION_PLAN_PATH: './data/plan.json',
      })
    ).toThrow(/Conflicting meeting sources/);
  });

  it('TR-EP-CFG-009: [Given] MEETING_ID and MEETING_IDS both set [When] loadConfigFromEnv is called [Then] throws describing conflicting sources', () => {
    expect(() =>
      loadConfigFromEnv({
        MEETING_ID: '1',
        MEETING_IDS: '2,3',
      })
    ).toThrow(/Conflicting meeting sources/);
  });

  it('TR-EP-CFG-010: [Given] MEETING_IDS and REGISTRATION_PLAN_PATH both set [When] loadConfigFromEnv is called [Then] throws describing conflicting sources', () => {
    expect(() =>
      loadConfigFromEnv({
        MEETING_IDS: '2,3',
        REGISTRATION_PLAN_PATH: './data/plan.json',
      })
    ).toThrow(/Conflicting meeting sources/);
  });

  it('TR-EP-CFG-011: [Given] REGISTRATION_FETCH_TIMEOUT_MS set to 120000 [When] loadConfigFromEnv is called [Then] fetchTimeoutMs matches', () => {
    const c = loadConfigFromEnv({
      MEETING_ID: '1',
      REGISTRATION_FETCH_TIMEOUT_MS: '120000',
    });
    expect(c.fetchTimeoutMs).toBe(120000);
  });
});

describe('meetingIdFromString', () => {
  it('TR-EP-CFG-012: [Given] a valid decimal digit string [When] meetingIdFromString runs [Then] returns the integer value', () => {
    expect(meetingIdFromString('359887660', 'MEETING_ID')).toBe(359887660);
  });

  it('TR-EP-CFG-013: [Given] a token with trailing non-digits [When] meetingIdFromString runs [Then] throws invalid token error', () => {
    expect(() => meetingIdFromString('123abc', 'MEETING_IDS')).toThrow(
      /invalid token/
    );
  });
});

describe('responseIndicatesFailure', () => {
  it('TR-EP-API-001: [Given] body with success false [When] responseIndicatesFailure is called [Then] returns true', () => {
    expect(responseIndicatesFailure({ success: false })).toBe(true);
  });

  it('TR-EP-API-002: [Given] body with success true [When] responseIndicatesFailure is called [Then] returns false', () => {
    expect(responseIndicatesFailure({ success: true, data: {} })).toBe(false);
  });

  it('TR-EP-API-003: [Given] body without success property [When] responseIndicatesFailure is called [Then] returns false', () => {
    expect(responseIndicatesFailure({ data: { token: 'x' } })).toBe(false);
  });
});

describe('registrationTargetsFromJson', () => {
  it('TR-EP-CFG-005: [Given] a JSON array of meeting entries [When] registrationTargetsFromJson runs [Then] returns normalized targets', () => {
    const m = registrationTargetsFromJson(
      `[{"meetingId":1,"analystCount":2},{"meetingId":3,"analystCount":4,"registrationPassword":"x"}]`
    );
    expect(m).toEqual([
      { meetingId: 1, analystCount: 2 },
      { meetingId: 3, analystCount: 4, registrationPassword: 'x' },
    ]);
  });

  it('TR-EP-CFG-006: [Given] a JSON object with meetings key [When] registrationTargetsFromJson runs [Then] returns normalized targets', () => {
    const m = registrationTargetsFromJson(
      `{"meetings":[{"meetingId":9,"analystCount":1}]}`
    );
    expect(m).toEqual([{ meetingId: 9, analystCount: 1 }]);
  });
});

describe('sanitizeBodyForLog', () => {
  it('TR-EP-LOG-001: [Given] body with analystRegistrationPassword [When] sanitizeBodyForLog is called [Then] password is replaced with REDACTED', () => {
    const out = sanitizeBodyForLog({
      email: 'a@b.com',
      analystRegistrationPassword: 'secret',
    });
    expect(out.analystRegistrationPassword).toBe('[REDACTED]');
  });
});

describe('redactPin', () => {
  it('TR-EP-PIN-001: [Given] a six-digit PIN [When] redactPin is called [Then] only the last two digits are visible', () => {
    expect(redactPin('482916')).toBe('****16');
  });

  it('TR-EP-PIN-002: [Given] a single-character PIN [When] redactPin is called [Then] output is fully masked', () => {
    expect(redactPin('1')).toBe('****');
  });
});

describe('escapeCsvField', () => {
  it('TR-EP-CSV-010: [Given] a plain string with no special characters [When] escapeCsvField is called [Then] returns the string unchanged', () => {
    expect(escapeCsvField('hello')).toBe('hello');
  });

  it('TR-EP-CSV-011: [Given] a string containing a comma [When] escapeCsvField is called [Then] returns the string wrapped in double quotes', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
  });

  it('TR-EP-CSV-012: [Given] a string containing double quotes [When] escapeCsvField is called [Then] returns the string with escaped quotes and wrapped in double quotes', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('TR-EP-CSV-013: [Given] a string containing a newline [When] escapeCsvField is called [Then] returns the string wrapped in double quotes', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('TR-EP-CSV-014: [Given] a string containing a carriage return [When] escapeCsvField is called [Then] returns the string wrapped in double quotes', () => {
    expect(escapeCsvField('line1\rline2')).toBe('"line1\rline2"');
  });

  it('TR-EP-CSV-015: [Given] an empty string [When] escapeCsvField is called [Then] returns an empty string unchanged', () => {
    expect(escapeCsvField('')).toBe('');
  });
});

describe('serializeAnalystsCsv', () => {
  it('TR-EP-CSV-001: [Given] one analyst record [When] serializeAnalystsCsv is called [Then] output is a single CSV row without header in field order', () => {
    const s = serializeAnalystsCsv([
      {
        attendeeId: 'a',
        pin: '12',
        email: 'e@x.com',
        meetingId: 99,
      },
    ]);
    expect(s.trim()).toBe('a,12,e@x.com,99');
  });
});
