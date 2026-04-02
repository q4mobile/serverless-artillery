import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface SmaHandlerModule {
  handler: (event: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

function asHandler(mod: unknown): SmaHandlerModule['handler'] {
  const withNamed = mod as { handler?: unknown };
  if (typeof withNamed.handler === 'function') {
    return withNamed.handler as SmaHandlerModule['handler'];
  }
  const withDefault = mod as { default?: { handler?: unknown } };
  if (withDefault.default && typeof withDefault.default.handler === 'function') {
    return withDefault.default.handler as SmaHandlerModule['handler'];
  }
  throw new Error('Could not resolve SMA handler export');
}

describe('sma handler', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TR-EP-SMA-001: [Given] outbound call answered event [When] SMA handler runs [Then] returns Hangup action', async () => {
    const mod = await import('../../.deploy/chime-load-test-sma/lambda_src/index.js');
    const handler = asHandler(mod);
    const result = await handler({
      InvocationEventType: 'CALL_ANSWERED',
      CallDetails: {
        Participants: [
          {
            Direction: 'Outbound',
            CallId: 'c-1',
            ParticipantTag: 'LEG-A',
          },
        ],
      },
    });

    expect(result).toEqual({
      SchemaVersion: '1.0',
      Actions: [
        {
          Type: 'Hangup',
          Parameters: { SipResponseCode: '0', CallId: 'c-1', ParticipantTag: 'LEG-A' },
        },
      ],
    });
  });

  it('TR-EP-SMA-002: [Given] new inbound call event [When] SMA handler runs [Then] returns Answer action', async () => {
    const mod = await import('../../.deploy/chime-load-test-sma/lambda_src/index.js');
    const handler = asHandler(mod);
    const result = await handler({ InvocationEventType: 'NEW_INBOUND_CALL' });

    expect(result).toEqual({
      SchemaVersion: '1.0',
      Actions: [{ Type: 'Answer' }],
    });
  });

  it('TR-EP-SMA-003: [Given] ACTION_SUCCESSFUL after Answer [When] SMA handler runs [Then] returns Hangup action', async () => {
    const mod = await import('../../.deploy/chime-load-test-sma/lambda_src/index.js');
    const handler = asHandler(mod);
    const result = await handler({
      InvocationEventType: 'ACTION_SUCCESSFUL',
      ActionData: { Type: 'Answer' },
      CallDetails: {
        Participants: [{ CallId: 'c-2', ParticipantTag: 'LEG-B' }],
      },
    });

    expect(result).toEqual({
      SchemaVersion: '1.0',
      Actions: [
        {
          Type: 'Hangup',
          Parameters: { SipResponseCode: '0', CallId: 'c-2', ParticipantTag: 'LEG-B' },
        },
      ],
    });
  });
});
