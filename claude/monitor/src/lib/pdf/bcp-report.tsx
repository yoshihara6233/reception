/**
 * BCP Incident Report PDF template.
 *
 * F64: Japanese font support + photo grid
 *   - Registers Noto Sans JP from jsdelivr CDN so Japanese characters render
 *     correctly instead of garbled boxes.
 *   - Adds an 8-snapshot photo grid section below the metadata table so the
 *     PDF includes the actual JPEG timeline (the whole point of BCP reports).
 */

import {
  Document,
  Page,
  Text,
  View,
  Image,
  Font,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer'
import { jmaIntensityLabel } from '@/lib/bcp/intensity'

// ---------------------------------------------------------------------------
// Font registration (Japanese support)
// ---------------------------------------------------------------------------
//
// @react-pdf/renderer ships only Helvetica which cannot render Japanese.
// We register Noto Sans JP (the open-source Japanese font Google funds) from
// a CDN mirror. OTF / TTF formats are accepted; WOFF/WOFF2 are not.
//
// If this CDN URL stops working, fall back to bundling the font file in
// `claude/monitor/public/fonts/NotoSansJP-Regular.otf` and using:
//   src: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3100'}/fonts/NotoSansJP-Regular.otf`

let _fontRegistered = false
function ensureFontRegistered() {
  if (_fontRegistered) return
  _fontRegistered = true
  // Type cast: Font.register supports a `fonts` array with multiple weights,
  // and registerHyphenationCallback exists at runtime, but the bundled type
  // definitions are from v3 and don't reflect v4 capabilities.
  const FontAny = Font as unknown as {
    register: (config: { family: string; fonts: Array<{ src: string; fontWeight?: string }> }) => void
    registerHyphenationCallback: (cb: (word: string) => string[]) => void
  }
  FontAny.register({
    family: 'NotoSansJP',
    fonts: [
      {
        src: 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf',
        fontWeight: 'normal',
      },
      {
        src: 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/JP/NotoSansJP-Bold.otf',
        fontWeight: 'bold',
      },
    ],
  })
  // Disable hyphenation — Japanese doesn't use it and react-pdf's default
  // would split words at random points.
  FontAny.registerHyphenationCallback((word: string) => [word])
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BcpReportProps {
  event: {
    id: string
    alertType: string
    alertIssuedAt: string // ISO string
    areaCode: string
    /** JMA MaxInt 生値（'3','5-' 等）。地震以外・不明は null/省略 */
    maxIntensity?: string | null
    status: string
    isTest: boolean
  }
  store: {
    name: string
    address?: string
  }
  clips: Array<{
    id: string
    cameraName: string
    clipFrom: string    // ISO string
    clipTo: string      // ISO string
    durationSec: number
    clipUrl?: string
    uploadStatus: string
    /** F40 offset minutes (-5, 0, 5, 10, 15, 20, 25, 30). Null for legacy. */
    offsetMin?: number | null
  }>
  generatedAt: string // ISO string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatJst(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '-'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}分${s}秒` : `${s}秒`
}

function uploadStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending:       '待機中',
    uploading:     'アップロード中',
    completed:     '完了',
    failed:        '失敗',
    skipped_ipro:  'スキップ(IPRO)',
  }
  return map[status] ?? status
}

/** F40 offset label ("5分前" / "発生時" / "5分後" / ... / "30分後"). */
function offsetLabel(min: number | null | undefined): string {
  if (min === null || min === undefined) return ''
  if (min === 0) return '発生時'
  if (min < 0) return `${Math.abs(min)}分前`
  return `${min}分後`
}

const C = {
  primary:    '#1e3a8a',
  accent:     '#dc2626',
  success:    '#15803d',
  textDark:   '#1f2937',
  textMid:    '#4b5563',
  textLight:  '#9ca3af',
  border:     '#e5e7eb',
  labelBg:    '#f3f4f6',
  rowEven:    '#ffffff',
  rowOdd:     '#f9fafb',
  testBanner: '#fffbeb',
  testBorder: '#fcd34d',
  imageBg:    '#000000',
  imageBorder: '#d1d5db',
}

