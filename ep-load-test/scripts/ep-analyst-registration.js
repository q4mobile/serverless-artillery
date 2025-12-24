#!/usr/bin/env node

/**
 * Analyst Registration Script
 *
 * This script registers analysts for meetings and retrieves their PINs.
 * It reads meeting IDs from meetings-config.json, generates fake analyst
 * data using faker.js, registers them, and saves the analyst info + PINs
 * back to the config file.
 *
 * Usage:
 *   node scripts/ep-analyst-registration.js [options]
 *
 * Options:
 *   --config <path>   Path to meetings config file (default: ./meetings-config.json)
 *   --force           Re-register even if analysts already exist
 *   --dry-run         Don't make actual API calls or update config
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const { randomUUID } = require("crypto");
const { faker } = require("@faker-js/faker");

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function saveConfig(configPath, config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

function generateAnalyst(index) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const company = faker.company.name();

  return {
    email: faker.internet.email({
      firstName,
      lastName,
      provider: "loadtest.q4inc.com",
    }),
    firstName,
    lastName,
    companyName: company,
    phoneNumber: faker.phone.number({ style: "international" }),
    pin: null,
  };
}

function fetchAuthToken(baseUrl, meetingId) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/rest/v1/auth/token/${meetingId}`, baseUrl);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: "GET",
      headers: {
        Accept: "*/*",
        Referer: baseUrl.replace("attendees.", ""),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const response = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300 && response.success) {
            resolve({
              token: response.data.token,
              permissions: response.data.permissions,
            });
          } else {
            reject(
              new Error(
                `Auth token error ${res.statusCode}: ${response.message || data}`
              )
            );
          }
        } catch (parseError) {
          reject(new Error(`Failed to parse auth response: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

function buildRegistrationPayload(meetingId, analystPassword, analyst, authToken, permissions) {
  return {
    meetingId: Number(meetingId),
    wsConnectionId: randomUUID(),
    email: analyst.email,
    firstName: analyst.firstName,
    lastName: analyst.lastName,
    attendeeType: "ANALYST",
    registrationType: "LOBBY",
    type: "GUEST",
    companyName: analyst.companyName,
    phoneNumber: analyst.phoneNumber,
    analystRegistrationPassword: analystPassword,
    token: authToken,
    permissions: permissions || {
      "attendee:base:permission": true,
      "attendee:manage:attendee": true,
      "attendee:read:questions": true,
      "attendee:submit:questions": true,
      "attendee:view:broadcast": true,
    },
    originType: "analyst",
  };
}

function registerAnalyst(baseUrl, payload, authToken) {
  return new Promise((resolve, reject) => {
    const url = new URL("/rest/v1/attendee", baseUrl);
    const postData = JSON.stringify(payload);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "Content-Length": Buffer.byteLength(postData),
        Accept: "*/*",
        Authorization: `Bearer ${authToken}`,
        Referer: baseUrl.replace("attendees.", ""),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const response = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(response);
          } else {
            reject(
              new Error(
                `API error ${res.statusCode}: ${response.message || data}`
              )
            );
          }
        } catch (parseError) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

function extractPin(response) {
  if (response?.data?.conferenceDetails?.analystPin) {
    return response.data.conferenceDetails.analystPin;
  }
  if (response?.data?.webinarDetails?.passcode) {
    return response.data.webinarDetails.passcode;
  }
  return null;
}

async function processRegistrations(configPath, options) {
  const config = loadConfig(configPath);
  const { dryRun, force } = options;

  // Calculate total analysts to register
  let totalToRegister = 0;
  for (const meeting of config.meetings) {
    const existingCount = (meeting.analysts || []).length;
    const targetCount = meeting.desiredAnalystCount || 1;
    if (force) {
      totalToRegister += targetCount;
    } else {
      totalToRegister += Math.max(0, targetCount - existingCount);
    }
  }

  console.log("\n📋 Analyst Registration Script");
  console.log("═".repeat(60));
  console.log(`  Environment:        ${config.environment}`);
  console.log(`  Base URL:           ${config.baseUrl}`);
  console.log(`  Total Meetings:     ${config.meetings.length}`);
  console.log(`  Analysts to Create: ${totalToRegister}`);
  console.log(`  Dry Run:            ${dryRun}`);
  console.log(`  Force Re-register:  ${force}`);
  console.log("═".repeat(60));

  let registered = 0;
  let skipped = 0;
  let failed = 0;
  let configUpdated = false;

  for (let m = 0; m < config.meetings.length; m++) {
    const meeting = config.meetings[m];
    const meetingId = meeting.meetingId;
    const meetingIndex = m + 1;
    const targetCount = meeting.desiredAnalystCount || 1;

    console.log(`\n📅 Meeting ${meetingIndex}: ${meetingId}`);
    console.log("─".repeat(40));

    if (!meeting.analystRegistrationPassword) {
      console.log(`  ⚠️  Skipping - No analyst registration password configured`);
      skipped += targetCount;
      continue;
    }

    // Initialize analysts array if not present
    if (!meeting.analysts) {
      meeting.analysts = [];
    }

    // If force, clear existing analysts
    if (force && meeting.analysts.length > 0) {
      console.log(`  🔄 Force mode: clearing ${meeting.analysts.length} existing analysts`);
      meeting.analysts = [];
      configUpdated = true;
    }

    // Calculate how many analysts we need to create
    const existingCount = meeting.analysts.length;
    const toCreate = targetCount - existingCount;

    if (toCreate <= 0) {
      console.log(`  ✓ Already has ${existingCount} analysts (target: ${targetCount})`);
      skipped += existingCount;
      continue;
    }

    // Fetch auth token for this meeting
    let authToken = null;
    let permissions = null;

    if (!dryRun) {
      try {
        console.log(`  🔑 Fetching auth token...`);
        const authData = await fetchAuthToken(config.baseUrl, meetingId);
        authToken = authData.token;
        permissions = authData.permissions;
        console.log(`  ✓ Auth token obtained`);
      } catch (error) {
        console.error(`  ❌ Failed to get auth token: ${error.message}`);
        failed += toCreate;
        continue;
      }
    }

    console.log(`  Creating ${toCreate} new analyst(s)...`);

    for (let a = 0; a < toCreate; a++) {
      const analystIndex = existingCount + a + 1;

      // Generate random analyst data
      const analyst = generateAnalyst(analystIndex);

      const analystLabel = `[${meetingId}][Analyst ${analystIndex}]`;

      console.log(`  ${analystLabel} Generating: ${analyst.firstName} ${analyst.lastName}`);
      console.log(`    Email: ${analyst.email}`);

      if (dryRun) {
        console.log(`  ${analystLabel} [DRY-RUN] Would register`);
        meeting.analysts.push(analyst);
        configUpdated = true;
        continue;
      }

      try {
        const payload = buildRegistrationPayload(
          meetingId,
          meeting.analystRegistrationPassword,
          analyst,
          authToken,
          permissions
        );
        const response = await registerAnalyst(config.baseUrl, payload, authToken);

        if (!response.success) {
          throw new Error(response.message || "Registration failed");
        }

        const pin = extractPin(response);
        if (pin) {
          analyst.pin = pin;
          meeting.analysts.push(analyst);
          configUpdated = true;
          registered++;
          console.log(`  ${analystLabel} ✅ Registered - PIN: ${pin}`);
        } else {
          console.log(`  ${analystLabel} ⚠️  No PIN in response`);
          console.log(`    Response: ${JSON.stringify(response.data, null, 2)}`);
          failed++;
        }
      } catch (error) {
        console.error(`  ${analystLabel} ❌ Failed: ${error.message}`);
        failed++;
      }
    }
  }

  if (configUpdated) {
    saveConfig(configPath, config);
    console.log(`\n✅ Config file updated: ${configPath}`);
  }

  console.log("\n" + "═".repeat(60));
  console.log("📊 Registration Summary");
  console.log("═".repeat(60));
  console.log(`  Registered:  ${registered}`);
  console.log(`  Skipped:     ${skipped}`);
  console.log(`  Failed:      ${failed}`);
  console.log("═".repeat(60) + "\n");

  return { registered, skipped, failed };
}

async function main() {
  const configPath =
    getArg("--config") ||
    process.env.MEETINGS_CONFIG_PATH ||
    path.join(__dirname, "meetings-config.json");

  const options = {
    dryRun: process.argv.includes("--dry-run"),
    force: process.argv.includes("--force"),
  };

  try {
    const result = await processRegistrations(configPath, options);
    process.exit(result.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  loadConfig,
  saveConfig,
  generateAnalyst,
  fetchAuthToken,
  registerAnalyst,
  extractPin,
  processRegistrations,
};
