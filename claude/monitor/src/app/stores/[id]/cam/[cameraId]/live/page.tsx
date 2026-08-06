import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AppShell } from '@/components/AppShell'
import { signLiveUrl } from '@/lib/live-sign'
import { livekitEnabled } from '@/lib/livekit'
import LivePlayer from './live-player'

export default async function LivePage(
  { params }: { params: Promise<{ id: string; cameraId: string }> },
) {
  const { id: storeId, cameraId } = await params
  const supa = await createSupabaseServer()

  const { data: cam } = await supa
    .from('recorder_cameras')
    .select(`
      id, name, channel, frigate_camera, hls_url,
      recorders ( id, edge_id, vendor, live_host, stores: edge_devices ( store_id, go2rtc_host ) )
    `)
    .eq('id', cameraId)
    .single()

  if (!cam) notFound()
  const c = cam as never as {
    name:           string
    channel:        number
    frigate_camera: string | null
    hls_url:        string | null
    recorders: {
      edge_id:    string
      vendor:     string
      live_host:  string | null
      stores:     { go2rtc_host: string | null } | null
    }
  }
  const edgeId   = c.recorders.edge_id
  const vendor   = c.recorders.vendor
  const liveHost = c.recorders.live_host
  // F80: Build iframe URL pattern per vendor. Only Frigate is wired up today;
  // other vendors fall back to JPEG (the user can also toggle to JPEG manually
  // for BCP / congested-network scenarios).
  //
  // live_host may be either a bare host[:port] (local IP — defaults to http://,
  // LAN-only) OR a full origin with scheme (e.g. https://store.example.com via
  // a Cloudflare Tunnel — works remotely and satisfies the https monitor's
  // mixed-content rule). Honour an explicit scheme when present.
  const isRemoteHost = !!liveHost && /^https?:\/\//.test(liveHost)
  const liveOrigin = liveHost
    ? (isRemoteHost ? liveHost : `http://${liveHost}`)
    : null
  // Transport choice:
  //  - LAN (bare host): embed Frigate's camera UI, which uses WebRTC (25fps,
  //    ~1-2s) — but WebRTC needs UDP and only works on the local network.
  //  - Remote (scheme present, i.e. via an HTTP tunnel): WebRTC can't traverse
  //    the tunnel, so use Frigate's MJPEG stream (/api/<cam>) instead. It's
  //    plain HTTP multipart/x-mixed-replace, so it streams (and moves) through
  //    any HTTPS tunnel. Heavier than h264 but rock-solid for a single camera.
  const liveIframeUrl =
    liveOrigin && vendor === 'frigate' && c.frigate_camera
      ? (isRemoteHost
          ? `${liveOrigin}/api/${c.frigate_camera}?fps=5&height=720`
          : `${liveOrigin}/cameras/${c.frigate_camera}`)
      : null
  // 案2: リモート MJPEG（Cloudflare Tunnel）は、カメラ側 CF Access ログインの代わりに
  // 短TTL HMAC 署名で通す（Worker live-gate が検証）。LIVE_SIGNING_SECRET 未設定なら
  // signLiveUrl は null を返し、従来の生URL（CFログイン方式）へフォールバックする。
  const signedMjpeg = liveIframeUrl && isRemoteHost ? signLiveUrl(liveIframeUrl) : null
  const effectiveLiveUrl = signedMjpeg ?? liveIframeUrl
  const liveSigned = !!signedMjpeg
  // go2rtc 高画質: エッジに go2rtc_host が設定済み（または カメラ単位の hls_url
  // 上書きあり）なら配信対象。ストリーム名はエッジ登録と同じ規則 `cam_<cameraId>`
  // （手動命名不要）。monitor の認証付きプロキシ越しに HLS を再生し、プロキシが
  // Cloudflare Access の Service Token をサーバ側で付けるのでエンドユーザは
  // monitorログインのみ。&mp4 で fMP4(H.264)。これでカメラ追加はエッジ設定ゼロ。
  //
  // ただし **i-PRO NVR 経由（カメラ網が分離された構成）は go2rtc に載せられない**。
  // go2rtc は RTSP を口にするが、NU101 は RTSP 554 を閉じており、ライブの入口が
  // push.cgi しか無い（docs/vendor/ipro-cgi-notes.md）。エッジ側 go2rtc/sync.ts も
  // vendor='onvif-generic' か live_rtsp 明示のカメラしか登録しないため、
  // `cam_<id>` ストリームは存在しない。SFU も go2rtc から引くので同じく成立しない。
  // → 押せるのに必ず失敗するボタンは出さず、理由を1行で示す。
  const liveViaNvr = vendor === 'i-pro-nvr'
  const hasGo2rtc = (!!c.recorders.stores?.go2rtc_host || !!c.hls_url) && !liveViaNvr
  const hqUrl: string | null = hasGo2rtc
    ? `/api/live-proxy/${cameraId}/api/stream.m3u8?src=${encodeURIComponent(`cam_${cameraId}`)}&mp4`
    : null
  const room   = `live-${cameraId}`

  return (
    <AppShell selectedStoreId={storeId}>
      <main className="flex h-full flex-col overflow-hidden bg-slate-100">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 text-xs">
          <div className="text-slate-600">
            <Link href={`/stores/${storeId}`} className="text-blue-600 hover:underline">
              ← 16分割に戻る
            </Link>
            <span className="ml-3 text-slate-400">/</span>
            <span className="ml-3 font-semibold text-slate-900">
              ch{String(c.channel).padStart(2, '0')} {c.name}
            </span>
          </div>
          <div className="text-slate-500">単一カメラライブ</div>
        </div>
        <div className="flex-1 overflow-hidden">
          <LivePlayer
            edgeId={edgeId}
            cameraId={cameraId}
            storeId={storeId}
            room={room}
            liveIframeUrl={effectiveLiveUrl}
            liveIsImageStream={isRemoteHost}
            liveSigned={liveSigned}
            hqUrl={hqUrl}
            sfuEnabled={livekitEnabled() && !liveViaNvr}
            unavailableNote={liveViaNvr
              ? 'レコーダ経由の構成のため高画質ライブは非対応 — 軽量 (JPEG) でご覧ください'
              : null}
          />
        </div>
      </main>
    </AppShell>
  )
}
