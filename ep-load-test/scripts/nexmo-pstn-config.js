const fs = require("fs");
const path = require("path");

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index !== -1 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return null;
}

function loadMeetingsFromConfig() {
  const configPath =
    process.env.MEETINGS_CONFIG_PATH ||
    getArg("--config") ||
    path.join(__dirname, "meetings-config.dev.json");

  try {
    if (fs.existsSync(configPath)) {
      const configData = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (configData.meetings && Array.isArray(configData.meetings)) {
        const slots = [];

        for (const meeting of configData.meetings) {
          const meetingId = String(meeting.meetingId);

          if (meeting.analysts && Array.isArray(meeting.analysts)) {
            for (const analyst of meeting.analysts) {
              slots.push({
                meetingId,
                pin: analyst.pin || "",
                analystEmail: analyst.email || "",
              });
            }
          }
          else if (meeting.pin !== undefined) {
            slots.push({
              meetingId,
              pin: meeting.pin || "",
              analystEmail: "",
            });
          }
          else {
            slots.push({
              meetingId,
              pin: "",
              analystEmail: "",
            });
          }
        }

        return slots;
      }
    }
  } catch (error) {
    console.warn(`Warning: Failed to load meetings config: ${error.message}`);
  }
  return [];
}

const meetingSlots = loadMeetingsFromConfig();

console.log(`[${meetingSlots}] Meeting slots loaded`);

const config = {
  targetConcurrent: parseInt(
    process.env.TARGET_CONCURRENT || getArg("--target-concurrent") || "1",
    10
  ),
  arrivalRate: parseFloat(
    process.env.ARRIVAL_RATE || getArg("--arrival-rate") || "5"
  ),
  callDuration: parseInt(
    process.env.CALL_DURATION_SECONDS || getArg("--call-duration") || "120",
    10
  ),
  testDuration: parseInt(
    process.env.TEST_DURATION || getArg("--test-duration") || "60",
    10
  ),
  dryRun: process.argv.includes("--dry-run"),

  nexmo: {
    apiKey: process.env.NEXMO_API_KEY,
    apiSecret: process.env.NEXMO_API_SECRET,
    applicationId: process.env.NEXMO_APPLICATION_ID,
    privateKeyPath: process.env.NEXMO_PRIVATE_KEY_PATH,
    fromNumber: process.env.NEXMO_FROM_NUMBER,
  },

  chime: {
    pstnNumber: process.env.CHIME_PSTN_NUMBER,
  },

  ivr: {
    slots: meetingSlots,
    greetingDelayMs: parseInt(process.env.IVR_GREETING_DELAY_MS || "2000", 10),
    meetingIdDelayMs: parseInt(
      process.env.IVR_MEETING_ID_DELAY_MS || "10000",
      10
    ),
    jitterMs: parseInt(process.env.IVR_JITTER_MS || "1000", 10),
  },

  webhook: {
    enabled: process.env.WEBHOOK_ENABLED === "true",
    port: parseInt(process.env.WEBHOOK_PORT || "3000", 10),
    baseUrl: process.env.WEBHOOK_BASE_URL || "",
  },
};

module.exports = { config };
