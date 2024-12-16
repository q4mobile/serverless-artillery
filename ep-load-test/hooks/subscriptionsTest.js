const WebSocket = require("ws");
const { v4: uuid } = require("uuid");
const {
  onFeatureFlags,
  onEventPeriodUpdated,
  onAssetsUpdated,
  onBroadcastStatusUpdated,
  onEventDisasterRecoveryUpdated,
  onEventQuestionSettingUpdated
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
        resolve(ws);
      });
    });
    // ws.on("message", function(msg) {
    //   console.debug("MSG: %s", msg);
    // });
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

  await Promise.allSettled([
    sendSubscription(ws, _featureFlags),
    sendSubscription(ws, _onEventPeriodUpdated),
    sendSubscription(ws, _onAssetsUpdated),
    sendSubscription(ws, _onBroadcastStatusUpdated),
    sendSubscription(ws, _onEventDisasterRecoveryUpdated),
    sendSubscription(ws, _onEventQuestionSettingUpdated)
  ]);
};

const startScenarioTime = new Date();
// const endTime = new Date(startScenarioTime.getTime() + 1000 * 60 * 5); // 5 mins
const endTime = new Date(startScenarioTime.getTime() + 1000 * 10); // 11 seconds

const keepWSAlive = (ws, time) => {
  return new Promise(async resolve => {
    const currentTime = new Date();
    const timeToEnd = Math.abs(endTime - currentTime);
    let sendSubscriptionTimeout = null;
    const setSendSubscriptionTimeout = () =>
      (sendSubscriptionTimeout = setTimeout(() => {
        sendSubscription(ws, JSON.stringify({ type: "ping" }));
      }, 20000));
    ws.on("pong", setSendSubscriptionTimeout);
    setSendSubscriptionTimeout();

    setTimeout(() => {
      clearTimeout(sendSubscriptionTimeout);
      resolve();
    }, time ?? timeToEnd);
  });
};

const executeSubscription = async (context, _, next) => {
  const {
    meetingId = 996757489,
    wsConnectionId = "",
    attendeeId = "",
    wsUrl = "",
    access_token = ""
  } = context?.vars ?? {};
  let ws = null;

  try {
    ws = await connectToWebSocket(wsUrl, {
      Authorization: `Bearer ${access_token}`,
      eventId: meetingId,
      isSocketReconnect: true,
      participantRole: "ep - attendee - guest",
      userId: attendeeId,
      wsConnectionId
    });
    await triggerSubscriptions(ws, meetingId);
    await keepWSAlive(ws);
  } catch (error) {
    console.error(error);
  } finally {
    ws?.close();
  }

  //   console.log("Subscriptions triggered");

  next?.();
};

// executeSubscription();

module.exports = {
  executeSubscription
};
