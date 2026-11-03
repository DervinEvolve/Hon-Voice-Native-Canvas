/**
 * Target for the manual smoke scripts in this folder.
 *
 * HON_TEST_BASE_URL     the deployment to check, for example a private preview
 *                       you own. There is no default.
 * HON_TEST_ACCESS_TOKEN a Supabase or Privy access token for a user on that
 *                       deployment's HON_API_ALLOWED_USER_IDS list. It is sent
 *                       as the same Authorization header the app sends.
 *
 * Every request these scripts make counts against that user's hourly request
 * budget, and some of them start paid model calls.
 */
export interface RemoteTarget {
  baseUrl: string;
  headers: Record<string, string>;
}

export function getRemoteTarget(): RemoteTarget {
  const rawUrl = (process.env.HON_TEST_BASE_URL || '').trim();
  const token = (process.env.HON_TEST_ACCESS_TOKEN || '').trim();
  if (!rawUrl || !token) {
    console.error('Set HON_TEST_BASE_URL and HON_TEST_ACCESS_TOKEN before running this script.');
    process.exit(1);
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    console.error('HON_TEST_BASE_URL is not a valid URL.');
    process.exit(1);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    console.error('HON_TEST_BASE_URL must use https (http is allowed only for localhost).');
    process.exit(1);
  }
  return {
    baseUrl: url.origin,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  };
}
