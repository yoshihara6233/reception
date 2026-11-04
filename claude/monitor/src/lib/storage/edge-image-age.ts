/**
 * ライブ画像 (grid.jpg / snapshot.jpg) が「何秒前に置かれたか」(2026-11-04・シナリオ試験の所見)。
 *
 * 監視の画面を開いた直後は、エッジが新しい画像を上げるまで**前回の視聴のときの画像**が
 * そのまま返る。以前は画面にそれと分かる印が無く、古い映像を今の映像と見誤るおそれがあった。
 * 画面は `?meta=1` でこの値を取り、古ければ「約 ○ 秒前の映像」と出す (useFrameAge)。
 *
 * 経過は**サーバの時計で**計る (閲覧端末の時計のずれに左右されないため)。
 * 調べ方は画像の配り方と同じ順: R2 の S3 API (LastModified) → 自社ドメインの Worker の HEAD
 * (Last-Modified の見出し) → Supabase Storage の HEAD (R2 を使わない環境だけ)。
 * どれでも分からなければ null (画面は印を出さない＝従来どおり)。
 */
import { NextResponse } from 'next/server'
import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { edgeImagesR2Configured, edgeImagesBucket, r2 } from './edge-images-r2'
import { edgeImagesWorkerConfigured, signEdgeImageUrl } from './edge-images-sign'
import { staleFallbackForbidden } from './edge-image-response'

/** 画面が「経過」を尋ねる要求か。`?meta=1`。 */
export function wantsFrameMeta(url: URL): boolean {
  return url.searchParams.get('meta') === '1'
}

function parseHttpDate(v: string | null): number | null {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/** 置かれた時刻 (epoch ms)。分からなければ null。 */
export async function edgeImageLastModified(key: string, supabaseObjectPath: string): Promise<number | null> {
  if (edgeImagesR2Configured()) {
    try {
      const head = await r2().send(new HeadObjectCommand({ Bucket: edgeImagesBucket(), Key: key }))
      const t = head.LastModified?.getTime()
      if (t != null && Number.isFinite(t)) return t
    } catch { /* 無い・届かない → 次の経路 */ }
  }
  if (edgeImagesWorkerConfigured()) {
    try {
      const url = signEdgeImageUrl('GET', key)
      if (url) {
        const res = await fetch(url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(5_000) })
        // Worker が Last-Modified を返すのは claude/cloudflare/edge-images の 2026-11-04 版から
        if (res.ok) {
          const t = parseHttpDate(res.headers.get('last-modified'))
          if (t != null) return t
        }
      }
    } catch { /* 次の経路 */ }
  }
  if (staleFallbackForbidden()) return null
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const res = await fetch(
      `${supabaseUrl}/storage/v1/object/authenticated/edge-grids/${supabaseObjectPath}?t=${Date.now()}`,
      {
        method: 'HEAD',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Cache-Control': 'no-cache' },
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      },
    )
    if (res.ok) return parseHttpDate(res.headers.get('last-modified'))
  } catch { /* 分からない */ }
  return null
}

/** `?meta=1` の応答。ageMs = サーバの今 − 置かれた時刻 (負は 0 に丸める)。 */
export async function frameMetaResponse(key: string, supabaseObjectPath: string): Promise<NextResponse> {
  const at = await edgeImageLastModified(key, supabaseObjectPath)
  const now = Date.now()
  return NextResponse.json(
    { capturedAt: at == null ? null : new Date(at).toISOString(), ageMs: at == null ? null : Math.max(0, now - at) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
