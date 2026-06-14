import { createClient } from '@supabase/supabase-js';

let cachedAdminClient = null;

export function getSupabaseAdmin() {
  if (cachedAdminClient) {
    return cachedAdminClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase admin environment variables');
  }

  cachedAdminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return cachedAdminClient;
}
