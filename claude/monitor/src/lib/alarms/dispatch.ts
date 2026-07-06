/**
 * 発報タイムライン（PB7 capture_alarm_timeline）ディスパッチの共通ヘルパー（是正3）。
 *
 * 発報 ingest（/api/alarms/ingest）と リトライ cron（/api/cron/alarm-dispatch-retry）の
 * 双方から使う。エッジの pending_command は巡回/BCP と共有の単一スロットのため、
 * 埋まっている時は投入できない — その場合 timeline_dispatched_at が NULL のまま残り、
 * cron が直近発報分を再送する（「発報したのに前後スナップが無い」を防ぐ）。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { EdgeCommand } from '@/lib/edge/commands'
import { ALARM_TIMELINE_OFFSETS_SEC, alarmFramesIngestUrl } from './timeline'

/** capture_alarm_timeline コマンドを生成（request_id は毎回新規）。 */
export function buildTimelineCommand(alarmId: string, occurredAt: string): EdgeCommand {
  return {
    action:      'capture_alarm_timeline',
    request_id:  randomUUID(),
    alarm_id:    alarmId,
    occurred_at: occurredAt,
    offsets_sec: [...ALARM_TIMELINE_OFFSETS_SEC],
    ingest_url:  alarmFramesIngestUrl(),
  }
}

/**
 * pending_command が空いていればコマンドを投入し、成功時は alarm_events.timeline_dispatched_at
 * を記録する。戻り値 true＝投入成功／false＝スロット占有（呼び出し側は後続リトライに委ねる）。
 */
export async function dispatchAlarmTimeline(
  service: SupabaseClient,
  edgeId: string,
  alarmId: string,
  occurredAt: string,
): Promise<boolean> {
  const cmd = buildTimelineCommand(alarmId, occurredAt)
  const { data } = await service
    .from('edge_devices')
    .update({ pending_command: cmd, pending_command_at: new Date().toISOString() })
    .eq('id', edgeId)
    .is('pending_command', null) // レース保護: 埋まっていたら書かない
    .select('id')
  const dispatched = (data ?? []).length > 0
  if (dispatched) {
    await service
      .from('alarm_events')
      .update({ timeline_dispatched_at: new Date().toISOString() })
      .eq('id', alarmId)
  }
  return dispatched
}
