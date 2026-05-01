export const GENERATE_USER_EVENT_ACCESS_TOKEN_MUTATION = `
  mutation GENERATE_USER_EVENT_ACCESS_TOKEN($meetingId: Int!) {
    generateUserEventAccessToken(meetingId: $meetingId) {
      accessToken
    }
  }
`;

export function buildTokenExchangeBody(meetingId: number): Record<string, unknown> {
  return {
    query: GENERATE_USER_EVENT_ACCESS_TOKEN_MUTATION,
    variables: { meetingId },
  };
}

export const START_BROADCAST_MUTATION = `
  mutation START_BROADCAST_MUTATION($meetingId: Int) {
    startEventBroadcast(meetingId: $meetingId) {
      status
      broadcastUrl
      backupBroadcastUrl
      startTime
      captionsUrl
      backupCaptionsUrl
    }
  }
`;

export const STOP_BROADCAST_MUTATION = `
  mutation STOP_BROADCAST_MUTATION($meetingId: Int, $context: BroadcastContextEnum) {
    stopEventBroadcast(meetingId: $meetingId, context: $context) {
      status
      context
    }
  }
`;

export function buildStartBroadcastBody(meetingId: number): Record<string, unknown> {
  return {
    query: START_BROADCAST_MUTATION,
    variables: { meetingId },
  };
}

export function buildStopBroadcastBody(
  meetingId: number,
  context: string
): Record<string, unknown> {
  return {
    query: STOP_BROADCAST_MUTATION,
    variables: { meetingId, context },
  };
}
