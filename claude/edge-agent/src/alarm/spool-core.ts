/**
 * 発報スプールの純ロジック（config/logger 非依存＝単体テスト対象）。
 *
 * クラウド断・Vercel 障害時に発報を失わないため、ingest 送信に失敗した発報を
 * ローカルへ退避（スプール）し、復帰後に再送する。ここでは「退避すべきか」の判定と
 * エントリの直列化、破棄判定だけを持つ。ファイル IO・タイマは spool.ts（配線側）。
 */

/** スプールする発報 1 件。画像は base64（無ければ null）。 */
export interface SpooledAlarm {
  source:      string
  event_type:  string
  camera_id:   string | null
  dedup_key:   string
  /** 受信時刻（ISO8601）。再送時もこの時刻で記録される（ingest の occurred_at）。 */
  occurred_at: string
  image_b64:   string | null
  /** 再送試行回数（初回送信は含まない）。 */
  attempts:    number
}

export type SendOutcome = 'ok' | 'transient' | 'permanent'

/**
 * 送信結果の分類。
 *  - ok        … 2xx
 *  - transient … ネットワーク断(status=null) / 5xx / 429 → スプールして再送
 *  - permanent … その他 4xx（トークン不正・バリデーション等）→ 再送しても無駄なので破棄
 */
export function classifySendResult(status: number | null): SendOutcome {
  if (status !== null && status >= 200 && status < 300) return 'ok'
  if (status === null || status >= 500 || status === 429) return 'transient'
  return 'permanent'
}

/** スプール保持の上限。超えたら（再送を諦めて）破棄する。 */
export const SPOOL_MAX_AGE_MS  = 24 * 60 * 60 * 1000 // 24時間
export const SPOOL_MAX_ENTRIES = 200                  // ディスク保護（1件≒数百KB）

/** ファイル名: <受信epochms>-<乱数>.json — 名前順 ＝ 古い順。 */
export function spoolFileName(receivedMs: number, rand: string): string {
  return `${String(receivedMs).padStart(15, '0')}-${rand}.json`
}

/** ファイル名から受信時刻を復元（不正なら null）。 */
export function receivedMsFromFileName(name: string): number | null {
  const m = /^(\d{10,15})-[^.]+\.json$/.exec(name)
  if (!m) return null
  const ms = Number(m[1])
  return Number.isFinite(ms) ? ms : null
}

/** 破棄すべきか（古すぎる）。 */
export function isExpired(receivedMs: number, nowMs: number): boolean {
  return nowMs - receivedMs > SPOOL_MAX_AGE_MS
}

export function encodeEntry(e: SpooledAlarm): string {
  return JSON.stringify(e)
}

/** 壊れた JSON・型不一致は null（呼び出し側でファイルごと破棄）。 */
export function decodeEntry(raw: string): SpooledAlarm | null {
  try {
    const v = JSON.parse(raw) as Partial<SpooledAlarm>
    if (typeof v.source !== 'string' || typeof v.occurred_at !== 'string' || typeof v.dedup_key !== 'string') return null
    return {
      source:      v.source,
      event_type:  typeof v.event_type === 'string' ? v.event_type : 'input',
      camera_id:   typeof v.camera_id === 'string' ? v.camera_id : null,
      dedup_key:   v.dedup_key,
      occurred_at: v.occurred_at,
      image_b64:   typeof v.image_b64 === 'string' ? v.image_b64 : null,
      attempts:    typeof v.attempts === 'number' ? v.attempts : 0,
    }
  } catch {
    return null
  }
}
