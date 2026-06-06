/**
 * Command polling: read edge_devices.pending_command every POLL_MS.
 * More reliable than Supabase Realtime broadcast for server→edge delivery.
 *
 * Monitor writes { action, ...params, request_id } to pending_command.
 * Agent detects a new request_id, processes the command, then clears it.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from './config.js'
import { logger } from './logger.js'
import type { EdgeCommand } from './types.js'

// Command pickup latency dominates the user-perceived live/VOD startup
// time (every start_live / start_vod waits up to POLL_MS for the edge to
// notice). 500ms keeps DB load modest (~120 SELECTs/min/edge) while
// reducing average pickup wait from ~1s to ~250ms.
const POLL_MS = 500

export function subscribeCommands(onCommand: (cmd: EdgeCommand) => void): {
  close: () => Promise<void>
} {
  const supa = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let lastRequestId: string | null = null
  let stopped = false

  async function poll() {
    try {
      const { data, error } = await supa
        .from('edge_devices')
        .select('pending_command')
        .eq('id', config.EDGE_ID)
        .single()

      if (error || !data?.pending_command) return

      const cmd = data.pending_command as EdgeCommand
      if (!cmd.request_id || cmd.request_id === lastRequestId) return

      lastRequestId = cmd.request_id
      logger.info({ action: cmd.action }, 'poll: command')

      // Clear the command so it's not re-processed on next poll
      await supa
        .from('edge_devices')
        .update({ pending_command: null })
        .eq('id', config.EDGE_ID)

      onCommand(cmd)
    } catch (e) {
      logger.debug({ err: e }, 'poll: error')
    }
  }

  const timer = setInterval(() => { if (!stopped) poll() }, POLL_MS)
  poll() // immediate first check

  return {
    async close() {
      stopped = true
      clearInterval(timer)
    },
  }
}
