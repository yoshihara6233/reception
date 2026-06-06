import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { type EdgeCommand } from '@/lib/edge/commands'
import { randomUUID } from 'node:crypto'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: edgeId } = await ctx.params

  // Verify caller is authenticated
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: edge, error: edgeErr } = await supa
    .from('edge_devices')
    .select('id, store_id, status')
    .eq('id', edgeId)
    .single()
  if (edgeErr || !edge) return NextResponse.json({ error: 'edge_not_found' }, { status: 404 })

  const body = (await req.json()) as Partial<EdgeCommand> & { action?: string }
  if (!body?.action) return NextResponse.json({ error: 'action_required' }, { status: 400 })

  const command: EdgeCommand = {
    ...(body as EdgeCommand),
    request_id: randomUUID(),
  }

  // Write command to DB — edge agent polls pending_command every 2s
  const service = createSupabaseService()
  const { error } = await service
    .from('edge_devices')
    .update({
      pending_command:    command,
      pending_command_at: new Date().toISOString(),
    })
    .eq('id', edgeId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, request_id: command.request_id })
}
