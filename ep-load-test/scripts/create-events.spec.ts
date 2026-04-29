import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCreateEventRequestBody,
  createEvents,
  eventTargetsFromJson,
  loadConfigFromEnv,
  normalizeBaseUrl,
} from './create-events';
import type { CreateEventConfig } from './create-events.types';
import type { FetchFn } from './register-analysts.types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function config(overrides: Partial<CreateEventConfig> = {}): CreateEventConfig {
  return {
    graphqlBaseUrl: normalizeBaseUrl('https://dev.events.example'),
    companyId: 'company-1',
    bearerToken: 'jwt-123',
    events: [{ title: 'Load test event', analystCount: 5 }],
    defaultEventType: 'earnings',
    outputPath: 'data/registration-plan.json',
    delayMs: 0,
    fetchTimeoutMs: 0,
    ...overrides,
  };
}

describe('createEvents', () => {
  it('TR-EP-EVT-001: [Given] two event plan entries [When] createEvents succeeds [Then] writes registration plan JSON', async () => {
    let calls = 0;
    const writes: Array<{ path: string; data: string }> = [];
    const fetchMock: FetchFn = async (url, init) => {
      expect(String(url)).toBe('https://dev.events.example/graphql');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jwt-123');
      calls += 1;
      return jsonResponse({
        data: { createEvent: { meetingId: 1000 + calls, title: `Event ${calls}` } },
      });
    };

    const result = await createEvents(
      config({
        events: [
          { title: 'Event 1', analystCount: 12 },
          { title: 'Event 2', analystCount: 11, registrationPassword: 'pw' },
        ],
      }),
      {
        fetch: fetchMock,
        sleep: async () => {},
        log: () => {},
        mkdir: async () => {},
        writeFile: async (path, data) => {
          writes.push({ path, data });
        },
      }
    );

    expect(result.failed).toBe(0);
    expect(result.created).toEqual([
      { meetingId: 1001, analystCount: 12 },
      { meetingId: 1002, analystCount: 11, registrationPassword: 'pw' },
    ]);
    expect(JSON.parse(writes[0]!.data)).toEqual(result.created);
  });

  it('TR-EP-EVT-002: [Given] first createEvent request is rate limited [When] createEvents runs [Then] it retries and succeeds', async () => {
    let calls = 0;
    const fetchMock: FetchFn = async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ error: 'rate-limited' }, 429)
        : jsonResponse({ data: { createEvent: { meetingId: 42, title: 'ok' } } });
    };

    const result = await createEvents(config(), {
      fetch: fetchMock,
      sleep: async () => {},
      log: () => {},
      mkdir: async () => {},
      writeFile: async () => {},
    });

    expect(calls).toBe(2);
    expect(result.created[0]?.meetingId).toBe(42);
  });

  it('TR-EP-EVT-003: [Given] createEvent returns unauthorized [When] createEvents runs [Then] it fails without retrying', async () => {
    let calls = 0;
    const fetchMock: FetchFn = async () => {
      calls += 1;
      return jsonResponse({ error: 'unauthorized' }, 401);
    };

    await expect(
      createEvents(config(), {
        fetch: fetchMock,
        sleep: async () => {},
        log: () => {},
        mkdir: async () => {},
        writeFile: async () => {},
      })
    ).rejects.toThrow(/10% threshold/);
    expect(calls).toBe(1);
  });

  it('TR-EP-EVT-004: [Given] too many createEvent failures [When] createEvents completes requests [Then] it does not write output', async () => {
    let calls = 0;
    const writes: string[] = [];
    const fetchMock: FetchFn = async () => {
      calls += 1;
      return calls <= 2
        ? jsonResponse({ data: { createEvent: { meetingId: calls, title: 'ok' } } })
        : jsonResponse({ error: 'bad' }, 500);
    };

    await expect(
      createEvents(
        config({
          events: Array.from({ length: 5 }, (_, i) => ({
            title: `Event ${i + 1}`,
            analystCount: 1,
          })),
        }),
        {
          fetch: fetchMock,
          sleep: async () => {},
          log: () => {},
          mkdir: async () => {},
          writeFile: async (_path, data) => {
            writes.push(data);
          },
        }
      )
    ).rejects.toThrow(/3 of 5/);
    expect(writes).toHaveLength(0);
  });

  it('TR-EP-EVT-005: [Given] logs are captured [When] createEvents runs [Then] token is not logged', async () => {
    const logs: string[] = [];
    await createEvents(config({ bearerToken: 'secret-token' }), {
      fetch: async () => jsonResponse({ data: { createEvent: { meetingId: 1, title: 'ok' } } }),
      sleep: async () => {},
      log: (record) => logs.push(JSON.stringify(record)),
      mkdir: async () => {},
      writeFile: async () => {},
    });

    expect(logs.join('\n')).not.toContain('secret-token');
    expect(logs.join('\n')).not.toContain('Bearer ');
  });

  it('TR-EP-EVT-006: [Given] timeout is configured [When] createEvents calls fetch [Then] request has an AbortSignal', async () => {
    let signal: AbortSignal | undefined;
    await createEvents(config({ fetchTimeoutMs: 5000 }), {
      fetch: async (_url, init) => {
        signal = init?.signal as AbortSignal | undefined;
        return jsonResponse({ data: { createEvent: { meetingId: 1, title: 'ok' } } });
      },
      sleep: async () => {},
      log: () => {},
      mkdir: async () => {},
      writeFile: async () => {},
    });

    expect(signal).toBeDefined();
  });
});

