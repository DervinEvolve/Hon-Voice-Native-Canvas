import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables');
  throw new Error('Missing Supabase environment variables');
}

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  },
  db: {
    schema: 'public',
  },
  global: {
    headers: {
      'X-Client-Info': 'hon-comic-creator'
    },
  },
});

// Function to sync Auth0 session with Supabase
export async function syncAuth0ToSupabase(auth0Token: string) {
  try {
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'auth0',
      token: auth0Token,
    });
    
    if (error) {
      console.error('Error syncing Auth0 with Supabase:', error);
      return false;
    }
    
    console.log('Successfully synced Auth0 session with Supabase');
    return true;
  } catch (err) {
    console.error('Exception in Auth0 to Supabase sync:', err);
    return false;
  }
}

// Debug helper
export async function checkSupabaseSession() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error('Error checking Supabase session:', error);
      return null;
    }
    
    if (data?.session) {
      console.log('Active Supabase session found:', data.session.user.id);
      return data.session;
    } else {
      console.log('No active Supabase session');
      return null;
    }
  } catch (err) {
    console.error('Exception checking Supabase session:', err);
    return null;
  }
} 