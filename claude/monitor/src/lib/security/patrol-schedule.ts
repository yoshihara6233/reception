/**
 * 警備 自動巡回スケジューラの純ロジック（Phase A / A1）。
 *
 * 副作用なし（DB/時刻取得は呼び出し側）。/api/cron/security-patrol から使い、
 * ここは「今この店舗は巡回すべきか」の判定だけを担う。テスト容易性のため分離。
 */

export interface PatrolSettings {
  store_id: string | null
  enabled: boolean
  schedule_mode: string // 'interval' | 'fixed'
  patrol_interval_min: number
  active_from: string // "HH:MM"
  active_to: string // "HH:MM"（"24:00"=日末尾）
  active_days: number[] // 0=日..6=土
  patrol_times: string[] // "HH:MM"（fixed用）
  last_run_at: string | null
}

/** JST の現在 {dow(0=日..6=土), minutes(0..1439)}。now を渡す（Date.now を内包しない）。 */
export function jstNow(now: Date): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const dow = dowMap[get('weekday')] ?? 0
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0 // 一部環境が 24:xx を返すのを 0 に正規化
  const minutes = hour * 60 + Number(get('minute'))
  return { dow, minutes }
}

/** "HH:MM" → 分（"24:00"=1440）。不正は null。 */
export function hhmmToMin(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? '').trim())
  if (!m) return null
  const h = Number(m[1]), mm = Number(m[2])
  if (h > 24 || mm > 59) return null
  return h * 60 + mm
}

/** cur が業務時間窓 [from, to) に入るか。to='24:00'=1440、日跨ぎ窓（22:00〜06:00）にも対応。 */
export function inActiveWindow(curMin: number, from: string, to: string): boolean {
  const f = hhmmToMin(from) ?? 0
  const t = hhmmToMin(to) ?? 1440
  if (f === t) return true // 全日
  if (f < t) return curMin >= f && curMin < t
  return curMin >= f || curMin < t // 日跨ぎ
}

/**
 * この店舗が今 due か。cronWindowMin は cron 間隔（分）＝取りこぼし防止の許容窓。
 * interval: 業務時間窓内で前回から patrol_interval_min 以上経過。
 * fixed: 予定時刻ちょうど（±cronWindow）に一致し、その窓でまだ走っていない。
 */
export function isDue(
  s: PatrolSettings,
  jst: { dow: number; minutes: number },
  now: Date,
  cronWindowMin: number,
): boolean {
  if (!s.enabled || !s.store_id) return false
  if (!s.active_days?.includes(jst.dow)) return false

  const lastRunMinAgo = s.last_run_at
    ? (now.getTime() - new Date(s.last_run_at).getTime()) / 60000
    : Infinity

  if (s.schedule_mode === 'fixed') {
    const hit = (s.patrol_times ?? []).some((t) => {
      const tm = hhmmToMin(t)
      if (tm == null) return false
      return jst.minutes >= tm && jst.minutes < tm + cronWindowMin
    })
    return hit && lastRunMinAgo >= cronWindowMin
  }

  if (!inActiveWindow(jst.minutes, s.active_from, s.active_to)) return false
  return lastRunMinAgo >= s.patrol_interval_min
}
