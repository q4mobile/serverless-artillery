const https = require("https");
const { config } = require("./nexmo-pstn-config");
const { getVonageJwt } = require("./nexmo-jwt");
const { callTracker } = require("./call-tracker");
const { 
  registerPendingNavigation, 
  getWebhookUrls, 
  isWebhookModeEnabled,
  setIvrNavigationHandler,
} = require("./webhook-server");
const {
  initMultiAccountClients,
  getNextClient,
  getJwtForAccount,
  recordAccountError,
  getAccountCount,
  isMultiAccountMode,
  getAccountStats,
} = require("./nexmo-multi-account");

let slotCounter = 0;
let webhookModeActive = false;
let multiAccountInitialized = false;

function initVonageClient() {
  if (config.dryRun) {
    console.log("🔧 Dry run mode - no actual calls will be made");
    return null;
  }

  if (!config.chime.pstnNumber) {
    throw new Error(
      "Missing phone number configuration.\n" +
        "Required: CHIME_PSTN_NUMBER"
    );
  }

  initMultiAccountClients();
  multiAccountInitialized = true;

  return { accountCount: getAccountCount() };
}

function getNextMeeting() {
  const { slots } = config.ivr;

  if (!slots || slots.length === 0) {
    return null;
  }

  const index = slotCounter % slots.length;
  slotCounter++;
  const slot = slots[index];

  return {
    meetingId: slot.meetingId,
    meetingPin: slot.pin || "",
    analystEmail: slot.analystEmail || "",
    slotIndex: index,
    meetingIndex: index,
  };
}

