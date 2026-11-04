/**
 * BCP の種別・状態の表示名 (2026-11-04・シナリオ試験の所見)。
 *
 * 報告書の PDF に earthquake・recording などの内部名がそのまま出ていた。表示名は
 * 画面の一覧 (EventsTreeTable) と同じ i18n の bcpDashboard から引く。知らない値はそのまま返す。
 */
import { MESSAGES, type Lang, type Msg } from '@/lib/i18n/messages'

type B = Msg['bcpDashboard']

export function bcpAlertTypeLabel(t: string, lang: Lang = 'ja'): string {
  const b: B = MESSAGES[lang].bcpDashboard
  switch (t) {
    case 'earthquake':      return b.alertTypeEarthquake
    case 'special_warning': return b.alertTypeSpecialWarning
    case 'test':            return b.alertTypeTest
    // 2026-08-21 に発動対象から外した種別。過去の報告書を読めるように残す。
    case 'tsunami':         return b.alertTypeTsunami
    case 'missile':         return b.alertTypeMissile
    default:                return t
  }
}

export function bcpStatusLabel(s: string, lang: Lang = 'ja'): string {
  const b: B = MESSAGES[lang].bcpDashboard
  switch (s) {
    case 'pending':          return b.statusPending
    case 'recording':        return b.statusRecording
    case 'clips_uploaded':   return b.statusClipsUploaded
    case 'report_generated': return b.statusReportGenerated
    case 'completed':        return b.statusCompleted
    case 'failed':           return b.statusFailed
    default:                 return s
  }
}
