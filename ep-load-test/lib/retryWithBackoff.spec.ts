import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isThrottleError,
  withRetries
} from "./retryWithBackoff.js";

describe("retryWithBackoff", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("TR-EP-DIAL-010: [Given] TooManyRequestsException [When] isThrottleError [Then] returns true", () => {
    const err = Object.assign(new Error("x"), {
      name: "TooManyRequestsException"
    });
    expect(isThrottleError(err)).toBe(true);
  });

  it("TR-EP-DIAL-011: [Given] ThrottledClientException [When] isThrottleError [Then] returns true", () => {
    const err = Object.assign(new Error("x"), {
      name: "ThrottledClientException"
    });
    expect(isThrottleError(err)).toBe(true);
  });

  it("TR-EP-DIAL-012: [Given] other error name [When] isThrottleError [Then] returns false", () => {
    const err = Object.assign(new Error("x"), { name: "AccessDeniedException" });
    expect(isThrottleError(err)).toBe(false);
  });

  it("TR-EP-DIAL-013: [Given] non-throttle error [When] withRetries runs [Then] rejects without onThrottle", async () => {
    const fn = vi.fn().mockRejectedValue(
      Object.assign(new Error("boom"), { name: "ValidationException" })
    );
    const onThrottle = vi.fn();
    await expect(withRetries(fn, onThrottle)).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onThrottle).not.toHaveBeenCalled();
  });

  it("TR-EP-DIAL-014: [Given] throttle then success [When] withRetries runs [Then] resolves after retry", async () => {
    vi.useFakeTimers();
    let n = 0;
    const fn = vi.fn(async () => {
      n += 1;
      if (n === 1) {
        const e = new Error("throttled");
        e.name = "TooManyRequestsException";
        throw e;
      }
      return "ok";
    });
    const onThrottle = vi.fn();
    const p = withRetries(fn, onThrottle);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onThrottle).toHaveBeenCalledTimes(1);
  });
});
