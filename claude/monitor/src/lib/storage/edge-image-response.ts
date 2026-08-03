/**
 * ライブ画像ルートの応答の作り分け（表示は 302 / 保存は中継）。
 *
 * 【なぜ要るか】R2 移行（2026-08-03）で grid/snapshot ルートは
 * `img.genesis-edge.com` へ 302 するようになった。ブラウザの `<img>` は
 * CORS 不要なので表示は通るが、`fetch()` はリダイレクト先まで追った上で
 * **Worker に `Access-Control-Allow-Origin` が無いためブロックされる**。
 * その結果「見えているのに『保存失敗』」という症状になっていた（16分割で発生。
 * シングルは R2 未作成で Supabase へ落ちており、同一オリジンだったため成功していた）。
 *
 * 【なぜ Worker に CORS を足さないか】許可オリジンを固定すると Vercel の
 * プレビューデプロイ（毎回ドメインが変わる）で必ず壊れる。ワイルドカードは
 * 署名URLの持ち出しを許すことになる。保存はクリック時だけの低頻度操作なので、
 * **その時だけサーバ側で中継**するのが素直で、ライブの 302（エグレス無料）も保てる。
 */
import { NextRequest, NextResponse } from 'next/server'
import { edgeImagesR2Configured } from './edge-images-r2'
import { edgeImagesWorkerConfigured } from './edge-images-sign'

/** ライブ画像に付ける共通ヘッダ（中間・ブラウザとも一切キャッシュさせない）。 */
const NO_STORE = 'no-store, no-cache, must-revalidate'

/** 保存（ダウンロード）要求か。`?download=1`。 */
export function wantsImageBytes(req: NextRequest): boolean {
  const v = req.nextUrl.searchParams.get('download')
  return v === '1' || v === 'true'
}

/**
 * 表示なら 302、保存ならバイトを同一オリジンで返す。
 *
 * 中継に失敗したら 302 へ倒す（表示だけは死守する）。保存は失敗して構わないが、
 * ライブが止まるのは避けたいため。
 */
export async function imageRedirectOrBytes(
  url: string,
  asBytes: boolean,
): Promise<NextResponse> {
  if (!asBytes) {
    return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': NO_STORE } })
  }
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`upstream ${res.status}`)
    return new NextResponse(res.body, {
      status: 200,
      headers: {
        'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': NO_STORE,
      },
    })
  } catch {
    return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': NO_STORE } })
  }
}

/**
 * Supabase への「古い画像フォールバック」を禁じてよいか。
 *
 * R2 移行（2026-08-03）以降、エッジは R2 への PUT が成功すると **Supabase へは
 * 書かない**（早期 return）。つまり Supabase 側のオブジェクトは移行時点で凍結
 * されており、そこへ落ちると **必ず古いフレーム**が返る。
 *
 * 監視用途で古い映像を黙って出すのは「今を見ている」という誤認を生むので、
 * R2/Worker が構成済みの環境では落とさず取得失敗を返す（2026-08-04 判断）。
 * R2 未構成の環境（ローカル等）は従来どおり Supabase を使う。
 */
export function staleFallbackForbidden(): boolean {
  return edgeImagesWorkerConfigured() || edgeImagesR2Configured()
}

/** 最新フレームが取れないときの応答（古い画像は返さない）。 */
export function imageUnavailable(): NextResponse {
  return new NextResponse('frame not available', {
    status: 503,
    headers: { 'Cache-Control': NO_STORE },
  })
}
