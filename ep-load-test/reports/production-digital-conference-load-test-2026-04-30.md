# Production Digital Conference Load Test Report - 2026-04-30

What we tested: Production Digital Conference participant records in DynamoDB and the conference voice-event Lambda in AWS `us-east-1`.

Sources:

- AWS account/profile: `q4-events-platform-prod`
- DynamoDB table: `events-streaming-serverless-conference-participants-prod`
- Lambda log group: `/aws/lambda/events-streaming-prod-conferenceEventHandler`
- DynamoDB scope: rows for the scenario meeting IDs with `created_at`, `updated_at`, `dial_in_history.timestamp`, or `activities.timestamp` inside the scenario window.
- Activity counts only include activity entries timestamped inside the scenario window. A short cleanup check was run after each window to see whether missing `LEFT` activities arrived later.

Note: `ep-load-test/data/registration-plan.scenario-2.json` contains meeting `446690054`; the prompt listed `46690054`. The figures below use `446690054`, which is the persisted scenario file value and has matching DynamoDB data.

## Scenario 1


| Field             | Value                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Environment       | Production                                                                                                                   |
| When              | 2026-04-30, 01:35 - 01:57 America/Toronto                                                                                    |
| UTC window        | 2026-04-30T05:35:00Z - 2026-04-30T05:57:00Z                                                                                  |
| What ran          | Digital Conference exercise: Dial in -> Enter meeting ID/PIN -> Hand up/down -> Wait/broadcast transitions -> Hangup/cleanup |
| Configuration     | 4 events x 225 participants = 900 participants, arrival duration 5 minutes                                                   |
| Meetings in scope | 436084681, 541100017, 255763736, 607520086                                                                                   |
| Duration          | ~22 minutes                                                                                                                  |
| Outcome           | Mostly healthy. 5 Chime Voice throttles were logged, but participant JOINED persistence was complete for in-window rows.     |


### Participant Outcomes

Source: persisted activity journal on 895 in-window participant rows. DynamoDB had 899 total participant rows for these meetings; 4 rows had no in-window run signal.

Per participant:


| Metric                                     | Count | % of 895 |
| ------------------------------------------ | ----- | -------- |
| JOINED                                     | 895   | 100.00   |
| LEFT                                       | 892   | 99.66    |
| JOINED and LEFT                            | 892   | 99.66    |
| JOINED but no LEFT inside requested window | 3     | 0.34     |
| No JOINED inside requested window          | 0     | 0.00     |
| Empty in-window activities list            | 0     | 0.00     |
| RAISED_HAND                                | 308   | 34.41    |


Total activity events:


| Activity type     | Events |
| ----------------- | ------ |
| JOINED            | 895    |
| LEFT              | 892    |
| RAISED_HAND       | 308    |
| LOWERED_HAND      | 285    |
| QUESTION_REJECTED | 570    |


By meeting ID:


| meeting_id | Rows | With JOINED | With LEFT | JOINED + LEFT | No JOINED | RAISED_HAND |
| ---------- | ---- | ----------- | --------- | ------------- | --------- | ----------- |
| 436084681  | 225  | 225         | 222       | 222           | 0         | 84          |
| 541100017  | 222  | 222         | 222       | 222           | 0         | 70          |
| 255763736  | 224  | 224         | 224       | 224           | 0         | 81          |
| 607520086  | 224  | 224         | 224       | 224           | 0         | 73          |


Cleanup note: the 3 rows with `JOINED` but no `LEFT` inside 01:35-01:57 all received `LEFT` before 02:10 America/Toronto. With cleanup included, 895 rows had both `JOINED` and `LEFT`.

### Lambda Behavior


| Metric                                                        | Value         |
| ------------------------------------------------------------- | ------------- |
| Lambda invocations                                            | 12,693        |
| Cold starts                                                   | 124           |
| Average invoke rate                                           | ~9.6 / second |
| Chime Voice throttles (`ThrottledClientException`)            | 5             |
| Worst single minute for throttles                             | 2             |
| Application error lines (`level:50`)                          | 19            |
| `Meeting ID is required`                                      | 10            |
| `Conference participant not found with vendor participant id` | 8             |
| Vendor participant ID required signals                        | 4             |
| Lambda timeouts                                               | 0             |


