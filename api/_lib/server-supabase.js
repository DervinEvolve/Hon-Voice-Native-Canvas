// The server-only Supabase credential. SUPABASE_SECRET_KEY is the current
// secret key; the two older names are kept as fallbacks while deployments
// move over. The browser never reads any of these. Returns undefined fields
// rather than throwing so each caller keeps its own fail-closed reply.
export function serverSupabaseCredentials() {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
  };
}
