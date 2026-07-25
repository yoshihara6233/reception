/**
 * 月次確定レポートのスナップショット型（monthly_reports.totals/stores/contract に凍結）。
 * DB非依存・クライアント/サーバ双方で使う（副作用なし）。
 */
export interface MonthlyTotals {
  patrol: number
  alarm: number
  inspection: number
  baggage_exit: number
  baggage_confirmed: number
  face_matched: number
  face_unmatched: number
  face_attempts: number
  video_live: number
  footage_access: number
}

export interface MonthlyStoreRow {
  store_id: string
  store_name: string
  patrol: number
  alarm: number
  inspection: number
  baggage_exit: number
  baggage_confirmed: number
  face_attempts: number
  face_matched: number
  face_unmatched: number
}

export interface MonthlyContract {
  max_stores: number | null
  max_patrol: number | null
  max_alarm: number | null
  max_baggage: number | null
}

export interface MonthlyRegistration {
  stores: number
  patrol: number
  alarm: number
  baggage: number
}

/** monthly_reports 1行の表示用 VM。 */
export interface MonthlyReportVM {
  id: string
  ym: string
  totals: MonthlyTotals
  stores: MonthlyStoreRow[]
  contract: MonthlyContract | null
  reg: MonthlyRegistration | null
  pdf_url: string | null
  generated_at: string
}
