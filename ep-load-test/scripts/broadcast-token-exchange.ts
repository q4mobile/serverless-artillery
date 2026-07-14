import { buildTokenExchangeBody } from './broadcast-graphql';
import { parseLabeledJson } from './register-analysts-json';
import { writeJsonLog } from './register-analysts-logging';
import type { BroadcastDeps } from './broadcast.types';

interface TokenExchangeResponse {
  data?: {
    generateUserEventAccessToken?: { accessToken?: string } | null;
  };
  errors?: Array<{ message?: string }>;
}

/**
 * Exchange a platform-level token for an event-scoped access token.
 * Returns the event token string, or throws if the exchange fails.
 */
export async function exchangeToken(
  deps: BroadcastDeps,
  url: string,
  platformToken: string,
  meetingId: number,
  fetchTimeoutMs: number
): Promise<string> {
  const init: RequestInit = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${platformToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildTokenExchangeBody(meetingId)),
  };

  if (fetchTimeoutMs > 0) {
    const timeout = (AbortSignal as typeof AbortSignal & { timeout?: (ms: number) => AbortSignal }).timeout;
    if (timeout) Object.assign(init, { signal: timeout(fetchTimeoutMs) });
  }

  let text: string;
  let httpStatus: number;

  try {
    const res = await deps.fetch(url, init);
    httpStatus = res.status;
    text = await res.text();
    if (!res.ok) {
      const isAuth = res.status === 401 || res.status === 403;
      throw new Error(
        isAuth
          ? `Token exchange auth rejected (${res.status}); refresh Q4_ADMIN_TOKEN`
          : `Token exchange HTTP ${res.status}: ${text.slice(0, 200)}`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Token exchange')) throw err;
    throw new Error(`Token exchange request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  writeJsonLog(deps, {
    lvl: 'INFO',
    evt: 'ep.token.exchange.success',
    msg: 'Platform token exchanged for event token',
    meetingId,
    httpStatus,
  });

  const body = parseLabeledJson<TokenExchangeResponse>(text, 'generateUserEventAccessToken response');
  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'Token exchange GraphQL error');
  }
  const accessToken = body.data?.generateUserEventAccessToken?.accessToken;
  if (!accessToken) {
    throw new Error('Token exchange response missing accessToken');
  }
  return accessToken;
}