Throttle timing: 05:43, 05:44, and 05:46 UTC.

### Summary

Scenario 1 persisted a normal join lifecycle for every in-window participant row. The only strict-window lifecycle gap was 3 delayed `LEFT` entries, all of which appeared shortly after the requested window.

The main infrastructure signal was a small Chime SDK Voice throttle burst. It was much smaller than the earlier Round 1 sample, but it still confirms that `UpdateSipMediaApplicationCall` paths can hit Chime Voice control-plane limits during concentrated call activity.

Hand-raise persistence was relatively low at 34.4% of rows. Given all participants joined and nearly all left inside the window, this looks more like scenario timing/action reliability than a broad participant persistence failure.

## Scenario 2


| Field             | Value                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| Environment       | Production                                                                                                       |
| When              | 2026-04-30, 02:50 - 03:18 America/Toronto                                                                        |
| UTC window        | 2026-04-30T06:50:00Z - 2026-04-30T07:18:00Z                                                                      |
| What ran          | Same Digital Conference exercise; broadcast start/pause/resume around 03:02 America/Toronto                      |
| Configuration     | 10 events x 200 participants = 2,000 participants, arrival duration 10 minutes                                   |
| Meetings in scope | 446690054, 191340257, 748745099, 472284744, 667214350, 303210473, 478222216, 567443546, 623163310, 877913126     |
| Duration          | ~28 minutes                                                                                                      |
| Outcome           | Mostly healthy on participant JOINED persistence. Chime Voice throttles were present and higher than Scenario 1. |


### Participant Outcomes

Source: persisted activity journal on 1,990 in-window participant rows. DynamoDB had 2,000 total participant rows for these meetings; 10 rows had no in-window run signal.

Per participant:


| Metric                                     | Count | % of 1,990 |
| ------------------------------------------ | ----- | ---------- |
| JOINED                                     | 1,990 | 100.00     |
| LEFT                                       | 1,928 | 96.88      |
| JOINED and LEFT                            | 1,928 | 96.88      |
| JOINED but no LEFT inside requested window | 62    | 3.12       |
| No JOINED inside requested window          | 0     | 0.00       |
| Empty in-window activities list            | 0     | 0.00       |
| RAISED_HAND                                | 638   | 32.06      |


Total activity events:


| Activity type     | Events |
| ----------------- | ------ |
| JOINED            | 1,990  |
| LEFT              | 1,928  |
| RAISED_HAND       | 638    |
| LOWERED_HAND      | 531    |
| QUESTION_REJECTED | 1,062  |


By meeting ID:


| meeting_id | Rows | With JOINED | With LEFT | JOINED + LEFT | No JOINED | RAISED_HAND |
| ---------- | ---- | ----------- | --------- | ------------- | --------- | ----------- |
| 446690054  | 199  | 199         | 191       | 191           | 0         | 61          |
| 191340257  | 198  | 198         | 169       | 169           | 0         | 69          |
| 748745099  | 199  | 199         | 187       | 187           | 0         | 65          |
| 472284744  | 198  | 198         | 185       | 185           | 0         | 72          |
| 667214350  | 200  | 200         | 200       | 200           | 0         | 72          |
| 303210473  | 199  | 199         | 199       | 199           | 0         | 71          |
| 478222216  | 200  | 200         | 200       | 200           | 0         | 70          |
| 567443546  | 199  | 199         | 199       | 199           | 0         | 72          |
| 623163310  | 198  | 198         | 198       | 198           | 0         | 61          |
| 877913126  | 200  | 200         | 200       | 200           | 0         | 25          |


Cleanup note: the 62 rows with `JOINED` but no `LEFT` inside 02:50-03:18 all received `LEFT` before 03:35 America/Toronto. With cleanup included, 1,990 rows had both `JOINED` and `LEFT`.

### Lambda Behavior


