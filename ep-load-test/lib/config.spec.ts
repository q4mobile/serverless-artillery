import { afterEach, beforeEach, describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadConfig } = require("./config.js");

describe("config defaults", () => {
  const REQUIRED_ENV = {
    LOAD_TEST_SMA_ID: "test-sma",
    LOAD_TEST_FROM_PHONE: "+10000000000",
    LOAD_TEST_TO_PHONE: "+10000000001",
    DIALOUT_PARTICIPANTS_TABLE_NAME: "test-table"
  };

  beforeEach(() => {
    Object.assign(process.env, REQUIRED_ENV);
  });

  afterEach(() => {
    for (const key of Object.keys(REQUIRED_ENV)) {
      delete process.env[key];
    }
    delete process.env.DIALOUT_POLL_TIMEOUT_MS;
    delete process.env.DIALOUT_POLL_INTERVAL_MS;
  });

  it("TR-EP-CFG-001: [Given] DIALOUT_POLL_TIMEOUT_MS not set [When] loadConfig runs [Then] default is 60000ms", () => {
    const cfg = loadConfig();
    expect(cfg.dynamo.pollTimeoutMs).toBe(60_000);
  });

  it("TR-EP-CFG-002: [Given] DIALOUT_POLL_TIMEOUT_MS=30000 [When] loadConfig runs [Then] value is respected", () => {
    process.env.DIALOUT_POLL_TIMEOUT_MS = "30000";
    const cfg = loadConfig();
    expect(cfg.dynamo.pollTimeoutMs).toBe(30_000);
  });

  it("TR-EP-CFG-003: [Given] DIALOUT_POLL_INTERVAL_MS not set [When] loadConfig runs [Then] default is 400ms", () => {
    const cfg = loadConfig();
    expect(cfg.dynamo.pollIntervalMs).toBe(400);
  });
});
