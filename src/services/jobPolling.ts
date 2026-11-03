// Submit routes for queued providers answer 202 with an opaque job token, and
// the result is read back from the matching status route. The status route
// answers only the user who started the job, so a 404 means the token is not
// this user's (or no longer valid) and polling again cannot change that.

export interface PollJobOptions<T> {
  /** Status route up to and including the token parameter, for example '/api/marey/status?requestId='. */
  url: string;
  /** The token the submit route returned. It is sent back unchanged, URL-encoded. */
  token: string;
  /** Returns the result once the job has finished and undefined while it runs. Throws on a terminal job failure. */
  isDone: (body: unknown) => T | undefined;
  intervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function pollJob<T>({ url, token, isDone, intervalMs = 5000, timeoutMs = 10 * 60 * 1000, fetchImpl }: PollJobOptions<T>): Promise<T> {
  if (typeof token !== 'string' || !token) throw new Error('The job did not return a token');
  // Resolve fetch per call so the app's authenticated fetch wrapper is used.
  const request = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const statusUrl = url + encodeURIComponent(token);
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  for (;;) {
    let response: Response | undefined;
    try { response = await request(statusUrl); }
    catch (error) { lastError = error instanceof Error ? error.message : String(error); }
    if (response) {
      if (response.status === 404) throw new Error('Job not found');
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        const result = isDone(body);
        if (result !== undefined) return result;
        lastError = '';
      } else if (response.status >= 500) {
        // A server or provider hiccup does not end the job; keep polling until the deadline.
        lastError = body?.error || `Status check failed (${response.status})`;
      } else {
        throw new Error(body?.error || `Status check failed (${response.status})`);
      }
    }
    if (Date.now() + intervalMs > deadline) {
      throw new Error(`Job timed out after ${Math.round(timeoutMs / 1000)} seconds${lastError ? ` (last error: ${lastError})` : ''}`);
    }
    await sleep(intervalMs);
  }
}

// marey/status and minimax/image-status relay the fal queue: the raw queue
// status while the job runs, then { status: 'COMPLETED', result } with the
// fal output once it has finished.
interface FalQueueReply { status?: string; error?: string; result?: { video?: { url?: unknown }; detail?: unknown } }

export function falQueueVideoUrl(body: unknown): string | undefined {
  const reply = (body ?? {}) as FalQueueReply;
  if (reply.status === 'FAILED' || reply.status === 'ERROR') throw new Error(reply.error || 'The job failed');
  if (reply.status !== 'COMPLETED') return undefined;
  const url = reply.result?.video?.url;
  if (typeof url === 'string' && url) return url;
  // A failed fal job still completes; its result carries the reason instead of a video.
  const detail = reply.result?.detail ?? reply.error;
  throw new Error(typeof detail === 'string' && detail ? detail : 'The job finished without a video');
}
