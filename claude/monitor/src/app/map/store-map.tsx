'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import L from 'leaflet'
import type { EdgeStatus } from '@/lib/types/db'
import { deriveEdgeStatus } from '@/lib/edge-status'

type StoreRow = {
  id: string
  name: string
  address: string | null
  latitude: number
  longitude: number
  area_code: string | null
  edge_devices: { id: string; status: EdgeStatus; last_seen_at: string | null }[]
}

// GE Phase 2b: ブランドアクセントは藍に集約（grid/live=藍）。semantic は GE 値へ。
const COLORS: Record<EdgeStatus, string> = {
  offline: '#9ca3af',
  idle:    '#2F7A4F',
  grid:    '#2C4A7E',
  live:    '#2C4A7E',
  vod:     '#B5761A',
  error:   '#A3332B',
}

/**
 * TC3: last_seen 鮮度を真実源にマーカーの既定色/ラベルを決める。監視中断=赤、
 * 監視停止/未設置=グレー。固着した status(grid 等)に化けさせない。
 */
function displayDot(dev: { status: EdgeStatus; last_seen_at: string | null } | undefined): { color: string; label: string } {
  const d = deriveEdgeStatus(dev?.status, dev?.last_seen_at)
  if (d.plane === 'interrupted')  return { color: '#A3332B', label: '監視中断' }
  if (d.plane === 'stopped')      return { color: '#9ca3af', label: '監視停止' }
  if (d.plane === 'unconfigured') return { color: '#9ca3af', label: '未設置' }
  return { color: COLORS[(d.mode ?? 'offline') as EdgeStatus] ?? '#9ca3af', label: d.mode ?? 'idle' }
}

/**
 * Build a marker icon.
 *
 * F26: variants for the alert-zoom mode.
 *   - `highlight` = true   → 22 px red ring + pulse animation (用: アラート対象)
 *   - `dimmed`    = true   → 10 px, 半透明 (非対象)
 *   - 既定                → 14 px (通常表示)
 */
