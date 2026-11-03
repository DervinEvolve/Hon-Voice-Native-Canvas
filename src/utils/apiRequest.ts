export function authenticatedApiFetch(fetchImpl: typeof fetch, accessHeaders: () => Promise<Record<string, string>>, pageUrl: string): typeof fetch {
  const appOrigin = new URL(pageUrl).origin;
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), pageUrl);
    if (url.username || url.password || url.origin !== appOrigin || !/^\/api(?:\/|$)/.test(url.pathname)) return fetchImpl(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has('Authorization')) {
      for (const [key, value] of Object.entries(await accessHeaders())) headers.set(key, value);
    }
    return fetchImpl(input, { ...init, headers, redirect: 'error' });
  };
}

export function isOAuthPopupMessage(event: MessageEvent, popup: Window | null, appOrigin: string): boolean {
  return Boolean(popup && event.source === popup && event.origin === appOrigin);
}

export function allowedOAuthDestination(raw: unknown, endpoint: '/api/google/auth' | '/api/notion/mcp-auth'): URL {
  if (typeof raw !== 'string') throw new Error('Invalid authorization destination');
  const url = new URL(raw);
  const google = endpoint === '/api/google/auth';
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash ||
      url.hostname !== (google ? 'accounts.google.com' : 'api.notion.com') ||
      url.pathname !== (google ? '/o/oauth2/v2/auth' : '/v1/oauth/authorize')) throw new Error('Invalid authorization destination');
  return url;
}
