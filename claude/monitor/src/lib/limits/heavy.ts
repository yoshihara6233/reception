import 'server-only'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { rateLimitAllows } from '@/lib/rate-limit'

/**
 * 重い処理の回数の上限 (2026-10-30・自主診断 ASVS 15.2.2・2.4.1)。
 *
 * ログイン済みの人 (と拠点のキオスク) が、時間や外部の課金を食う処理を繰り返し呼べた。
 * BCP の ZIP・報告書の作り直し・月次の手動確定・CSV の取り込み・顔の照合・遠隔視聴の
 * セッション・VOD の依頼・住所の座標。どれも 1 回は正当でも、続けて叩かれると関数の時間・
 * メモリ・拠点の帯域・Rekognition の課金・Nominatim の約款 (1 秒 1 回) を使い切る。
 *
 * 判定は DB の `rate_limit_hit` (lib/rate-limit.ts) に任せる。Vercel の関数は複数の
 * インスタンスに分かれるので、プロセス内の数え方では効かない。
 *
 * **「同時数」の扱い**: rate_limit_hit は窓の中の回数を数える仕組みで、終わりを知らない。
 * そこで「60 秒に N 回」の短い窓を同時数の代わりにする。下の処理はどれも普通は 60 秒より
 * 短く終わるので、60 秒に 2 回までなら、同じ人が同時に走らせられるのも実質 2 本まで。
 * 加えて 1 時間の窓で総量を縛る。
 *
 * **フェイルオープン**: DB に届かないときは通す (rate-limit.ts の方針)。これは嫌がらせと
 * 使いすぎの対策で、認可の境界ではない。
 *
 * 断ったことは rateLimitAllows が `[security] {"kind":"rate_limited",...}` で記録する
 * (鍵の後ろの利用者 ID は書かず、種類だけ)。
 */

export type HeavyAction =
  | 'bcp-zip'          // GET /api/bcp/[id]/snapshots.zip
  | 'bcp-report'       // POST /api/bcp/[id]/generate-report
  | 'monthly-finalize' // POST /api/admin/reports/monthly
  | 'csv-import'       // POST /api/admin/import/stores・/cameras
  | 'face-auth'        // POST /api/baggage/kiosk/face-auth (照合をするときだけ)
  | 'video-session'    // POST /api/video/sessions
  | 'vod-request'      // POST /api/vod (使い回せないときだけ)
  | 'geocode'          // GET /api/geocode・/api/admin/geocode
  | 'nominatim'        // Nominatim への問い合わせ (アプリ全体で 1 秒 1 回・OSM の約款)

/** 何で数えるか。user=利用者 ID・tenant=テナント ID・store=店舗 ID・all=アプリ全体 */
export type HeavyScope = 'user' | 'tenant' | 'store' | 'all'

export interface HeavyRule {
  scope: HeavyScope
  limit: number
  windowSec: number
}

/**
 * 値と理由。変えるときは docs/security-maintenance.md §3.2 も直す。
 *
 * - bcp-zip: 1 件の BCP の画像を全部 ZIP にする。流しながら作るので 1 本のメモリは小さいが、
 *   拠点の画像の数だけ Storage から取る。画面のボタンを押し直す程度 (60 秒に 2 回) と、
 *   1 時間 20 回 (1 回の発令で 10 拠点ぶんを 2 回ずつ落とせる)。アプリ全体で 60 秒 20 本。
 * - bcp-report: PDF を同期で組み立てる (画像を全部読み込む)。60 秒 3 回・1 時間 30 回。
 *   アプリ全体で 60 秒 20 本 (関数の CPU とメモリを他の利用者に残す)。
 * - monthly-finalize: テナントの全拠点を集計して PDF。管理者だけ。過去の月をまとめて
 *   確定する使い方を残すため 1 時間 30 回。同じテナントで 60 秒 3 回 (別の管理者と重ならない)。
 * - csv-import: 行ごとに書き込む。60 秒 3 回・1 時間 30 回 (行数の上限は lib/admin/csv.ts)。
 * - face-auth: 1 回ごとに Rekognition の課金。キオスクは 1 人の照合に撮影〜応答で数秒
 *   かかるので、1 店 60 秒 30 回は入退室の列の速さを十分に超える。1 店 1 時間 600 回で頭打ち。
 * - video-session: 画面の切り替えと自動の再接続で開き直す。60 秒 30 回・1 時間 600 回。
 *   同時に見られる本数は別に session_limits (テナントごとの同時視聴数) が縛る。
 * - vod-request: 拠点に録画の切り出しと送り出しをさせる。同じ範囲の使い回しは数えない。
 *   60 秒 10 回・1 時間 120 回。
 * - geocode: 住所の座標。人が押すボタン。60 秒 10 回・1 時間 100 回。
 * - nominatim: OSM の約款が「アプリ全体で 1 秒 1 回」。超えるとこちらの IP が遮断され、
 *   正規の利用者も座標を引けなくなる。
 */
