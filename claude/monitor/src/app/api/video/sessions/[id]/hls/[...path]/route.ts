/**
 * GET /api/video/sessions/[id]/hls/{index.m3u8 | init.mp4 | s/<seq>.<ext>} — HLS の中継
 *
 * 拠点が R2 の輪番の置き場へ置いた区切りを、視聴者へ中継する（§5.2.2）。
 *   - プレイリストは拠点が書いたまま返す（区切りの名前は相対の `s/<seq>.<ext>`）。
 *   - `s/<seq>` は置き場 `seq % 置き場の数`（ライブ 8・録画再生 16）に読み替える。
 *   - プレイリストは no-store、区切りは短く（5 秒）持たせてよい。
 *
 * **署名付き GET へ 302 しない。** 署名付き URL を API 応答に出さない（§6）ため、
 * ここで読んでそのまま流す。見られるのはセッションを開いた本人だけ。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireVideoSessionAccess } from '@/lib/video/access'
import { getVideoObject, videoKey, type VideoObjectName } from '@/lib/storage/video-r2'
import { parseHlsPath } from '@/lib/video/session-logic'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path } = await params
  const access = await requireVideoSessionAccess(id)
  if (!access.ok) return new NextResponse(null, { status: access.status })

  const obj = parseHlsPath(path, access.kind)
  if (!obj) return new NextResponse(null, { status: 404 })

  const name: VideoObjectName = obj.kind === 'segment' ? `slot${obj.slot}` : obj.kind
  const found = await getVideoObject(videoKey(id, name)).catch(() => null)
  if (!found) {
    // プレイリストがまだ無いのは「始まる前」なので取り直してほしい（503）。区切りは 404
    return new NextResponse(null, {
      status: obj.kind === 'playlist' ? 503 : 404,
      headers: obj.kind === 'playlist' ? { 'Retry-After': '1', 'Cache-Control': 'no-store' } : {},
    })
  }

  const headers: Record<string, string> = {
    'Content-Type':
      obj.kind === 'playlist' ? 'application/vnd.apple.mpegurl'
      : obj.kind === 'segment' && obj.ext === 'ts' ? 'video/mp2t'
      : 'video/mp4',
    'Cache-Control': obj.kind === 'playlist' ? 'no-store' : 'private, max-age=5',
    'X-Content-Type-Options': 'nosniff',
  }
  if (found.length !== undefined) headers['Content-Length'] = String(found.length)
  return new NextResponse(found.body, { status: 200, headers })
}