| Metric                                                        | Value          |
| ------------------------------------------------------------- | -------------- |
| Lambda invocations                                            | 23,622         |
| Cold starts                                                   | 94             |
| Average invoke rate                                           | ~14.1 / second |
| Chime Voice throttles (`ThrottledClientException`)            | 24             |
| Worst single minute for throttles                             | 11             |
| Application error lines (`level:50`)                          | 61             |
| `Meeting ID is required`                                      | 20             |
| `Conference participant not found with vendor participant id` | 20             |
| Vendor participant ID required signals                        | 17             |
| Lambda timeouts                                               | 0              |


Throttle timing: 06:58, 06:59, 07:00, 07:03, and 07:04 UTC. The highest throttle minutes were 07:03 UTC (10) and 07:04 UTC (11).

### Summary

Scenario 2 successfully journaled `JOINED` for all 1,990 in-window participant rows. The strict-window `JOINED + LEFT` rate is lower because 62 `LEFT` events landed after 03:18 America/Toronto; all 62 were present by 03:35.

The larger test generated more Lambda traffic than Scenario 1 and had more Chime Voice throttles, concentrated around the broadcast/action period. This points again to Chime Voice control-plane pressure rather than Lambda timeout or Lambda capacity failure.

Hand-raise persistence was again low at 32.1% of rows. The pattern is consistent across both scenarios and should be investigated in the load script timing and the DTMF/participant-control paths.

## Scenario 1 vs Scenario 2


| Metric                            | Scenario 1         | Scenario 2             |
| --------------------------------- | ------------------ | ---------------------- |
| Configured participants           | 900                | 2,000                  |
| DynamoDB rows for meetings        | 899                | 2,000                  |
| In-window participant rows        | 895                | 1,990                  |
| JOINED within window              | 895 / 895 (100.0%) | 1,990 / 1,990 (100.0%) |
| JOINED + LEFT within window       | 892 / 895 (99.7%)  | 1,928 / 1,990 (96.9%)  |
| JOINED + LEFT after cleanup check | 895 / 895 (100.0%) | 1,990 / 1,990 (100.0%) |
| RAISED_HAND                       | 308 / 895 (34.4%)  | 638 / 1,990 (32.1%)    |
| Lambda invocations                | 12,693             | 23,622                 |
| Average invoke rate               | ~9.6 / second      | ~14.1 / second         |
| Cold starts                       | 124                | 94                     |
| Chime Voice throttles             | 5                  | 24                     |
| Application error lines           | 19                 | 61                     |
| Lambda timeouts                   | 0                  | 0                      |


## When Throttles Happened

The throttle timing does not point to initial joining as the only driver.

| Scenario   | Throttle timing (America/Toronto)              | Likely phase                                                                                                                        |
| ---------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Scenario 1 | 01:43, 01:44, 01:46                             | After the 01:35-01:40 join ramp. Nearby logs show participant-control activity, especially hand raise / hand down, before hangup.   |
| Scenario 2 | 02:58, 02:59, 03:00, then mostly 03:03 and 03:04 | Tail end of the 02:50-03:00 join ramp, then strongest during/just after the 03:02 broadcast start/pause/resume control activity.    |

Scenario 2 is the clearest signal: 21 of 24 Chime Voice throttles occurred at 03:03-03:04 America/Toronto, right after the broadcast control work. That points more strongly to broadcast / call-control fan-out than to plain participant joining.

Scenario 1 is different. The 5 throttles landed several minutes after the arrival ramp and line up better with post-join participant-control activity. In the scenario script, only about one third of callers run the hand-raise flow, and that flow waits 120 seconds after connect before toggling hand state.

## Previous vs Current Load Test

Note: the previous load-test figures below are from the earlier production report notes. The current figures use exact in-window activity timestamps from this report; delayed `LEFT` events are called out separately via the cleanup check.