function makeIcon(
  dotColor: string,
  variant: 'normal' | 'highlight' | 'dimmed',
): L.DivIcon {
  const color = variant === 'highlight' ? '#A3332B' : dotColor
  const size  = variant === 'highlight' ? 22 : variant === 'dimmed' ? 10 : 14
  const opacity = variant === 'dimmed' ? 0.4 : 1
  const pulseCls = variant === 'highlight' ? ' intereco-alert-pulse' : ''
  return L.divIcon({
    className: '',
    html: `<div class="${pulseCls.trim()}" style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);opacity:${opacity}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

export default function StoreMap({
  stores,
  highlightIds,
}: {
  stores: StoreRow[]
  /**
   * F26: when provided (even empty array), the map enters alert-zoom mode:
   *   - viewport fits to these stores
   *   - matching markers are enlarged + red + pulsing
   *   - non-matching markers shrink + dim
   * When undefined, default behavior (all markers normal).
   */
  highlightIds?: string[] | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<L.Map | null>(null)
  // Track markers so we can re-style them when highlightIds changes without
  // rebuilding the entire map (preserves user pan/zoom state on subsequent
  // highlight toggles… well actually we re-fit, but at least no flicker).
  const markersRef   = useRef<Map<string, L.Marker> | null>(null)
  // F28: Next.js router so popup links navigate client-side (no full reload)
  // — same fast path as the store-tree sidebar.
  const router       = useRouter()
  // Keep a fresh router ref inside the Leaflet event handler that's
  // registered once at map-build time. Without this we'd capture the
  // initial router and miss subsequent renders.
  const routerRef    = useRef(router)
  routerRef.current  = router

  // ── Build the map once (no dependency on highlightIds — that's a separate effect)
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const center: [number, number] = stores.length
      ? [
          stores.reduce((s, x) => s + x.latitude,  0) / stores.length,
          stores.reduce((s, x) => s + x.longitude, 0) / stores.length,
        ]
      : [36.2048, 138.2529]

    const map = L.map(containerRef.current).setView(center, stores.length ? 6 : 5)
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)

    const markers = new Map<string, L.Marker>()
    markersRef.current = markers

    stores.forEach((s) => {
      const disp = displayDot(s.edge_devices?.[0])   // TC3: 派生色/ラベル
      // F28: data-store-id 属性を仕込んでおき、popupopen ハンドラ側で
      // クリックを捕まえて router.push に流す（プレーン <a> による
      // フルページリロードを回避）。
      const popup = L.popup({ minWidth: 180 }).setContent(`
        <div style="font-size:13px;line-height:1.5">
          <div style="font-weight:600;margin-bottom:2px">${s.name}</div>
          ${s.address ? `<div style="font-size:11px;color:#64748b">${s.address}</div>` : ''}
          <div style="margin:4px 0">
            <span style="display:inline-block;padding:1px 6px;border-radius:8px;color:white;font-size:11px;background:${disp.color}">${disp.label}</span>
          </div>
          <a href="/stores/${s.id}" data-store-id="${s.id}" class="intereco-popup-go-store" style="display:block;text-align:center;margin-top:4px;padding:4px 8px;border-radius:4px;background:#2C4A7E;color:white;font-size:11px;text-decoration:none">16分割で見る</a>
        </div>
      `)
      const m = L.marker([s.latitude, s.longitude], { icon: makeIcon(disp.color, 'normal') })
        .bindPopup(popup)
        .addTo(map)
      markers.set(s.id, m)
    })

    // F28: popupopen 時にリンクをハイジャックして client-side ナビへ。
    // これによりブラウザのフルリロードが発生せず、React コンテキストや
    // バンドル評価をスキップして MonitorWorkspace が即マウントされる
    // ＝ 店舗ツリーから選んだ時と同等の速さで 16分割 JPEG が表示開始する。
    map.on('popupopen', (e) => {
      // Leaflet 1.7+: getElement() は popup の wrapper DOM を返す。
      const el = (e.popup as L.Popup & { getElement: () => HTMLElement | undefined }).getElement?.()
      if (!el) return
      const link = el.querySelector('.intereco-popup-go-store') as HTMLAnchorElement | null
      if (!link || link.dataset.intercoBound === '1') return
      link.dataset.intercoBound = '1'
      link.addEventListener('click', (ev) => {
        // 修飾キー押下時はブラウザ既定動作（新規タブ等）を尊重する
        const me = ev as MouseEvent
        if (me.metaKey || me.ctrlKey || me.shiftKey || me.altKey || me.button === 1) return
        ev.preventDefault()
        const storeId = link.dataset.storeId
        if (storeId) routerRef.current.push(`/stores/${storeId}`)
      })
    })

    // F26.3: 初期マウント直後はコンテナサイズの計算が未完了の場合があるので、
    // 次のフレームで invalidateSize を呼んで Leaflet に正しいサイズを再認識させる。
    // これを呼ばないと、後の fitBounds がコンテナサイズ 0 を前提に計算するため
    // 視覚的に何も起きないように見えることがある。
    requestAnimationFrame(() => {
      if (mapRef.current === map) map.invalidateSize(false)
    })

    // F26.3: タブ切替や画面リサイズに追随して invalidateSize を呼ぶ。
    // BCP/SECURITY タブから戻った時にコンテナが復活するケースもこれでカバー。
    const ro = new ResizeObserver(() => {
      if (mapRef.current === map) map.invalidateSize(false)
    })
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
      markersRef.current = null
    }
  }, [stores])

  // ── React to highlightIds changes: restyle markers + fit bounds ───────────
  useEffect(() => {
    const map     = mapRef.current
    const markers = markersRef.current
    if (!map || !markers) return

    const highlight = highlightIds && highlightIds.length > 0
      ? new Set(highlightIds)
      : null

    // Restyle every marker
    stores.forEach((s) => {
      const m = markers.get(s.id)
      if (!m) return
      const variant: 'normal' | 'highlight' | 'dimmed' =
        !highlight        ? 'normal' :
        highlight.has(s.id) ? 'highlight' : 'dimmed'
      m.setIcon(makeIcon(displayDot(s.edge_devices?.[0]).color, variant))
    })

    // Fit the viewport to highlighted stores (if any).
    if (highlight) {
      const targets = stores.filter((s) => highlight.has(s.id))
      console.log(
        '[StoreMap] alert-zoom: highlightIds=', highlightIds,
        'targets=', targets.length,
        'sample=', targets[0] && { id: targets[0].id, lat: targets[0].latitude, lng: targets[0].longitude },
      )
      if (targets.length > 0) {
        const bounds = L.latLngBounds(
          targets.map((s) => [s.latitude, s.longitude] as [number, number])
        )
        // Refresh size in case the container was resized (tab switch etc.)
        map.invalidateSize(false)
        // F26.3: maxZoom を 12 → 14 に上げて、近接する 2-3 店舗でも視覚的に
        // しっかりズームインするように。padding は 60 でマーカーがオーバーレイ
        // (ボタンやバナー) と被らないよう余白確保。
        // animate オプションは省略 (デフォルト) — 一部環境で animate:true が
        // 内部で no-op になる事例が報告されているため。
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 })
      }
    }
  }, [highlightIds, stores])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
