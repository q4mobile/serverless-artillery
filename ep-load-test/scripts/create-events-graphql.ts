import type { EventPlanEntry } from './create-events.types';

export const CREATE_EVENT_MUTATION = `
  mutation createEvent($event: EventInput, $externalConferenceDetails: ExternalConferenceDetails) {
    createEvent(event: $event, externalConferenceDetails: $externalConferenceDetails) {
      meetingId
      title
    }
  }
`;

interface EventInput {
  title: string;
  companyId: string;
  eventType: string;
  eventStart?: string;
  eventEnd?: string;
}

export function buildEventVariables(
  input: EventInput,
  now: () => Date = () => new Date()
): { event: Record<string, unknown> } {
  const start = input.eventStart || now().toISOString();
  const end = input.eventEnd || new Date(now().getTime() + 60 * 60 * 1000).toISOString();

  return {
    event: {
      configuration: {
        question: {
          text: false,
          questionsPerAttendee: 10,
          charLimit: 4000,
          qaLineEnabled: null,
          qaLine: null,
        },
        rsl: {
          enabled: true,
          hostingType: 'DEFAULT',
        },
        dialIn: {
          speaker: true,
          operatorLineEnabled: null,
          operatorLine: null,
        },
        video: {
          enabled: true,
        },
        shareholder: {
          maxSessions: 3,
        },
        postEvent: {
          enableArchive: true,
          enableReplay: false,
          feedbackSurvey: false,
        },
        guest: {
          enabled: true,
        },
        presenterControlledSlides: {
          enabled: false,
        },
        layoutManager: {
          enabled: true,
        },
        speakerBios: {
          enabled: false,
        },
        broadcastOutput: {
          externalEnabled: true,
        },
        closedCaptions: {
          liveEnabled: true,
          postEventEnabled: true,
        },
        conferenceCall: {
          q4Hosted: false,
        },
        dualStream: {
          enabled: true,
          region: 'us-west-2',
        },
      },
      description: '',
      eventEnd: end,
      eventStart: start,
      eventType: input.eventType,
      eventTz: 'America/New_York',
      guests: [],
      notes: '',
      status: 'NOT_STARTED',
      title: input.title,
      registrationFields: [],
      companyId: input.companyId,
      eventCategory: 'INTERNAL',
      branding: {
        controlPanelBranding: {
          primaryColor: 'FFFFFF',
          secondaryColor: 'FFFFFF',
          primaryFont: {
            displayName: 'Arial',
            name: 'c713b99e-40d4-4d31-629a-6def5f7963c6.ttf',
            fileType: 'tff',
          },
          secondaryFont: {
            displayName: 'Arial',
            name: 'c713b99e-40d4-4d31-629a-6def5f7963c6.ttf',
            fileType: 'tff',
          },
          primaryFontWeight: 'bold',
          secondaryFontWeight: 'regular',
          publishSchedule: 'AUTOMATIC',
          videoRecording: 'DEFAULT',
          publishScheduleStatus: 'UNPUBLISHED',
          hideMeetingReplay: false,
          broadcastRecordings: [],
        },
        registrationPageBranding: {
          title: '',
          description: '',
          openRegistration: '15',
        },
        preEventPageBranding: {
          message: 'Please hold tight, the broadcast will begin shortly.',
          lobbyMessage: 'Please hold tight, the broadcast will begin shortly.',
          musicOption: 'DEFAULT',
        },
        thankYouPageBranding: {
          title: '',
          description: '',
        },
        postEventPageBranding: {
          meetingDetails: '',
        },
        attendeeConsoleBranding: {
          images: {},
          headerColors: {
            background: '#1D2124',
            text: 'FFFFFF',
          },
          footerColors: {
            background: '#121517',
            primaryButton: '#2A3035',
            primaryButtonText: 'FFFFFF',
          },
          mediaBarColors: {
            background: '#22272B',
            controls: 'FFFFFF',
          },
        },
      },
      previewOptions: {
        controlPanelBranding: {
          primaryColor: 'FFFFFF',
          secondaryColor: 'FFFFFF',
          primaryFont: {
            displayName: 'Arial',
            name: 'c713b99e-40d4-4d31-629a-6def5f7963c6.ttf',
            fileType: 'tff',
          },
          secondaryFont: {
            displayName: 'Arial',
            name: 'c713b99e-40d4-4d31-629a-6def5f7963c6.ttf',
            fileType: 'tff',
          },
          primaryFontWeight: 'bold',
          secondaryFontWeight: 'regular',
          publishSchedule: 'AUTOMATIC',
          videoRecording: 'DEFAULT',
          publishScheduleStatus: 'UNPUBLISHED',
          hideMeetingReplay: false,
          broadcastRecordings: [],
        },
        registrationPageBranding: {
          title: '',
          description: '',
          openRegistration: '15',
        },
        preEventPageBranding: {
          message: 'Please hold tight, the broadcast will begin shortly.',
          lobbyMessage: 'Please hold tight, the broadcast will begin shortly.',
          musicOption: 'DEFAULT',
        },
        thankYouPageBranding: {
          title: '',
          description: '',
        },
        postEventPageBranding: {
          meetingDetails: '',
        },
        attendeeConsoleBranding: {
          images: {},
          headerColors: {
            background: '#1D2124',
            text: 'FFFFFF',
          },
          footerColors: {
            background: '#121517',
            primaryButton: '#2A3035',
            primaryButtonText: 'FFFFFF',
          },
          mediaBarColors: {
            background: '#22272B',
            controls: 'FFFFFF',
          },
        },
      },
      region: 'us-east-1',
      settings: {
        questionEnabled: false,
        rslEnabled: true,
        votingEnabled: true,
      },
      broadcastSource: 'default',
      speakers: [],
      supports: [],
      hosts: [],
      conference: {
        conferenceCallIntake: {
          type: 'internal',
          vendor: 'chime',
          q4Hosted: false,
          source: null,
          qaStarted: true,
          status: 'DISCONNECTED',
        },
      },
      confirmation: {
        sendEmail: false,
        emailText: '',
        newUsersOnly: false,
      },
    },
  };
}

export function buildCreateEventRequestBody(
  target: EventPlanEntry,
  companyId: string,
  defaultEventType: string,
  now: () => Date = () => new Date()
): {
  query: string;
  variables: { event: Record<string, unknown>; externalConferenceDetails: Record<string, never> };
} {
  return {
    query: CREATE_EVENT_MUTATION,
    variables: {
      ...buildEventVariables(
        {
          title: target.title,
          companyId,
          eventType: target.eventType ?? defaultEventType,
          eventStart: target.eventStart,
          eventEnd: target.eventEnd,
        },
        now
      ),
      externalConferenceDetails: {},
    },
  };
}
