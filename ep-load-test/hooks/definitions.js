const onFeatureFlags = {
  type: "subscribe",
  payload: {
    variables: {},
    extensions: {},
    operationName: "FEATURE_FLAG_SUBSCRIPTION",
    query: "subscription FEATURE_FLAG_SUBSCRIPTION { onFeatureFlagsChange }"
  }
};
const onEventPeriodUpdated = {
  type: "subscribe",
  payload: {
    variables: {},
    extensions: {},
    query: `subscription ($meetingId: Int) {
                onEventStartPeriodUpdated(meetingId: $meetingId) {
                  event {
                    meetingId
                    branding {
                      registrationPageBranding {
                        broadridgeTelephoneNumber 
                        broadridgeInternationalTelephoneNumber 
                        title 
                        description 
                        openRegistration 
                        proxyWebsiteLink
                        termsAndConditionsUrl
                      }
                    }
                  }
                  isEventStarted
                }
              }`
  }
};

const onAssetsUpdated = {
  type: "subscribe",
  payload: {
    variables: {},
    extensions: {},
    query: `subscription ($meetingId: Int) {
          onAssetsUpdated(meetingId: $meetingId, contentType: SLIDES)
        }`
  }
};

const onBroadcastStatusUpdated = {
  type: "subscribe",
  payload: {
    variables: {},
    extensions: {},
    operationName: "BROADCAST_STATUS_SUBSCRIPTION",
    query: `subscription BROADCAST_STATUS_SUBSCRIPTION($meetingId: Int) {
          onBroadcastStatusUpdated(meetingId: $meetingId) {
            status
            context
            startTime
            broadcastUrl
          }
        }`
  }
};
const onEventDisasterRecoveryUpdated = {
  type: "subscribe",
  payload: {
    variables: {},
    extensions: {},
    query: `subscription ($meetingId: Int) {
          onEventDisasterRecoveryUpdated(meetingId: $meetingId) {
            enabled
            redirectUrl
          }
        }`
  }
};

const onEventQuestionSettingUpdated = {
  type: "subscribe",
  payload: {
    variables: {},
    extensions: {},
    operationName: "QUESTION_STATUS_SUBSCRIPTION",
    query: `subscription ($meetingId: Int) {
          onEventQuestionSettingUpdated(meetingId: $meetingId) {
            settings {
              questionEnabled
            }
          }
        }`
  }
};

module.exports = {
  onFeatureFlags,
  onEventPeriodUpdated,
  onAssetsUpdated,
  onBroadcastStatusUpdated,
  onEventDisasterRecoveryUpdated,
  onEventQuestionSettingUpdated
};
