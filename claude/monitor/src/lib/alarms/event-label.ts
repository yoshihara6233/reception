/**
 * 発報の種類・受信元の表示名 (2026-11-04・シナリオ試験の所見)。
 *
 * 発報タイムラインと詳細に motion・input・recording_stopped などの内部名がそのまま出ていた。
 * 値は受け口 (/api/alarms/ingest・/api/webhooks/onvif・/api/edge/events) とエッジの
 * アダプタ (claude/edge-agent/src/adapters) が付ける名前。知らない値はそのまま返す
 * (外部の Webhook 源が自由な名前で送れるため、消すと何の発報か分からなくなる)。
 * 発報の画面は日本語だけなので、i18n には載せていない。
 */
const EVENT_TYPE_LABELS: Record<string, string> = {
  // カメラ・NVR の事象 (ONVIF の topic の変換と各社のアダプタ)
  motion:        '動体検知',
  video_loss:    '映像断',
  tampering:     'いたずら検知',
  tamper:        'いたずら検知',
  input:         '接点入力',
  audio_anomaly: '音声異常',
  ai_person:     '人物検知',
  ai_vehicle:    '車両検知',
  unknown:       '不明な事象',
  // 拠点の G・VMS の状態 (/api/edge/events・source=nvms)
  node_down:         'ノード離脱',
  node_up:           'ノード復帰',
  recording_stopped: '録画停止',
  recording_resumed: '録画再開',
  disk_low:          '容量逼迫',
  disk_ok:           '容量回復',
  disk_failing:      'ディスク故障の兆候',
  disk_healthy:      'ディスク健康回復',
}

const SOURCE_LABELS: Record<string, string> = {
  onvif:   'ONVIF',
  frigate: 'Frigate',
  ipro:    'i-PRO',
  webhook: 'Webhook',
  nvms:    '拠点の G・VMS',
}

export function alarmEventTypeLabel(t: string | null | undefined): string | null {
  if (!t) return null
  return EVENT_TYPE_LABELS[t] ?? t
}

export function alarmSourceLabel(s: string): string {
  return SOURCE_LABELS[s] ?? s
}

/** 一覧の種類の欄。種類が無いときは受信元を出す (以前の「event_type || source」と同じ順)。 */
export function alarmKindLabel(eventType: string | null | undefined, source: string): string {
  return alarmEventTypeLabel(eventType) ?? alarmSourceLabel(source)
}
