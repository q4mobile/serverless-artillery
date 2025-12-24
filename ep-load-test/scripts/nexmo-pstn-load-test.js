#!/usr/bin/env node

/**
 * Standalone Nexmo PSTN Load Test Script
 *
 * This script provides fine-grained control over PSTN call load testing
 * for Amazon Chime SDK SIP Media Application.
 *
 * Features:
 * - Precise control over concurrent calls and arrival rate
 * - Real-time call status monitoring
 * - Detailed error tracking and categorization
 * - IVR navigation with timed DTMF sending (meeting ID + PIN)
 * - Graceful shutdown and call cleanup
 *
 * Usage:
 *   node scripts/nexmo-pstn-load-test.js [options]
 *
 * Options:
 *   --target-concurrent   Target number of concurrent calls (default: 100)
 *   --arrival-rate        Calls per second (default: 5)
 *   --call-duration       Call duration in seconds (default: 30)
 *   --test-duration       Total test duration in seconds (default: 300)
 *   --dry-run             Don't make actual calls, just simulate
 */
const { config } = require("./nexmo-pstn-config");
const { callTracker } = require("./call-tracker");
const { 
  initVonageClient, 
  initiateCall, 
  hangupCall, 
  enableWebhookMode,
  getAccountStats,
  isMultiAccountMode,
} = require("./nexmo-pstn-utils");
const { startWebhookServer, stopWebhookServer, isWebhookModeEnabled } = require("./webhook-server");

async function runLoadTest() {
  console.log("\n📊 Starting PSTN Load Test via Nexmo");
  console.log("═".repeat(60));
  console.log(`  Target Concurrent:  ${config.targetConcurrent} calls`);
  console.log(`  Arrival Rate:       ${config.arrivalRate} calls/sec`);
  console.log(`  Call Duration:      ${config.callDuration} seconds`);
  console.log(`  Test Duration:      ${config.testDuration} seconds`);
  console.log(`  Chime PSTN Number:  ${config.chime.pstnNumber || "Not configured"}`);
  console.log(`  Dry Run:            ${config.dryRun}`);
  console.log("─".repeat(60));
  console.log("  IVR Configuration:");
  const slots = config.ivr.slots || [];
  if (slots.length === 0) {
    console.log("    Slots:            Not configured (skipping IVR)");
  } else {
    const uniqueMeetings = new Set(slots.map(s => s.meetingId)).size;
    console.log(`    Total Slots:      ${slots.length} (${uniqueMeetings} meeting(s), round-robin)`);
    slots.forEach((slot, i) => {
      const analyst = slot.analystEmail ? ` - ${slot.analystEmail}` : "";
      const pin = slot.pin || "none";
      console.log(`      #${i + 1}: ${slot.meetingId} (PIN: ${pin})${analyst}`);
    });
  }
  console.log(`    Greeting Delay:   ${config.ivr.greetingDelayMs} ms`);
  console.log(`    Post-ID Delay:    ${config.ivr.meetingIdDelayMs} ms`);
  console.log(`    Jitter:           ${config.ivr.jitterMs} ms`);
  console.log("─".repeat(60));
  console.log("  Webhook Configuration:");
  if (isWebhookModeEnabled()) {
    console.log(`    Enabled:          Yes`);
    console.log(`    Port:             ${config.webhook.port}`);
    console.log(`    Base URL:         ${config.webhook.baseUrl || "Not configured"}`);
  } else {
    console.log(`    Enabled:          No (using timed delays with jitter)`);
  }
  console.log("═".repeat(60));
  console.log("");

  if (isWebhookModeEnabled()) {
    try {
      await startWebhookServer();
      enableWebhookMode();
    } catch (error) {
      console.error(`❌ Failed to start webhook server: ${error.message}`);
      console.log("   Falling back to timed delay mode with jitter");
    }
  }

  initVonageClient();

  const testStartTime = Date.now();
  const testEndTime = testStartTime + config.testDuration * 1000;
  const intervalMs = 1000 / config.arrivalRate;

  let callIndex = 0;

  const statsInterval = setInterval(() => {
    printStats();
  }, 5000);

  while (Date.now() < testEndTime) {
    if (callTracker.stats.currentActive < config.targetConcurrent) {
      initiateCall(++callIndex);
    }

    await sleep(intervalMs);
  }

  console.log("\n⏳ Waiting for remaining calls to complete...");
  await waitForCallsToComplete(30000);

  if (callTracker.stats.currentActive > 0) {
    console.log(`\n🛑 Terminating ${callTracker.stats.currentActive} remaining active calls...`);
    await terminateAllActiveCalls();
  }

  clearInterval(statsInterval);

  if (isWebhookModeEnabled()) {
    await stopWebhookServer();
  }

  printFinalReport();
}

