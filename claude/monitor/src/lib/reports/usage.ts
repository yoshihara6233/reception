/**
 * 月次利用状況レポートの純ロジック（DB非依存・単体テスト対象）。
 * 集計そのものは SQL RPC（usage_summary/weekday/trend・refresh_usage_daily）で行い、
 * ここでは日付範囲の算出・率計算・表示ラベルなど副作用のない部分だけを持つ。
 */

/** 曜日ラベル（0=日 … 6=土。SQL の extract(dow) と一致）。 */
export const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const

/** レポート指標のキー（UI 列と RPC 戻り値の対応）。 */
export interface UsageMetrics {
  patrol_count: number
  alarm_count: number
  inspection_count: number
  baggage_exit_count: number
  baggage_confirmed_count: number
  face_auth_matched: number
  face_auth_unmatched: number
  face_auth_attempts: number
  video_live_count: number
  footage_access_count: number
}

/** 2桁ゼロ埋め。 */
function p2(n: number): string { return String(n).padStart(2, '0') }

/**
 * 映像確認率(%) = 店長確認済 / 退出検査実施。分母0は null（"—"表示用）。
 * 0〜100 に丸め（小数1桁）。
 */
export function confirmRatePct(confirmed: number, exitTotal: number): number | null {
  if (!exitTotal || exitTotal <= 0) return null
  return Math.round((confirmed / exitTotal) * 1000) / 10
}

/** 指定年月（1-12）の月初・月末を 'YYYY-MM-DD' で返す（JST暦日想定）。 */
export function monthBounds(year: number, month1to12: number): { from: string; to: string } {
  const from = `${year}-${p2(month1to12)}-01`
  // 翌月0日 = 当月末日。month は 0-index なので monthday 0 で末日。
  const lastDay = new Date(Date.UTC(year, month1to12, 0)).getUTCDate()
  const to = `${year}-${p2(month1to12)}-${p2(lastDay)}`
  return { from, to }
}

/**
 * 月次推移用: 終端年月から遡って count ヶ月ぶんの範囲 [from(=最古月初), to(=終端月末)]。
 */
export function trendBounds(endYear: number, endMonth1to12: number, count: number): { from: string; to: string } {
  const to = monthBounds(endYear, endMonth1to12).to
  // 遡り月初。endMonth-(count-1)。
  const startIdx = endMonth1to12 - (count - 1)
  const startYear = endYear + Math.floor((startIdx - 1) / 12)
  const startMonth = ((((startIdx - 1) % 12) + 12) % 12) + 1
  const from = monthBounds(startYear, startMonth).from
  return { from, to }
}

/**
 * rollup cron の対象範囲: 今日(JST 'YYYY-MM-DD')から daysBack 日前まで。
 * 遅延到着に備え直近数日を毎回再集計するため from は過去側。
 */
export function rollupWindow(todayJst: string, daysBack: number): { from: string; to: string } {
  const [y, m, d] = todayJst.split('-').map(Number)
  const base = Date.UTC(y, m - 1, d)
  const fromMs = base - Math.max(0, daysBack) * 86400000
  const f = new Date(fromMs)
  const from = `${f.getUTCFullYear()}-${p2(f.getUTCMonth() + 1)}-${p2(f.getUTCDate())}`
  return { from, to: todayJst }
}

/** 前月(1-12)の {year, month} を返す。 */
export function prevMonth(year: number, month1to12: number): { year: number; month: number } {
  if (month1to12 <= 1) return { year: year - 1, month: 12 }
  return { year, month: month1to12 - 1 }
}

/**
 * 利用状況レポートで出す段と列。テナントが契約しているオプション (lib/tenant/features) で決める。
 * G・VMS だけのテナントに巡回・手荷物検査・顔認証の 0 が並ぶと、何の画面か分からない (2026-09-30)。
 * 顔認証と映像確認率は手荷物検査の中の数字なので baggage に従う。
 */
export interface UsageShow { patrol: boolean; alarm: boolean; baggage: boolean }

/** 同時視聴の上限の契約: 登録カメラ 50 台ごとに 1 名 (2026-09-30・発注者の判断)。 */
export const CAMERAS_PER_VIEWER = 50

/**
 * 登録カメラ台数から、同時視聴の上限の目安を出す (50 台ごとに 1 名・50 台未満は 1 名)。
 * 実際の上限は運営が 運営管理 → 視聴上限 に入れる値 (session_limits.max_concurrent) で、
 * これはその目安。台数から自動では決めない (運営が入れる方式・発注者の判断)。
 */
export function viewerLimitFor(cameras: number): number {
  if (!Number.isFinite(cameras) || cameras < 0) return 1
  return Math.max(1, Math.floor(cameras / CAMERAS_PER_VIEWER))
}
