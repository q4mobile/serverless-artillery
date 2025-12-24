const http = require("http");
const { config } = require("./nexmo-pstn-config");
const { callTracker } = require("./call-tracker");

const pendingNavigations = new Map();

let ivrNavigationHandler = null;
let server = null;

function setIvrNavigationHandler(handler) {
  ivrNavigationHandler = handler;
}

function registerPendingNavigation(uuid, callId, meeting, clientInfo = null) {
  pendingNavigations.set(uuid, { callId, meeting, clientInfo, registeredAt: Date.now() });
}

function handleVonageEvent(event) {
  const { uuid, status, direction, timestamp } = event;

  if (!uuid) {
    return;
  }

  const callInfo = callTracker.calls.get(uuid);
  if (callInfo) {
    callTracker.updateCall(uuid, { 
      vonageStatus: status,
      lastEventAt: timestamp || new Date().toISOString(),
    });
  }

  const callId = callInfo?.callId || uuid.substring(0, 8);
  
  switch (status) {
    case "started":
      console.log(`[${callId}] 📞 Call started (${direction})`);
      break;

    case "ringing":
      console.log(`[${callId}] 🔔 Call ringing`);
      break;

    case "answered":
      console.log(`[${callId}] ✅ Call answered - triggering IVR navigation`);
      handleCallAnswered(uuid);
      break;

    case "completed":
      console.log(`[${callId}] 📴 Call completed`);
      cleanupCall(uuid);
      break;

    case "failed":
    case "rejected":
    case "busy":
    case "timeout":
    case "cancelled":
      console.log(`[${callId}] ❌ Call ${status}`);
      cleanupCall(uuid, "failed");
      break;

    default:
      // Log other events at debug level
      if (process.env.DEBUG_WEBHOOKS === "true") {
        console.log(`[${callId}] 📨 Event: ${status}`);
      }
  }
}

function handleCallAnswered(uuid) {
  const pending = pendingNavigations.get(uuid);
  
  if (!pending) {
    console.warn(`[${uuid.substring(0, 8)}] No pending navigation found for answered call`);
    return;
  }

  const { callId, meeting, clientInfo } = pending;
  pendingNavigations.delete(uuid);

  callTracker.updateCall(uuid, { 
    status: "answered",
    answeredAt: Date.now(),
  });

  if (ivrNavigationHandler && meeting) {
    const audioSettleDelay = 500;
    setTimeout(() => {
      ivrNavigationHandler(uuid, callId, meeting, clientInfo);
    }, audioSettleDelay);
  }
}

function cleanupCall(uuid, status = "completed") {
  pendingNavigations.delete(uuid);
  
  const callInfo = callTracker.calls.get(uuid);
  if (callInfo && callInfo.status !== "completed" && callInfo.status !== "failed") {
    callTracker.completeCall(uuid, status);
  }
}

function parseRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error.message}`));
      }
    });
    req.on("error", reject);
  });
}

function startWebhookServer() {
  return new Promise((resolve, reject) => {
    const port = config.webhook.port;

    server = http.createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          status: "ok", 
          pendingNavigations: pendingNavigations.size,
          activeCalls: callTracker.stats.currentActive,
        }));
        return;
      }

      if (req.method === "POST" && req.url === "/webhooks/events") {
        try {
          const event = await parseRequestBody(req);
          handleVonageEvent(event);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ received: true }));
        } catch (error) {
          console.error("Error processing webhook:", error.message);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      if (req.method === "POST" && req.url === "/webhooks/answer") {
        try {
          const event = await parseRequestBody(req);
          if (process.env.DEBUG_WEBHOOKS === "true") {
            console.log("Answer webhook received:", JSON.stringify(event));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify([]));
        } catch (error) {
          console.error("Error processing answer webhook:", error.message);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    });

    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(error);
      }
    });

    server.listen(port, () => {
      console.log(`🌐 Webhook server listening on port ${port}`);
      if (config.webhook.baseUrl) {
        console.log(`   Event URL: ${config.webhook.baseUrl}/webhooks/events`);
        console.log(`   Answer URL: ${config.webhook.baseUrl}/webhooks/answer`);
      } else {
        console.log(`   ⚠️  WEBHOOK_BASE_URL not set - Vonage won't be able to send events`);
        console.log(`   Use ngrok or similar: ngrok http ${port}`);
      }
      resolve(server);
    });
  });
}

function stopWebhookServer() {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        console.log("🛑 Webhook server stopped");
        resolve();
      });
    } else {
      resolve();
    }
  });
}

function getWebhookUrls() {
  if (!config.webhook.enabled || !config.webhook.baseUrl) {
    return null;
  }

  return {
    eventUrl: `${config.webhook.baseUrl}/webhooks/events`,
    answerUrl: `${config.webhook.baseUrl}/webhooks/answer`,
  };
}

function isWebhookModeEnabled() {
  return config.webhook.enabled && config.webhook.baseUrl;
}

module.exports = {
  startWebhookServer,
  stopWebhookServer,
  registerPendingNavigation,
  setIvrNavigationHandler,
  getWebhookUrls,
  isWebhookModeEnabled,
  pendingNavigations,
};