function buildNcco() {
  const ncco = [
    {
      action: "conversation",
      name: `loadtest-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      startOnEnter: true,
      endOnExit: true,
    },
  ];

  return ncco;
}

function getEventUrlOptions() {
  const webhookUrls = getWebhookUrls();
  if (!webhookUrls) {
    return {};
  }

  return {
    eventUrl: [webhookUrls.eventUrl],
    eventMethod: "POST",
  };
}

function extractErrorMessage(error) {
  if (error.response?.data) {
    const data = error.response.data;
    return data.title || data.detail || data.message || JSON.stringify(data);
  }
  return error.message || "Unknown error";
}

function isRateLimitError(error) {
  // Check HTTP status code
  if (error.response?.status === 429 || error.statusCode === 429) {
    return true;
  }
  // Check error message for rate limit indicators
  const message = (error.message || "").toLowerCase();
  if (message.includes("429") || message.includes("rate limit") || message.includes("too many requests")) {
    return true;
  }
  return false;
}

async function sendDtmf(uuid, digits, clientInfo = null) {
  const callInfo = callTracker.calls.get(uuid);
  if (
    !callInfo ||
    callInfo.status === "completed" ||
    callInfo.status === "failed"
  ) {
    throw new Error("Call is no longer active");
  }

  const token = clientInfo ? getJwtForAccount(clientInfo) : getVonageJwt();

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ digits });

    const options = {
      hostname: "api.nexmo.com",
      port: 443,
      path: `/v1/calls/${uuid}/dtmf`,
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        Authorization: `Bearer ${token}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data || "{}"));
        } else {
          reject(new Error(`DTMF request failed: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function hangupCall(uuid, clientInfo = null) {
  const callInfo = callTracker.calls.get(uuid);
  if (
    !callInfo ||
    callInfo.status === "completed" ||
    callInfo.status === "failed"
  ) {
    return;
  }

  const storedClientInfo = callInfo.clientInfo;
  const tokenSource = clientInfo || storedClientInfo;
  const token = tokenSource ? getJwtForAccount(tokenSource) : getVonageJwt();

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ action: "hangup" });

    const options = {
      hostname: "api.nexmo.com",
      port: 443,
      path: `/v1/calls/${uuid}`,
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        Authorization: `Bearer ${token}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data || "{}"));
        } else {
          reject(
            new Error(`Hangup request failed: ${res.statusCode} - ${data}`)
          );
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

function addJitter(baseDelay, jitterMs = 2000) {
  return baseDelay + Math.floor(Math.random() * jitterMs);
}

function scheduleIvrNavigation(uuid, callId, meeting, clientInfo = null) {
  const { greetingDelayMs, meetingIdDelayMs, jitterMs } = config.ivr;

  if (!meeting || !meeting.meetingId) {
    return;
  }

  const { meetingId, meetingPin, slotIndex, analystEmail } = meeting;
  const slotLabel = analystEmail 
    ? `slot #${slotIndex + 1} (${analystEmail})` 
    : `slot #${slotIndex + 1}`;

  const actualGreetingDelay = addJitter(greetingDelayMs, jitterMs);

  setTimeout(async () => {
    try {
      await sendDtmf(uuid, meetingId, clientInfo);
      console.log(`[${callId}] Sent meeting ID: ${meetingId} (${slotLabel})`);
      callTracker.updateCall(uuid, { ivrStep: "meeting_id_sent" });

      if (meetingPin) {
        const actualPinDelay = addJitter(meetingIdDelayMs, jitterMs);
        setTimeout(async () => {
          try {
            await sendDtmf(uuid, meetingPin, clientInfo);
            console.log(`[${callId}] Sent PIN: ${meetingPin} (${slotLabel})`);
            callTracker.updateCall(uuid, {
              ivrStep: "pin_sent",
              inMeeting: true,
            });
          } catch (error) {
            console.error(`[${callId}] Failed to send PIN:`, error.message);
            callTracker.recordError("DTMF_PIN_Error", error.message);
          }
        }, actualPinDelay);
      } else {
        callTracker.updateCall(uuid, { inMeeting: true });
      }
    } catch (error) {
      console.error(`[${callId}] Failed to send meeting ID:`, error.message);
      callTracker.recordError("DTMF_MeetingID_Error", error.message);
    }
  }, actualGreetingDelay);
}

function scheduleCallTermination(uuid, callId, clientInfo = null) {
  setTimeout(async () => {
    try {
      if (!config.dryRun) {
        console.log(`[${callId}] Terminating call: ${uuid}`);
        await hangupCall(uuid, clientInfo);
      }
      callTracker.completeCall(uuid, "completed");
    } catch (error) {
      console.error(
        `[${callId}] Failed to terminate call: ${uuid}, error: ${error.message}`
      );
      callTracker.completeCall(uuid, "completed");
    }
  }, config.callDuration * 1000);
}

async function initiateCall(callIndex) {
  const callId = `call_${callIndex}_${Date.now()}`;
  const meeting = getNextMeeting();

  console.log(`[${callId}] Initiating call: ${meeting.meetingId}`);

  if (config.dryRun) {
    const fakeUuid = `dry-run-${callId}`;
    callTracker.addCall(fakeUuid, { callId, dryRun: true, meeting });

    if (meeting) {
      console.log(
        `[${callId}] [DRY-RUN] Would join meeting #${
          meeting.meetingIndex + 1
        }: ${meeting.meetingId}`
      );
    }

    setTimeout(() => {
      callTracker.completeCall(fakeUuid, "completed");
    }, config.callDuration * 1000);

    return { success: true, uuid: fakeUuid };
  }

  const clientInfo = getNextClient();

  try {
    const ncco = buildNcco();

    if (!config.chime?.pstnNumber) {
      throw new Error("config.chime.pstnNumber is undefined");
    }
    if (!clientInfo.fromNumber) {
      throw new Error(`Account ${clientInfo.name}: fromNumber is undefined`);
    }

    const pstnNumber = config.chime.pstnNumber.replace("+", "");
    const fromNumber = clientInfo.fromNumber.replace("+", "");

    const callOptions = {
      to: [{ type: "phone", number: pstnNumber }],
      from: { type: "phone", number: fromNumber },
      ncco: ncco,
      ...getEventUrlOptions(),
    };

    const response = await clientInfo.client.voice.createOutboundCall(callOptions);

    const uuid = response.uuid;
    
    callTracker.addCall(uuid, { 
      callId, 
      meeting, 
      webhookMode: webhookModeActive,
      clientInfo: {
        index: clientInfo.index,
        name: clientInfo.name,
        applicationId: clientInfo.applicationId,
        privateKey: clientInfo.privateKey,
      },
      accountName: clientInfo.name,
    });

    if (webhookModeActive) {
      registerPendingNavigation(uuid, callId, meeting, clientInfo);
    } else {
      scheduleIvrNavigation(uuid, callId, meeting, clientInfo);
    }

    scheduleCallTermination(uuid, callId, clientInfo);

    return { success: true, uuid, account: clientInfo.name };
  } catch (error) {
    const errorType = error.name || "UnknownError";
    const errorMessage = extractErrorMessage(error);
    const isRateLimited = isRateLimitError(error);

    if (isRateLimited) {
      console.log(`[${callId}] [${clientInfo.name}] Rate limited (429):`, error.message);
      callTracker.recordError("RateLimited", errorMessage);
      callTracker.stats.rateLimited++;
    } else {
      console.log(`[${callId}] [${clientInfo.name}] Failed to initiate call:`, error.message);
      callTracker.recordError(errorType, errorMessage);
      callTracker.stats.failed++;
    }
    recordAccountError(clientInfo);

    return { success: false, error: errorMessage, account: clientInfo.name, rateLimited: isRateLimited };
  }
}

function startIvrNavigationOnAnswer(uuid, callId, meeting, clientInfo = null) {
  const { greetingDelayMs, meetingIdDelayMs, jitterMs } = config.ivr;

  if (!meeting || !meeting.meetingId) {
    return;
  }

  if (!clientInfo) {
    const callData = callTracker.calls.get(uuid);
    clientInfo = callData?.clientInfo || null;
  }

  const { meetingId, meetingPin, slotIndex, analystEmail } = meeting;
  const slotLabel = analystEmail 
    ? `slot #${slotIndex + 1} (${analystEmail})` 
    : `slot #${slotIndex + 1}`;

  const greetingWaitDelay = addJitter(greetingDelayMs, jitterMs / 2);

  setTimeout(async () => {
    try {
      await sendDtmf(uuid, meetingId, clientInfo);
      console.log(`[${callId}] Sent meeting ID: ${meetingId} (${slotLabel})`);
      callTracker.updateCall(uuid, { ivrStep: "meeting_id_sent" });

      if (meetingPin) {
        const pinWaitDelay = addJitter(meetingIdDelayMs, jitterMs / 2);
        setTimeout(async () => {
          try {
            await sendDtmf(uuid, meetingPin, clientInfo);
            console.log(`[${callId}] Sent PIN: ${meetingPin} (${slotLabel})`);
            callTracker.updateCall(uuid, {
              ivrStep: "pin_sent",
              inMeeting: true,
            });
          } catch (error) {
            console.error(`[${callId}] Failed to send PIN:`, error.message);
            callTracker.recordError("DTMF_PIN_Error", error.message);
          }
        }, pinWaitDelay);
      } else {
        callTracker.updateCall(uuid, { inMeeting: true });
      }
    } catch (error) {
      console.error(`[${callId}] Failed to send meeting ID:`, error.message);
      callTracker.recordError("DTMF_MeetingID_Error", error.message);
    }
  }, greetingWaitDelay);
}

function enableWebhookMode() {
  if (isWebhookModeEnabled()) {
    webhookModeActive = true;
    setIvrNavigationHandler(startIvrNavigationOnAnswer);
    console.log("📡 Webhook mode enabled - IVR will trigger on call answer events");
    return true;
  }
  return false;
}

module.exports = {
  initVonageClient,
  sendDtmf,
  hangupCall,
  initiateCall,
  enableWebhookMode,
  getAccountStats,
  isMultiAccountMode,
  getAccountCount,
};
