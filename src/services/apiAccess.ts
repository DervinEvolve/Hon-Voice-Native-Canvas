import { supabase } from '../utils/supabaseClient';
import { getAccessToken } from '@privy-io/react-auth';
import { allowedOAuthDestination } from '../utils/apiRequest';

// Send provider proof only to the specific same-origin API call that needs it.
export async function accessHeaders(): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  if (!error && data.session?.access_token) return { Authorization: `Bearer ${data.session.access_token}` };
  const token = await getAccessToken().catch(() => null);
  if (!token) throw new Error('Sign in to use this tool');
  return { Authorization: `Bearer ${token}` };
}

export async function beginOAuthPopup(popup: Window, endpoint: '/api/google/auth' | '/api/notion/mcp-auth'): Promise<void> {
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: await accessHeaders() });
    if (!response.ok) throw new Error('Connection could not be started');
    const { url: raw } = await response.json();
    const url = allowedOAuthDestination(raw, endpoint);
    popup.location.href = url.href;
  } catch (error) { popup.close(); throw error; }
}
