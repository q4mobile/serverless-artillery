export const START_EVENT_MUTATION = `
  mutation START_EVENT_MUTATION($meetingId: Int) {
    startEvent(meetingId: $meetingId) {
      meetingId
      title
      status
    }
  }
`;

export const UPDATE_EVENT_STATUS_MUTATION = `
  mutation UPDATE_EVENT_STATUS_MUTATION($meetingId: Int, $status: EventStatusEnum) {
    updateEventStatus(meetingId: $meetingId, status: $status) {
      meetingId
      title
      status
    }
  }
`;

export function buildStartEventBody(meetingId: number): Record<string, unknown> {
  return {
    query: START_EVENT_MUTATION,
    variables: { meetingId },
  };
}

export function buildUpdateEventStatusBody(
  meetingId: number,
  status: string
): Record<string, unknown> {
  return {
    query: UPDATE_EVENT_STATUS_MUTATION,
    variables: { meetingId, status },
  };
}
