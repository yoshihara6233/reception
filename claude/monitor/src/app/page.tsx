import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'

export default async function Home() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  redirect(user ? '/stores' : '/login')
}