async function waitForCallsToComplete(timeoutMs) {
  const startWait = Date.now();
  while (
    callTracker.stats.currentActive > 0 &&
    Date.now() - startWait < timeoutMs
  ) {
    await sleep(1000);
  }
}

async function terminateAllActiveCalls() {
  const activeCalls = [...callTracker.calls.entries()];

  await Promise.allSettled(
    activeCalls.map(async ([uuid, call]) => {
      try {
        if (!config.dryRun) {
          console.log(`[${call.callId}] Hanging up call: ${uuid}`);
          await hangupCall(uuid);
        }
      } catch (error) {
        console.error(`[${uuid}] Failed to hang up call:`, error.message);
      } finally {
        callTracker.completeCall(uuid, "completed");
      }
    })
  );
}

function printStats() {
  const stats = callTracker.getStats();
  const timestamp = new Date().toISOString().substr(11, 8);
  
  console.log(
    `[${timestamp}] ` +
    `Active: ${stats.currentActive}/${config.targetConcurrent} | ` +
    `Peak: ${stats.peakConcurrent} | ` +
    `Completed: ${stats.completed} | ` +
    `Failed: ${stats.failed} | ` +
    `Success: ${stats.successRate}`
  );
}

function printFinalReport() {
  const stats = callTracker.getStats();
  
  console.log("\n");
  console.log("═".repeat(60));
  console.log("📈 FINAL LOAD TEST REPORT");
  console.log("═".repeat(60));
  
  console.log("\n📊 Call Statistics:");
  console.log(`  Total Initiated:    ${stats.totalInitiated}`);
  console.log(`  Peak Concurrent:    ${stats.peakConcurrent}`);
  console.log(`  Completed:          ${stats.completed}`);
  console.log(`  Failed:             ${stats.failed}`);
  console.log(`  Success Rate:       ${stats.successRate}`);
  
  if (Object.keys(stats.errorBreakdown).length > 0) {
    console.log("\n❌ Error Breakdown:");
    for (const [error, count] of Object.entries(stats.errorBreakdown)) {
      console.log(`  ${error}: ${count}`);
    }
  }

  // Show per-account statistics if multi-account mode
  if (isMultiAccountMode()) {
    const accountStats = getAccountStats();
    console.log("\n📱 Per-Account Statistics:");
    accountStats.forEach(account => {
      const successRate = account.callCount > 0 
        ? ((account.callCount - account.errorCount) / account.callCount * 100).toFixed(1) + '%'
        : 'N/A';
      console.log(`  ${account.name}: ${account.callCount} calls, ${account.errorCount} errors (${successRate} success)`);
    });
  }

  console.log("\n" + "═".repeat(60));
  console.log("\n");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n\n🛑 Received ${signal}. Initiating graceful shutdown...`);

  if (callTracker.stats.currentActive > 0) {
    console.log(`Terminating ${callTracker.stats.currentActive} active calls...`);
    await terminateAllActiveCalls();
  }

  if (isWebhookModeEnabled()) {
    await stopWebhookServer();
  }

  printFinalReport();
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

if (require.main === module) {
  runLoadTest().catch(error => {
    console.error("❌ Load test failed:", error.message);
    process.exit(1);
  });
}

module.exports = {
  runLoadTest,
  callTracker,
  config,
};

