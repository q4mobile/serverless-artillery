import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArtilleryDone,
  ArtilleryEmitter,
  DialOutArtilleryContext,
} from '../types/dialOut';

function setRequiredEnv(): void {
  process.env.LOAD_TEST_SMA_ID = 'sma-test-123';
  process.env.LOAD_TEST_FROM_PHONE = '+14155551234';
  process.env.LOAD_TEST_TO_PHONE = '+14155559999';
  delete process.env.PRODUCTION_SMA_ID;
}

async function importDialOutProcessor(): Promise<{
  dialOutAnalyst: (
    context: DialOutArtilleryContext,
    events: ArtilleryEmitter,
    done: ArtilleryDone
  ) => Promise<void>;
}> {
  const mod = await import('./dialOutProcessor.js');
  return (mod as { default?: unknown; dialOutAnalyst?: unknown }).dialOutAnalyst
    ? (mod as {
        dialOutAnalyst: (
          context: DialOutArtilleryContext,
          events: ArtilleryEmitter,
          done: ArtilleryDone
        ) => Promise<void>;
      })
    : ((mod as { default: { dialOutAnalyst: unknown } }).default as {
        dialOutAnalyst: (
          context: DialOutArtilleryContext,
          events: ArtilleryEmitter,
          done: ArtilleryDone
        ) => Promise<void>;
      });
}

describe('dialOutProcessor', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setRequiredEnv();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('TR-EP-DIAL-001: [Given] valid vars and successful CreateSipMediaApplicationCall [When] dialOutAnalyst runs [Then] sets transactionId and reports initiated metrics', async () => {
    const sdk = await import('@aws-sdk/client-chime-sdk-voice');
    const sendSpy = vi
      .spyOn(sdk.ChimeSDKVoiceClient.prototype, 'send')
      .mockResolvedValue({
        SipMediaApplicationCall: { TransactionId: 'txn-123' },
      } as unknown as Awaited<ReturnType<typeof sdk.ChimeSDKVoiceClient.prototype.send>>);

    const { dialOutAnalyst } = await importDialOutProcessor();
    const context: DialOutArtilleryContext = {
      vars: { attendeeId: 'att-1', pin: '482916', meetingId: '359887660' },
    };
    const events = { emit: vi.fn() };
    const done = vi.fn();

    await dialOutAnalyst(context, events, done);

    expect(done).toHaveBeenCalledWith();
    expect(context.vars.transactionId).toBe('txn-123');
    expect(events.emit).toHaveBeenCalledWith('counter', 'dialout.calls.initiated', 1);
    expect(events.emit).toHaveBeenCalledWith('histogram', 'dialout.call.setup_ms', expect.any(Number));
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('TR-EP-DIAL-002: [Given] first call throttles and second succeeds [When] dialOutAnalyst runs [Then] retries and completes successfully', async () => {
    const sdk = await import('@aws-sdk/client-chime-sdk-voice');
    const throttled = new Error('throttled') as Error & { name: string };
    throttled.name = 'TooManyRequestsException';
    const sendSpy = vi
      .spyOn(sdk.ChimeSDKVoiceClient.prototype, 'send')
      .mockRejectedValueOnce(throttled)
      .mockResolvedValueOnce({
        SipMediaApplicationCall: { TransactionId: 'txn-retry' },
      } as unknown as Awaited<ReturnType<typeof sdk.ChimeSDKVoiceClient.prototype.send>>);

    const { dialOutAnalyst } = await importDialOutProcessor();
    const context: DialOutArtilleryContext = {
      vars: { attendeeId: 'att-2', pin: '135790', meetingId: '359887661' },
    };
    const events = { emit: vi.fn() };
    const done = vi.fn();

    await dialOutAnalyst(context, events, done);

    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(done).toHaveBeenCalledWith();
    expect(context.vars.transactionId).toBe('txn-retry');
  });

  it('TR-EP-DIAL-003: [Given] processor env points to production SMA [When] module is loaded [Then] import throws fatal safety error', async () => {
    process.env.PRODUCTION_SMA_ID = 'sma-test-123';
    await expect(importDialOutProcessor()).rejects.toThrow(/refusing to route test traffic through production SMA/i);
  });
});
