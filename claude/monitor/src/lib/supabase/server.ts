import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createSupabaseServer() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          // Next.js disallows cookie writes inside Server Components — only
          // Server Actions / Route Handlers can set them. Supabase's session
          // refresh occasionally tries to write here during page render
          // (e.g. when the access_token is close to expiring). Swallow the
          // error: this client is also used from Server Actions / Route
          // Handlers where the writes DO succeed, so a refreshed token will
          // land on the very next mutation. If you ever notice users getting
          // logged out unexpectedly, add a middleware that calls getUser()
          // on every request so refresh happens in a context that can write.
          try {
            for (const { name, value, options } of list) {
              cookieStore.set(name, value, options)
            }
          } catch {
            // Called from a Server Component — ignore.
          }
        },
      },
    },
  )
}

export function createSupabaseService() {
  const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