describe('buildCreateEventRequestBody', () => {
  it('TR-EP-EVT-010: [Given] minimal event plan entry [When] payload is built [Then] it uses internal digital conferencing defaults', () => {
    const body = buildCreateEventRequestBody(
      { title: 'Event', analystCount: 1 },
      'company-1',
      'earnings',
      () => new Date('2026-04-01T10:00:00.000Z')
    );
    const event = body.variables.event as Record<string, unknown> & {
      configuration: Record<string, unknown>;
    };

    expect(body.variables.externalConferenceDetails).toEqual({});
    expect(event).toMatchObject({
      title: 'Event',
      companyId: 'company-1',
      eventType: 'earnings',
      eventStart: '2026-04-01T10:00:00.000Z',
      eventEnd: '2026-04-01T11:00:00.000Z',
      eventCategory: 'INTERNAL',
      conference: {
        conferenceCallIntake: {
          type: 'internal',
          vendor: 'chime',
          q4Hosted: false,
          qaStarted: true,
          status: 'DISCONNECTED',
        },
      },
    });
    expect(event.configuration).toMatchObject({
      dialIn: { speaker: true },
      layoutManager: { enabled: true },
      broadcastOutput: { externalEnabled: true },
      closedCaptions: { liveEnabled: true, postEventEnabled: true },
      dualStream: { enabled: true, region: 'us-west-2' },
    });
  });
});

describe('eventTargetsFromJson', () => {
  it('TR-EP-EVT-020: [Given] array or object plan JSON [When] parsed [Then] returns event entries', () => {
    expect(eventTargetsFromJson('[{"title":"A","analystCount":1}]')).toEqual([
      { title: 'A', analystCount: 1 },
    ]);
    expect(eventTargetsFromJson('{"events":[{"title":"B","analystCount":2}]}')).toEqual([
      { title: 'B', analystCount: 2 },
    ]);
  });

  it('TR-EP-EVT-021: [Given] invalid plan entries [When] parsed [Then] throws a useful error', () => {
    expect(() => eventTargetsFromJson('[]')).toThrow(/at least one event/);
    expect(() => eventTargetsFromJson('[{"analystCount":1}]')).toThrow(/title/);
    expect(() => eventTargetsFromJson('[{"title":"A","analystCount":0}]')).toThrow(
      /analystCount/
    );
  });
});

describe('loadConfigFromEnv', () => {
  it('TR-EP-EVT-030: [Given] minimal env [When] config loads [Then] defaults target dev and read the plan file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ep-create-events-'));
    const path = join(dir, 'events-plan.json');
    writeFileSync(path, '[{"title":"A","analystCount":1}]', 'utf8');

    const cfg = loadConfigFromEnv({
      Q4_ADMIN_TOKEN: 'token',
      EVENTS_PLAN_PATH: path,
    } as NodeJS.ProcessEnv);

    expect(cfg.graphqlBaseUrl).toBe('https://dev.events.q4inc.com');
    expect(cfg.companyId).toBe('6406198668c0aa6df0fb1406');
    expect(cfg.events).toEqual([{ title: 'A', analystCount: 1 }]);
  });

  it('TR-EP-EVT-031: [Given] token is missing [When] config loads [Then] it fails before reading the plan', () => {
    expect(() => loadConfigFromEnv({} as NodeJS.ProcessEnv)).toThrow(/Q4_ADMIN_TOKEN/);
  });
});
