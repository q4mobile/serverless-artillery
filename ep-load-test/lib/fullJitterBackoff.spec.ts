import { describe, expect, it, vi } from 'vitest';
import { fullJitterBackoffMs } from './fullJitterBackoff.js';

describe('fullJitterBackoffMs', () => {
  it('TR-EP-JIT-001: [Given] mocked random zero [When] attempt 0 [Then] returns zero', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(
      fullJitterBackoffMs(0, { initialMs: 1000, maxMs: 8000 })
    ).toBe(0);
    vi.restoreAllMocks();
  });

  it('TR-EP-JIT-002: [Given] mocked random near one [When] attempt 0 [Then] returns upper bound of jitter range', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(
      fullJitterBackoffMs(0, { initialMs: 1000, maxMs: 8000 })
    ).toBe(1000);
    vi.restoreAllMocks();
  });

  it('TR-EP-JIT-003: [Given] high attempt [When] exponential exceeds maxMs [Then] jitter is bounded by maxMs', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(
      fullJitterBackoffMs(10, { initialMs: 1000, maxMs: 8000 })
    ).toBe(8000);
    vi.restoreAllMocks();
  });
});