| Metric                      | Previous Round 1         | Previous Round 2         | Current Scenario 1       | Current Scenario 2         |
| --------------------------- | ------------------------ | ------------------------ | ------------------------ | -------------------------- |
| Date / time                 | 2026-04-20 04:27-04:49   | 2026-04-20 05:10-05:35   | 2026-04-30 01:35-01:57   | 2026-04-30 02:50-03:18     |
| Configuration               | 4 x 225 = 900            | 4 x 250 = 1,000          | 4 x 225 = 900            | 10 x 200 = 2,000           |
| Participant rows measured   | 869                      | 997                      | 895                      | 1,990                      |
| JOINED + LEFT               | 829 / 869 (95.4%)        | 937 / 997 (94.0%)        | 892 / 895 (99.7%)        | 1,928 / 1,990 (96.9%)      |
| JOINED + LEFT after cleanup | Not separately reported  | Not separately reported  | 895 / 895 (100.0%)       | 1,990 / 1,990 (100.0%)     |
| No JOINED                   | 36 / 869 (4.1%)          | 56 / 997 (5.6%)          | 0 / 895 (0.0%)           | 0 / 1,990 (0.0%)           |
| RAISED_HAND                 | 672 / 869 (77.3%)        | 905 / 997 (90.8%)        | 308 / 895 (34.4%)        | 638 / 1,990 (32.1%)        |
| Lambda invocations          | 13,999                   | 14,175                   | 12,693                   | 23,622                     |
| Average invoke rate         | ~10 / second             | ~9 / second              | ~9.6 / second            | ~14.1 / second             |
| Cold starts                 | 104                      | 100                      | 124                      | 94                         |
| Chime Voice throttles       | 192                      | 0                        | 5                        | 24                         |
| Lambda timeouts             | 0                        | 0                        | 0                        | 0                          |

Compared with the previous runs, the current test had stronger participant persistence: no in-window participant row was missing `JOINED`, and all strict-window `JOINED but no LEFT` rows received `LEFT` shortly after cleanup. The current 2,000-participant scenario also exercised more aggregate Lambda traffic than either previous round.

The Chime Voice throttle pattern changed. Previous Round 1 had the largest throttle burst at 192 throttles, while Previous Round 2 had none. The current test sits between those: Scenario 1 had only 5 throttles, and Scenario 2 had 24, concentrated around the broadcast/control period.

The main regression-like signal in the current test is hand-raise persistence. Previous rounds showed 77-91% of participant rows with `RAISED_HAND`; the current scenarios show only ~32-34%. That should be investigated separately from participant join/leave persistence, which improved.

## Observations

Most participant lifecycle persistence was healthy in both scenarios. Every in-window participant row had a `JOINED` activity, and delayed `LEFT` entries appeared shortly after the requested windows.

The main infrastructure risk remains Chime SDK Voice throttling. Scenario 2 produced 24 `ThrottledClientException` log lines, with a worst minute of 11. These errors came from `@aws-sdk/client-chime-sdk-voice`, consistent with SMA/PSTN call-control operations such as hold, broadcast prompts, hangup, mute/unmute, DTMF-driven transitions, and related `UpdateSipMediaApplicationCall` usage. The timing points mostly to broadcast/control fan-out and participant-control actions, not only initial participant joining.

The recurring application error pattern was:

- `Meeting ID is required`, usually from attempts to publish/fetch participants for meeting `0`.
- `Conference participant not found with vendor participant id`, usually while updating a participant by vendor participant ID.
- Vendor participant ID required signals, more visible in Scenario 2.

No Lambda timeout lines were found in either window.

## Recommended Next Steps


| Priority | Action                                                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Engage AWS on Chime SDK Voice quotas for `us-east-1`, using Scenario 2's 24 throttles and 07:03-07:04 UTC concentration as the clearest evidence.                                 |
| High     | Reduce bursty `UpdateSipMediaApplicationCall` traffic where possible, especially around broadcast transitions and participant-control actions.                                    |
| Medium   | Review awaited vs fire-and-forget Voice API calls under load so throttles are visible, bounded, and retried deliberately.                                                         |
| Medium   | Investigate why only ~32-34% of rows persisted `RAISED_HAND` despite the scenario including hand up/down. Start with DTMF timing, hand-action retries, and load-test step pacing. |
| Medium   | Investigate meeting `0` paths that produce `Meeting ID is required`; those errors are not causing broad participant failure here, but they add noise and may hide real failures.  |
| Minor    | Pre-generate fixed IVR phrases with Amazon Polly and serve them from S3 for static prompts to reduce per-call Polly usage and cost.                                               |


