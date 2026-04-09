import { describe, expect, it, vi } from 'vitest';

async function importDialOutProcessor(): Promise<unknown> {
  return import('./dialOutProcessor.js');
}

describe('dialOutProcessor import guards', () => {
  it('TR-EP-DIAL-003: [Given] processor env points to production SMA [When] module is loaded [Then] import throws fatal safety error', async () => {
    vi.resetModules();
    process.env.LOAD_TEST_SMA_ID = 'sma-test-123';
    process.env.LOAD_TEST_FROM_PHONE = '+14155551234';
    process.env.LOAD_TEST_TO_PHONE = '+14155559999';
    process.env.DIALOUT_PARTICIPANTS_TABLE_NAME = 'tbl';
    process.env.PRODUCTION_SMA_ID = 'sma-test-123';
    await expect(importDialOutProcessor()).rejects.toThrow(/refusing to route test traffic through production SMA/i);
  });

  it('TR-EP-DIAL-004: [Given] DIALOUT_PARTICIPANTS_TABLE_NAME unset [When] module is loaded [Then] import throws', async () => {
    vi.resetModules();
    process.env.LOAD_TEST_SMA_ID = 'sma-test-123';
    process.env.LOAD_TEST_FROM_PHONE = '+14155551234';
    process.env.LOAD_TEST_TO_PHONE = '+14155559999';
    delete process.env.DIALOUT_PARTICIPANTS_TABLE_NAME;
    await expect(importDialOutProcessor()).rejects.toThrow(/DIALOUT_PARTICIPANTS_TABLE_NAME is required/i);
  });
});
