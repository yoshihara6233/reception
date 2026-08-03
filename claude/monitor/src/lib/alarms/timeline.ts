/**
 * 発報前後スナップ（PB7）の共有定義。
 *
 * 1 発報につき「店舗の全カメラ × 下記オフセット」の JPEG を録画から抽出する。
 * 発生時=0 を基準に、前後を秒粒度で並べた 8 点のフォレンジックタイムライン。
 */
import { appBaseUrl } from '@/lib/app-url'

/** 取得オフセット（秒）。負=発報前 / 0=発生時 / 正=発報後。昇順。 */
export const ALARM_TIMELINE_OFFSETS_SEC = [-5, 0, 5, 10, 20, 30, 60, 180] as const

export type AlarmOffsetSec = (typeof ALARM_TIMELINE_OFFSETS_SEC)[number]

/** ソート可能なストレージキー用サフィックス（m05 / p000 / p005 / p180）。 */
export function offsetKeySec(sec: number): string {
  const abs = String(Math.abs(sec)).padStart(3, '0')
  return sec < 0 ? `m${abs}` : `p${abs}`
}

/** UI 表示ラベル（-5秒 / 発生時 / +5秒 / +1分 / +3分）。 */
export function offsetLabel(sec: number): string {
  if (sec === 0) return '発生時'
  const sign = sec > 0 ? '+' : '−'
  const abs = Math.abs(sec)
  if (abs % 60 === 0) return `${sign}${abs / 60}分`
  return `${sign}${abs}秒`
}

/** frames ingest の絶対 URL（エッジはコマンド内のこの URL へ multipart POST）。 */
export function alarmFramesIngestUrl(): string {
  const base = appBaseUrl()
  return `${base}/api/alarms/frames/ingest`
}
