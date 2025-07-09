const WebSocket = require("ws");
const { v4: uuid } = require("uuid");
const {
  onFeatureFlags,
  onEventPeriodUpdated,
  onAssetsUpdated,
  onBroadcastStatusUpdated,
  onEventDisasterRecoveryUpdated,
  onEventQuestionSettingUpdated,
  onDualStreamStatusUpdated
} = require("./definitions");

const connectToWebSocket = (url, payload) => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, ["graphql-transport-ws"]);
    ws.on("open", () => {
      //   console.debug("WebSocket connection opened");
      const message = JSON.stringify({ type: "connection_init", payload });
      ws.send(message, err => {
        if (err) {
          console.error(err);
        }
        console.log("Connected to WebSocket");
      });
    });
    ws.on("message", function(msg) {
      // console.debug("MSG: %s", msg);
      resolve(ws);
    });
    ws.on("error", function(err) {
      console.error(err);
      reject(err);
    });
  });
};

const sendSubscription = (ws, message) => {
  return new Promise(resolve => {
    ws.send(message, err => {
      if (err) {
        console.error(err);
      }
      resolve();
    });
  });
};

const triggerSubscriptions = async (ws, meetingId) => {
  onFeatureFlags.payload.variables.meetingId = meetingId;
  const _featureFlags = JSON.stringify({
    id: uuid(),
    ...onFeatureFlags
  });
  onEventPeriodUpdated.payload.variables.meetingId = meetingId;
  const _onEventPeriodUpdated = JSON.stringify({
    id: uuid(),
    ...onEventPeriodUpdated
  });
  onAssetsUpdated.payload.variables.meetingId = meetingId;
  const _onAssetsUpdated = JSON.stringify({
    id: uuid(),
    ...onAssetsUpdated
  });
  onBroadcastStatusUpdated.payload.variables.meetingId = meetingId;
  const _onBroadcastStatusUpdated = JSON.stringify({
    id: uuid(),
    ...onBroadcastStatusUpdated
  });
  onEventDisasterRecoveryUpdated.payload.variables.meetingId = meetingId;
  const _onEventDisasterRecoveryUpdated = JSON.stringify({
    id: uuid(),
    ...onEventDisasterRecoveryUpdated
  });
  onEventQuestionSettingUpdated.payload.variables.meetingId = meetingId;
  const _onEventQuestionSettingUpdated = JSON.stringify({
    id: uuid(),
    ...onEventQuestionSettingUpdated
  });
  onDualStreamStatusUpdated.payload.variables.meetingId = meetingId;
  const _onDualStreamStatusUpdated = JSON.stringify({
    id: uuid(),
    ...onDualStreamStatusUpdated
  });

  await Promise.allSettled([
    sendSubscription(ws, _featureFlags),
    sendSubscription(ws, _onEventPeriodUpdated),
    sendSubscription(ws, _onAssetsUpdated),
    sendSubscription(ws, _onBroadcastStatusUpdated),
    sendSubscription(ws, _onEventDisasterRecoveryUpdated),
    sendSubscription(ws, _onEventQuestionSettingUpdated),
    sendSubscription(ws, _onDualStreamStatusUpdated)
  ]);
};

let startScenarioTime = null;
let endTime = null;

const keepWSAlive = (ws, options = {}) => {
  if (!startScenarioTime) startScenarioTime = new Date();
  if (!endTime)
    endTime = new Date(startScenarioTime.getTime() + 1000 * options?.duration);
  return new Promise(async resolve => {
    const currentTime = new Date();
    const timeToEnd = Math.min(Math.abs(endTime - currentTime), 300 * 1000);
    let sendSubscriptionTimeout = null;

    const setSendSubscriptionTimeout = message => {
      if (message) {
        // console.log("Pong");
      }
      sendSubscriptionTimeout = setTimeout(() => {
        // console.log("Ping");
        ws.ping();
      }, 20000);
    };

    ws.on("pong", setSendSubscriptionTimeout);
    setSendSubscriptionTimeout();

    setTimeout(() => {
      clearTimeout(sendSubscriptionTimeout);
      resolve();
    }, options?.time ?? timeToEnd);
  });
};

const executeSubscription = async (context, _, next) => {
  const {
    meetingId = 996757489,
    wsConnectionId = "",
    attendeeId = "",
    wsUrl = "",
    access_token = ""
    testDuration = 10
  } = context?.vars ?? {};
  let ws = null;

  try {
    ws = await connectToWebSocket(wsUrl, {
      Authorization: `Bearer ${access_token}`,
      eventId: meetingId,
      participantRole: "ep - attendee - guest",
      userId: attendeeId,
      wsConnectionId
    });
    await triggerSubscriptions(ws, meetingId);

    await keepWSAlive(ws, { duration: testDuration });
  } catch (error) {
    console.error(error);
  } finally {
    console.log("Closing WebSocket connection", ws?.readyState);
    ws?.close();
  }

  //   console.log("Subscriptions triggered");

  next?.();
};

// executeSubscription();

module.exports = {
  executeSubscription
};
