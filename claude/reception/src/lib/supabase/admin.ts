import { createClient } from '@supabase/supabase-js'

// Service role client — server-only, bypasses RLS
// ONLY use for: signed URL generation, Edge Function triggers
// NEVER use for data queries — use server.ts with RLS instead
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}