export const HEAVY_LIMITS: Record<HeavyAction, HeavyRule[]> = {
  'bcp-zip': [
    { scope: 'user', limit: 2, windowSec: 60 },
    { scope: 'user', limit: 20, windowSec: 3600 },
    { scope: 'all', limit: 20, windowSec: 60 },
  ],
  'bcp-report': [
    { scope: 'user', limit: 3, windowSec: 60 },
    { scope: 'user', limit: 30, windowSec: 3600 },
    { scope: 'all', limit: 20, windowSec: 60 },
  ],
  'monthly-finalize': [
    { scope: 'user', limit: 3, windowSec: 60 },
    { scope: 'user', limit: 30, windowSec: 3600 },
    { scope: 'tenant', limit: 3, windowSec: 60 },
  ],
  'csv-import': [
    { scope: 'user', limit: 3, windowSec: 60 },
    { scope: 'user', limit: 30, windowSec: 3600 },
  ],
  'face-auth': [
    { scope: 'store', limit: 30, windowSec: 60 },
    { scope: 'store', limit: 600, windowSec: 3600 },
  ],
  'video-session': [
    { scope: 'user', limit: 30, windowSec: 60 },
    { scope: 'user', limit: 600, windowSec: 3600 },
  ],
  'vod-request': [
    { scope: 'user', limit: 10, windowSec: 60 },
    { scope: 'user', limit: 120, windowSec: 3600 },
  ],
  'geocode': [
    { scope: 'user', limit: 10, windowSec: 60 },
    { scope: 'user', limit: 100, windowSec: 3600 },
  ],
  'nominatim': [
    { scope: 'all', limit: 1, windowSec: 1 },
  ],
}

export type HeavySubjects = Partial<Record<Exclude<HeavyScope, 'all'>, string | null | undefined>>

export type HeavyDecision = { ok: true } | { ok: false; retryAfterSec: number }

/** rate_limit_hit の鍵。`<処理>:<範囲>:<窓>:<ID>`。記録には先頭の処理名だけが出る。 */
export function heavyKey(action: HeavyAction, rule: HeavyRule, id: string): string {
  return `${action}:${rule.scope}:${rule.windowSec}s:${id}`
}

/**
 * 決まりを順に当て、どれか 1 つでも超えたら断る。
 * ID が渡されていない範囲の決まりは飛ばす (例: 店舗の分からない呼び出しの store)。
 * 短い窓から先に当てるので、連打は 1 時間の数を食わずに止まる。
 */
export async function heavyAllows(
  svc: SupabaseClient,
  action: HeavyAction,
  subjects: HeavySubjects,
): Promise<HeavyDecision> {
  for (const rule of HEAVY_LIMITS[action]) {
    const id = rule.scope === 'all' ? 'app' : subjects[rule.scope]
    if (!id) continue
    let ok = true
    try {
      ok = await rateLimitAllows(svc, heavyKey(action, rule, id), rule.limit, rule.windowSec)
    } catch (e) {
      // DB の呼び出しそのものが投げた (接続の失敗など)。rate-limit.ts と同じくフェイルオープン
      console.warn('[heavy-limit] check threw, allowing:', (e as Error)?.message ?? e)
    }
    if (!ok) return { ok: false, retryAfterSec: rule.windowSec }
  }
  return { ok: true }
}

export const HEAVY_LIMIT_MESSAGE = '短い時間に続けて実行されたため、受け付けを止めています。しばらくしてからもう一度お試しください'

/** 429 の応答。画面が `message` を出せるように日本語の文も付ける。 */
export function tooManyRequests(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: 'rate_limited', message: HEAVY_LIMIT_MESSAGE },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSec))) } },
  )
}