const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 9,
    color: C.textDark,
    paddingTop: 36,
    paddingBottom: 44,
    paddingHorizontal: 36,
    backgroundColor: '#ffffff',
  },

  // --- Header ---
  header: {
    marginBottom: 18,
    borderBottomWidth: 2,
    borderBottomColor: C.primary,
    paddingBottom: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: C.primary,
    marginBottom: 2,
  },
  headerSubtitle: {
    fontSize: 9,
    color: C.textLight,
  },
  testBanner: {
    backgroundColor: C.testBanner,
    borderWidth: 1,
    borderColor: C.testBorder,
    borderRadius: 3,
    padding: 6,
    marginBottom: 10,
  },
  testBannerText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#7d5a00',
    textAlign: 'center',
  },

  // --- Section ---
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: C.primary,
    backgroundColor: C.labelBg,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginBottom: 6,
    borderLeftWidth: 3,
    borderLeftColor: C.primary,
  },

  // --- Info grid ---
  infoRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  infoLabel: {
    width: 120,
    backgroundColor: C.labelBg,
    fontWeight: 'bold',
    fontSize: 8,
    color: C.textMid,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  infoValue: {
    flex: 1,
    fontSize: 8,
    color: C.textDark,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },

  // --- Table ---
  table: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 2,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: C.primary,
  },
  tableHeaderCell: {
    fontWeight: 'bold',
    fontSize: 7,
    color: '#ffffff',
    paddingVertical: 5,
    paddingHorizontal: 6,
    flex: 1,
  },
  tableRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  tableCell: {
    fontSize: 7,
    paddingVertical: 4,
    paddingHorizontal: 6,
    flex: 1,
    color: C.textDark,
  },
  tableCellWide: {
    fontSize: 7,
    paddingVertical: 4,
    paddingHorizontal: 6,
    flex: 2,
    color: C.textDark,
  },

  // --- Status badge ---
  statusCompleted: { color: C.success },
  statusFailed:    { color: C.accent  },

  // --- Image grid (F64) ---
  // カメラごとに 1 グループ（見出し + 4 columns × 2 rows）。
  cameraGroup: {
    marginBottom: 8,
  },
  cameraHeading: {
    fontSize: 8,
    fontWeight: 'bold',
    color: C.textDark,
    backgroundColor: C.labelBg,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginBottom: 3,
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  imageCell: {
    width: '24%',          // 4 per row with small gaps
    marginBottom: 6,
  },
  imageCaption: {
    fontSize: 7,
    fontWeight: 'bold',
    color: C.textMid,
    textAlign: 'center',
    paddingBottom: 2,
  },
  imageTimestamp: {
    fontSize: 6,
    color: C.textLight,
    textAlign: 'center',
    paddingTop: 1,
  },
  imageBox: {
    aspectRatio: 16 / 9,
    backgroundColor: C.imageBg,
    borderWidth: 1,
    borderColor: C.imageBorder,
  },
  imageEmpty: {
    aspectRatio: 16 / 9,
    backgroundColor: C.labelBg,
    borderWidth: 1,
    borderColor: C.imageBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageEmptyText: {
    fontSize: 7,
    color: C.textLight,
  },

  // --- Footer ---
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 7,
    color: C.textLight,
  },

  // --- Misc ---
  noClips: {
    fontSize: 8,
    color: C.textLight,
    textAlign: 'center',
    paddingVertical: 12,
  },
})

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BcpReport({ event, store, clips, generatedAt }: BcpReportProps) {
  const pageTitle =
    'BCP ' + (event.isTest ? '[TEST] ' : '') + 'インシデントレポート'

  // カメラ別 → オフセット順で並べる（複数カメラの写真が混在してバラバラに
  // 見えないよう、画面のタイムラインと同じ「カメラごとに 1 段」の構成にする）
  const sortedClips = [...clips].sort((a, b) => {
    const cam = a.cameraName.localeCompare(b.cameraName, 'ja')
    if (cam !== 0) return cam
    return (a.offsetMin ?? 999) - (b.offsetMin ?? 999)
  })
  const cameraGroups: { cameraName: string; clips: typeof sortedClips }[] = []
  for (const clip of sortedClips) {
    const last = cameraGroups[cameraGroups.length - 1]
    if (last && last.cameraName === clip.cameraName) last.clips.push(clip)
    else cameraGroups.push({ cameraName: clip.cameraName, clips: [clip] })
  }

  return (
    <Document title={pageTitle} author="Intereco BCP System">
      <Page size="A4" style={styles.page}>

        {/* Test banner */}
        {event.isTest && (
          <View style={styles.testBanner}>
            <Text style={styles.testBannerText}>
              *** これはテスト用インシデントレポートです / THIS IS A TEST REPORT ***
            </Text>
          </View>
        )}

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            BCP{event.isTest ? ' [TEST]' : ''} インシデントレポート
          </Text>
          <Text style={styles.headerSubtitle}>
            Intereco BCP Incident Report  |  Generated: {formatJst(generatedAt)}
          </Text>
        </View>

        {/* Event Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>イベント情報 / Event Information</Text>
          <View style={styles.table}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>店舗名 / Store</Text>
              <Text style={styles.infoValue}>{store.name}</Text>
            </View>
            {store.address ? (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>住所 / Address</Text>
                <Text style={styles.infoValue}>{store.address}</Text>
              </View>
            ) : null}
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>アラート種別 / Alert Type</Text>
              <Text style={styles.infoValue}>{event.alertType}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>震度 / Seismic Intensity</Text>
              <Text style={styles.infoValue}>{jmaIntensityLabel(event.maxIntensity) ?? '-'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>地域コード / Area Code</Text>
              <Text style={styles.infoValue}>{event.areaCode || '-'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>発令日時 / Alert Time</Text>
              <Text style={styles.infoValue}>{formatJst(event.alertIssuedAt)}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>ステータス / Status</Text>
              <Text style={styles.infoValue}>{event.status}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>イベントID / Event ID</Text>
              <Text style={styles.infoValue}>{event.id}</Text>
            </View>
          </View>
        </View>

        {/* Snapshot Timeline — F64 photo grid */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            スナップショット タイムライン / Snapshot Timeline
            {sortedClips.length > 0 ? `  (${sortedClips.length} 枚)` : ''}
          </Text>
          {sortedClips.length === 0 ? (
            <Text style={styles.noClips}>スナップショットがありません / No snapshots recorded</Text>
          ) : (
            cameraGroups.map((group) => (
              <View key={group.cameraName} style={styles.cameraGroup}>
                <Text style={styles.cameraHeading}>
                  カメラ: {group.cameraName}  ({group.clips.length} 枚)
                </Text>
                <View style={styles.imageGrid}>
                  {group.clips.map((clip) => (
                    <View key={clip.id} style={styles.imageCell}>
                      <Text style={styles.imageCaption}>
                        {offsetLabel(clip.offsetMin)}
                      </Text>
                      {clip.clipUrl && clip.uploadStatus === 'completed' ? (
                        // @react-pdf/renderer Image is a PDF primitive, not a DOM <img> — alt does not apply.
                        // eslint-disable-next-line jsx-a11y/alt-text
                        <Image src={clip.clipUrl} style={styles.imageBox} />
                      ) : (
                        <View style={styles.imageEmpty}>
                          <Text style={styles.imageEmptyText}>
                            {uploadStatusLabel(clip.uploadStatus)}
                          </Text>
                        </View>
                      )}
                      <Text style={styles.imageTimestamp}>
                        {formatJst(clip.clipFrom)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}
        </View>

        {/* Clips metadata table */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            録画クリップ一覧 / Recording Clips  ({sortedClips.length} 件)
          </Text>
          {sortedClips.length === 0 ? (
            <Text style={styles.noClips}>クリップがありません / No clips recorded</Text>
          ) : (
            <View style={styles.table}>
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.tableHeaderCell, { flex: 2 }]}>
                  カメラ名 / Camera
                </Text>
                <Text style={styles.tableHeaderCell}>オフセット / Offset</Text>
                <Text style={styles.tableHeaderCell}>撮影時刻 / Time</Text>
                <Text style={styles.tableHeaderCell}>ステータス / Status</Text>
              </View>

              {sortedClips.map((clip, i) => {
                const isCompleted = clip.uploadStatus === 'completed'
                const isFailed    = clip.uploadStatus === 'failed'
                const rowBg = i % 2 === 0 ? C.rowEven : C.rowOdd
                const statusStyle = isCompleted
                  ? styles.statusCompleted
                  : isFailed
                    ? styles.statusFailed
                    : undefined

                return (
                  <View
                    key={clip.id}
                    style={[styles.tableRow, { backgroundColor: rowBg }]}
                  >
                    <Text style={[styles.tableCellWide]}>{clip.cameraName}</Text>
                    <Text style={styles.tableCell}>{offsetLabel(clip.offsetMin)}</Text>
                    <Text style={styles.tableCell}>{formatJst(clip.clipFrom)}</Text>
                    <Text style={[styles.tableCell, statusStyle ?? {}]}>
                      {uploadStatusLabel(clip.uploadStatus)}
                    </Text>
                  </View>
                )
              })}
            </View>
          )}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Intereco BCP System</Text>
          <Text style={styles.footerText}>
            Generated: {formatJst(generatedAt)}
          </Text>
        </View>

      </Page>
    </Document>
  )
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

export async function generateBcpReportPdf(props: BcpReportProps): Promise<Buffer> {
  ensureFontRegistered()
  const element = <BcpReport {...props} />
  const uint8 = await renderToBuffer(element)
  return Buffer.from(uint8)
}
