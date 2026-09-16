/**
 * Phase 2b: BCP 合成タイムライン（bcp_grid_shots）を PDF・詳細画面で使える形に引く。
 *
 * PDF（lib/pdf/bcp-report.tsx）は「カメラ別グループ × オフセット順」の構造なので、
 * 合成ショットは**疑似カメラ名 `16分割 <フォルダ>（ページN）`** として同じ配列に
 * 流し込む — レイアウトの新設なしで、ページごとに 1 段のタイムラインになる。
 * 欠落（dark_channels）は note としてキャプション下に出す。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BcpReportProps } from '@/lib/pdf/bcp-report'

export interface GridShotRow {
  id: string
  folder_path: string | null
  page_no: number
  channels: number[]
  offset_min: number
  storage_path: string | null
  upload_status: string
  dark_channels: number[]
}

export function gridShotCameraName(folderPath: string | null, pageNo: number): string {
  return `16分割 ${folderPath ?? '未分類'}（ページ${pageNo}）`
}

export function gridShotNote(darkChannels: number[]): string | undefined {
  if (!darkChannels || darkChannels.length === 0) return undefined
  const head = darkChannels.slice(0, 6).join(', ')
  const more = darkChannels.length > 6 ? ` 他${darkChannels.length - 6}台` : ''
  return `未収録 ${darkChannels.length} 台（カメラID ${head}${more}）`
}

/**
 * イベントの合成ショットを BcpReportProps['clips'] の形で返す（署名 URL 付き）。
 * 行が無ければ空配列（非 nvms 店舗では何も変わらない）。
 */
export async function fetchGridShotReportClips(
  svc: SupabaseClient,
  eventId: string,
  alertIssuedAt: string,
  signedTtlSec: number,
): Promise<BcpReportProps['clips']> {
  const { data } = await svc
    .from('bcp_grid_shots')
    .select('id, folder_path, page_no, channels, offset_min, storage_path, upload_status, dark_channels')
    .eq('event_id', eventId)
    .order('page_no', { ascending: true })
    .order('offset_min', { ascending: true })
  const rows = (data ?? []) as GridShotRow[]
  if (rows.length === 0) return []

  const alertMs = new Date(alertIssuedAt).getTime()
  return Promise.all(rows.map(async (r) => {
    let url: string | undefined
    if (r.upload_status === 'completed' && r.storage_path) {
      const { data: signed } = await svc.storage
        .from('bcp-clips')
        .createSignedUrl(r.storage_path, signedTtlSec)
      url = signed?.signedUrl
    }
    const target = new Date(alertMs + r.offset_min * 60_000).toISOString()
    return {
      id:           r.id,
      cameraName:   gridShotCameraName(r.folder_path, r.page_no),
      clipFrom:     target,
      clipTo:       target,
      durationSec:  0,
      clipUrl:      url,
      uploadStatus: r.upload_status,
      offsetMin:    r.offset_min,
      note:         gridShotNote(r.dark_channels),
    }
  }))
}
