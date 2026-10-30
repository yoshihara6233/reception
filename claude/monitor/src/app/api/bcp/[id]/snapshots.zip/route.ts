/**
 * GET /api/bcp/<eventId>/snapshots.zip
 *
 * F40: Bulk-download every JPEG snapshot for a BCP event as a single ZIP.
 *
 * Layout inside the ZIP:
 *   <store_name>/<camera_name>/<offsetLabel>.jpg
 * Example:
 *   渋谷南店/レジ前カメラ/m5_5分前.jpg
 *   渋谷南店/レジ前カメラ/p0_発生時.jpg
 *   渋谷南店/レジ前カメラ/p5_5分後.jpg
 *   ...
 *
 * Legacy video clips (offset_min IS NULL) are NOT included — only the
 * F40-style snapshots. The detail page exposes legacy clips as individual
 * download links instead.
 *
 * 2026-10-30 (自主診断 ASVS 15.2.2・2.4.1): 以前は画像を全部同時に取りに行き、全部を
 * メモリに置いてから 1 つのバッファにしていた。回数の制限も無かった。いまは
 *   - 利用者ごとの回数の上限 (lib/limits/heavy.ts の bcp-zip)
 *   - 1 件ずつ取りながら流す (lib/bcp/zip-stream.ts・先読みは ZIP_PREFETCH 件)
 *   - 項目の数と合計の大きさの上限 (ZIP_MAX_FILES・ZIP_MAX_BYTES)
 *   - 古い行の公開 URL を取るときの時間切れ (LEGACY_FETCH_TIMEOUT_MS)
 */
import { NextResponse } from 'next/server'
import { isOwnStorageUrl } from '@/lib/storage/own-storage-url'
import { safeZipSegment } from '@/lib/security/input'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { recordFootageAccess } from '@/lib/audit/footage-access'
import { zipStream, type ZipEntrySource } from '@/lib/bcp/zip-stream'
import { heavyAllows, tooManyRequests } from '@/lib/limits/heavy'

// 流し終えるまで関数が生きている必要がある。画像が数百枚でも 1 枚ずつ取れば数十秒で終わる。
export const maxDuration = 300

/** 先に取りに行く数 (手元のメモリ ≒ これ × 1 枚) */
const ZIP_PREFETCH = 4
/** 1 つの ZIP に入れる画像の上限 (64 カメラ × 13 時点 ≒ 832 を十分に超える) */
const ZIP_MAX_FILES = 2000
/** 1 つの ZIP の中身の合計の上限 (1 枚 数百 KB × 2,000 枚を超える分は入れない) */
const ZIP_MAX_BYTES = 1024 * 1024 * 1024
/** 古い行 (公開 URL) を取りに行くときの時間切れ */
const LEGACY_FETCH_TIMEOUT_MS = 15_000

interface ClipRow {
  id:            string
  offset_min:    number | null
  // F76: storage_path replaces clip_url as the source of truth.
  storage_path:  string | null
  clip_url:      string | null
  upload_status: string
  recorder_cameras: { id: string; name: string } | null
}
interface EventRow {
  id:              string
  alert_issued_at: string
  stores:          { id: string; name: string } | null
}

function offsetSlug(min: number): string {
  if (min === 0)  return 'p0_発生時'
  if (min < 0)    return `m${Math.abs(min)}_${Math.abs(min)}分前`
  return `p${min}_${min}分後`
}

/** Sanitize a name fragment so it works as a path component on Windows/macOS. */
// ZIP の中の名前の 1 区切り。`..` のような . だけの名前も使わない (ASVS 5.3.2)
const safeName = safeZipSegment

export async function GET(
  _req: Request,
  ctx:  { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params

  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  // 回数の上限 (60 秒 2 回・1 時間 20 回・アプリ全体で 60 秒 20 本)。画面はただのリンクなので
  // 断った理由は JSON の message に日本語で書く
  const svc = createSupabaseService()
  const allowed = await heavyAllows(svc, 'bcp-zip', { user: user.id })
  if (!allowed.ok) return tooManyRequests(allowed.retryAfterSec)

  // Fetch event (for naming + permission check via RLS)
  const { data: eventData } = await supa
    .from('bcp_events')
    .select('id, alert_issued_at, stores ( id, name )')
    .eq('id', id)
    .single()
  if (!eventData) return new NextResponse('Not Found', { status: 404 })
  const event = eventData as unknown as EventRow

  // G3: 証跡エクスポート（ZIPダウンロード）の閲覧アクセスを記録（best-effort・5分dedup）。
  await recordFootageAccess({
    actorUserId: user.id, storeId: event.stores?.id ?? null,
    accessType: 'bcp_export', resourceId: id,
  })

  // Fetch snapshots only (offset_min IS NOT NULL)
  const { data: clipData } = await supa
    .from('bcp_clips')
    .select('id, offset_min, storage_path, clip_url, upload_status, recorder_cameras ( id, name )')
    .eq('event_id', id)
    .not('offset_min', 'is', null)
    .order('camera_id', { ascending: true })
    .order('offset_min', { ascending: true })

  const clips = ((clipData ?? []) as unknown as ClipRow[])
    .filter((c) => (c.storage_path || c.clip_url) && c.upload_status === 'completed')

  if (clips.length === 0) {
    return new NextResponse('No snapshots available', { status: 404 })
  }

  if (clips.length > ZIP_MAX_FILES) {
    return new NextResponse(`Too many snapshots (${clips.length} > ${ZIP_MAX_FILES})`, { status: 413 })
  }

  // F76: Service Role for direct bucket download. The bucket is Private as
  // of Phase 8 — we no longer fetch the public URL.
  const storeFolder = safeName(event.stores?.name, 'store')

  const entries: ZipEntrySource[] = clips.map((c) => ({
    name: `${storeFolder}/${safeName(c.recorder_cameras?.name, c.recorder_cameras?.id ?? 'camera')}/${offsetSlug(c.offset_min ?? 0)}.jpg`,
    load: async () => {
      if (c.storage_path) {
        // F76: pull the object directly via Service Role (bypasses Storage RLS).
        const { data, error } = await svc.storage.from('bcp-clips').download(c.storage_path)
        if (error || !data) return null
        return new Uint8Array(await data.arrayBuffer())
      }
      // 古い行の公開の URL は、自分の Supabase の保存先のものだけ取りに行く。clip_url は
      // エッジの鍵でも書けるので、任意の宛先へ取りに行かせない (SSRF・ASVS 1.3.6)
      if (c.clip_url && isOwnStorageUrl(c.clip_url)) {
        // Legacy fallback: row predates F76 and only has a public URL.
        // Works while the bucket is still Public; quietly skipped after flip.
        const r = await fetch(c.clip_url, { cache: 'no-store', signal: AbortSignal.timeout(LEGACY_FETCH_TIMEOUT_MS) })
        if (!r.ok) return null
        return new Uint8Array(await r.arrayBuffer())
      }
      return null
    },
  }))

  // 取れなかった画像は飛ばす (以前と同じ・取れたものだけを渡す)
  const body = zipStream(entries, {
    prefetch:      ZIP_PREFETCH,
    maxTotalBytes: ZIP_MAX_BYTES,
    modifiedAt:    new Date(event.alert_issued_at),
  })

  const issuedAt = event.alert_issued_at.slice(0, 19).replace(/[:T]/g, '-')
  const fname    = `bcp_${storeFolder}_${issuedAt}.zip`

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type':        'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fname)}"`,
      'Cache-Control':       'no-store',
    },
  })
}
