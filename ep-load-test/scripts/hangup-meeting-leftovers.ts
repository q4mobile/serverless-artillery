/**
 * One-off: force-hangup every participant row still CONNECTED for a given meetingId,
 * by transaction_id, using the same UpdateSipMediaApplicationCall mechanism as
 * cleanup-run.ts. Needed when conferenceHangup doesn't reach every leg
 * (e.g. replica-meeting legs) and run-state.ndjson has no entries for this run yet
 * (scenarios still mid-"think", so afterScenario/saveParticipantResult hasn't fired).
 *
 * Sweeps BOTH SMAs: a transactionId is scoped to one SMA, so hitting only the
 * load-test SMA returns NotFoundException for conference-side legs and looks clean
 * while they stay billable. See cleanup-run.ts header for the full explanation.
 *
 * Usage: MEETING_ID=<meetingId> npx tsx scripts/hangup-meeting-leftovers.ts
 */
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { fromIni } from '@aws-sdk/credential-providers';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sendSipUpdate } = require('../lib/chimeClient.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { loadConfig } = require('../lib/config.js');

const MEETING_ID = process.env.MEETING_ID;
const CONCURRENCY = parseInt(process.env.CLEANUP_CONCURRENCY || '10', 10);

async function findConnectedTransactionIds(meetingId: string): Promise<string[]> {
  const config = loadConfig();
  const targetProfile = process.env.LOAD_TEST_TARGET_AWS_PROFILE;
  const client = new DynamoDBClient({
    region: config.region,
    ...(targetProfile ? { credentials: fromIni({ profile: targetProfile }) } : {}),
  });

  const ids: string[] = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const out = await client.send(
      new QueryCommand({
        TableName: config.dynamo.tableName,
        IndexName: 'meeting_id-index',
        KeyConditionExpression: 'meeting_id = :m',
        FilterExpression: '#s = :connected',
        ExpressionAttributeNames: { '#s': config.dynamo.statusAttr },
        ExpressionAttributeValues: {
          ':m': { N: meetingId },
          ':connected': { S: config.dynamo.statusConnected },
        },
        ExclusiveStartKey: lastKey,
      })
    );
    for (const item of out.Items ?? []) {
      const row = unmarshall(item);
      if (row.transaction_id) ids.push(row.transaction_id);
    }
    lastKey = out.LastEvaluatedKey as Record<string, any> | undefined;
  } while (lastKey);

  return ids;
}

interface SweepTarget {
  smaId: string;
  label: string;
  args: Record<string, string>;
}

function sweepTargets(config: any): SweepTarget[] {
  const targets: SweepTarget[] = [
    { smaId: config.smaId, label: `load-test SMA ${config.smaId}`, args: { loadTestHangup: 'true' } },
  ];
  if (config.conferenceSmaId) {
    targets.push({
      smaId: config.conferenceSmaId,
      label: `conference SMA ${config.conferenceSmaId}`,
      args: { action: 'hangup' },
    });
  }
  return targets;
}

async function hangupAll(target: SweepTarget, transactionIds: string[], concurrency: number) {
  const results: { transactionId: string; outcome: string; error?: string }[] = [];
  let idx = 0;

  async function worker(): Promise<void> {
    while (idx < transactionIds.length) {
      const transactionId = transactionIds[idx++];
      try {
        await sendSipUpdate(target.smaId, transactionId, target.args, {
          attendeeId: 'cleanup-leftovers',
          meetingId: MEETING_ID,
          correlationId: '',
        });
        results.push({ transactionId, outcome: 'hungUp' });
      } catch (error: any) {
        if (error?.name === 'NotFoundException') {
          results.push({ transactionId, outcome: 'alreadyGone' });
        } else {
          results.push({ transactionId, outcome: 'failed', error: error?.name || String(error) });
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(transactionIds.length, 1)) }, worker));
  return results;
}

async function main() {
  if (!MEETING_ID) {
    console.error('MEETING_ID env var is required');
    process.exit(1);
  }
  const config = loadConfig();
  if (!config.conferenceSmaId) {
    console.warn(
      'WARNING: CONFERENCE_SMA_ID is not set — conference-side legs will NOT be swept ' +
        'and this script will report a misleading all-clear.'
    );
  }
  console.log(`Querying CONNECTED rows for meetingId=${MEETING_ID}...`);
  const transactionIds = await findConnectedTransactionIds(MEETING_ID);
  console.log(`Found ${transactionIds.length} CONNECTED rows to hang up`);

  let anyFailed = false;
  for (const target of sweepTargets(config)) {
    const results = await hangupAll(target, transactionIds, CONCURRENCY);
    const hungUp = results.filter((r) => r.outcome === 'hungUp').length;
    const alreadyGone = results.filter((r) => r.outcome === 'alreadyGone').length;
    const failed = results.filter((r) => r.outcome === 'failed');

    console.log(`${target.label}: hungUp=${hungUp} alreadyGone=${alreadyGone} failed=${failed.length}`);
    if (failed.length > 0) {
      console.log('Failures:', failed.slice(0, 10));
      anyFailed = true;
    }
  }
  if (anyFailed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
