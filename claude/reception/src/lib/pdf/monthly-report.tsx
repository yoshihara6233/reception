import React from 'react'
import {
  Document, Page, Text, View, StyleSheet,
} from '@react-pdf/renderer'

// ── 型 ──────────────────────────────────────────────────────────────────────

export interface MonthlyReportVisit {
  id: string
  purpose: string
  status: string
  check_in_at: string
  check_out_at: string | null
  visitor_name: string
  visitor_company: string
  visitor_department: string
  store_name: string
}

export interface MonthlyReportProps {
  storeName: string
  year: number
  month: number
  visits: MonthlyReportVisit[]
  generatedAt: string
}

// ── スタイル ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 9,
    color: '#1a1a1a',
    paddingTop: 40,
    paddingBottom: 50,
    paddingHorizontal: 40,
  },
  // ヘッダー
  header: {
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: '#1e3a5f',
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'NotoSansJP',
    color: '#1e3a5f',
    marginBottom: 4,
  },
  headerSub: {
    fontSize: 10,
    color: '#6b7280',
  },
  headerMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  // サマリーカード
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#f0f4f8',
    borderRadius: 6,
    padding: 12,
  },
  summaryLabel: {
    fontSize: 8,
    color: '#6b7280',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 22,
    fontFamily: 'NotoSansJP',
    color: '#1e3a5f',
  },
  summaryUnit: {
    fontSize: 10,
    color: '#6b7280',
    marginLeft: 2,
  },
  // セクションタイトル
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'NotoSansJP',
    color: '#1e3a5f',
    marginBottom: 8,
    marginTop: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#1e3a5f',
    paddingLeft: 6,
  },
  // テーブル
  table: {
    width: '100%',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#1e3a5f',
    borderRadius: 3,
    marginBottom: 1,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tableRowAlt: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  thCell: {
    padding: '5 6',
    fontSize: 8,
    color: '#ffffff',
    fontFamily: 'NotoSansJP',
  },
  tdCell: {
    padding: '4 6',
    fontSize: 8,
    color: '#374151',
  },
  // フッター
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 6,
  },
  footerText: {
    fontSize: 7,
    color: '#9ca3af',
  },
  pageNumber: {
    fontSize: 7,
    color: '#9ca3af',
  },
})

// ── ユーティリティ ────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDuration(checkIn: string, checkOut: string | null): string {
  if (!checkOut) return '在室中'
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime()
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h}時間${m}分` : `${m}分`
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    checked_in: '入室中',
    checked_out: '退室済',
    auto_closed: '自動退室',
  }
  return labels[status] ?? status
}

// ── 目的別集計 ────────────────────────────────────────────────────────────────

function getPurposeSummary(visits: MonthlyReportVisit[]): Array<{ purpose: string; count: number; pct: string }> {
  const map: Record<string, number> = {}
  for (const v of visits) {
    map[v.purpose] = (map[v.purpose] ?? 0) + 1
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([purpose, count]) => ({
      purpose,
      count,
      pct: `${Math.round((count / visits.length) * 100)}%`,
    }))
}

// ── 日次集計 ──────────────────────────────────────────────────────────────────

function getDailySummary(visits: MonthlyReportVisit[], year: number, month: number) {
  const days: Record<string, { total: number; checkedOut: number; inRoom: number }> = {}

  // 月の全日を初期化
  const daysInMonth = new Date(year, month, 0).getDate()
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${String(d).padStart(2, '0')}`
    days[key] = { total: 0, checkedOut: 0, inRoom: 0 }
  }

  for (const v of visits) {
    const d = new Date(v.check_in_at)
    const key = String(d.getDate()).padStart(2, '0')
    if (!days[key]) continue
    days[key].total++
    if (v.status === 'checked_in') days[key].inRoom++
    else days[key].checkedOut++
  }

  return Object.entries(days).map(([day, stat]) => ({ day, ...stat }))
}

// ── PDF コンポーネント ─────────────────────────────────────────────────────────

export function MonthlyReportPDF({ storeName, year, month, visits, generatedAt }: MonthlyReportProps) {
  const purposeSummary = getPurposeSummary(visits)
  const dailySummary = getDailySummary(visits, year, month)
  const inRoomCount = visits.filter(v => v.status === 'checked_in').length
  const checkedOutCount = visits.filter(v => v.status !== 'checked_in').length

  const title = `${year}年${month}月 来訪サマリーレポート`
  const subtitle = storeName === 'all' ? '全店舗' : storeName

  const purposeCols = [
    { label: '来訪目的', width: '50%' },
    { label: '件数', width: '25%' },
    { label: '割合', width: '25%' },
  ]
  const dailyCols = [
    { label: '日', width: '15%' },
    { label: '来訪件数', width: '28%' },
    { label: '退室済', width: '28%' },
    { label: '在室中', width: '29%' },
  ]
  const visitCols = [
    { label: '入室日時', width: '18%' },
    { label: '退室日時', width: '18%' },
    { label: '滞在時間', width: '12%' },
    { label: '氏名', width: '16%' },
    { label: '会社', width: '20%' },
    { label: '目的', width: '16%' },
  ]

  // 来訪一覧を50件ずつページ分割
  const ROWS_PER_PAGE = 40

  return (
    <Document>
      {/* ── ページ1: サマリー ── */}
      <Page size="A4" style={styles.page}>
        {/* ヘッダー */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{title}</Text>
          <View style={styles.headerMeta}>
            <Text style={styles.headerSub}>{subtitle}</Text>
            <Text style={styles.headerSub}>出力日時: {generatedAt}</Text>
          </View>
        </View>

        {/* サマリーカード */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>総来訪件数</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={styles.summaryValue}>{visits.length}</Text>
              <Text style={styles.summaryUnit}>件</Text>
            </View>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>退室済</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={styles.summaryValue}>{checkedOutCount}</Text>
              <Text style={styles.summaryUnit}>件</Text>
            </View>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>在室中</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={styles.summaryValue}>{inRoomCount}</Text>
              <Text style={styles.summaryUnit}>件</Text>
            </View>
          </View>
        </View>

        {/* 来訪目的別 */}
        <Text style={styles.sectionTitle}>来訪目的別内訳</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            {purposeCols.map(c => (
              <View key={c.label} style={{ width: c.width }}>
                <Text style={styles.thCell}>{c.label}</Text>
              </View>
            ))}
          </View>
          {purposeSummary.map((row, i) => (
            <View key={row.purpose} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <View style={{ width: '50%' }}><Text style={styles.tdCell}>{row.purpose}</Text></View>
              <View style={{ width: '25%' }}><Text style={styles.tdCell}>{row.count}</Text></View>
              <View style={{ width: '25%' }}><Text style={styles.tdCell}>{row.pct}</Text></View>
            </View>
          ))}
        </View>

        {/* 日次推移 */}
        <Text style={styles.sectionTitle}>日次来訪件数</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            {dailyCols.map(c => (
              <View key={c.label} style={{ width: c.width }}>
                <Text style={styles.thCell}>{c.label}</Text>
              </View>
            ))}
          </View>
          {dailySummary.map((row, i) => (
            <View key={row.day} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <View style={{ width: '15%' }}><Text style={styles.tdCell}>{row.day}日</Text></View>
              <View style={{ width: '28%' }}><Text style={styles.tdCell}>{row.total > 0 ? row.total : '—'}</Text></View>
              <View style={{ width: '28%' }}><Text style={styles.tdCell}>{row.total > 0 ? row.checkedOut : '—'}</Text></View>
              <View style={{ width: '29%' }}><Text style={styles.tdCell}>{row.total > 0 ? row.inRoom : '—'}</Text></View>
            </View>
          ))}
        </View>

        {/* フッター */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Reception Kiosk — 来訪管理システム</Text>
          <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>

      {/* ── ページ2以降: 来訪記録一覧 ── */}
      {Array.from({ length: Math.ceil(visits.length / ROWS_PER_PAGE) }, (_, pageIdx) => {
        const pageVisits = visits.slice(pageIdx * ROWS_PER_PAGE, (pageIdx + 1) * ROWS_PER_PAGE)
        return (
          <Page key={pageIdx} size="A4" style={styles.page}>
            {pageIdx === 0 && (
              <View style={styles.header}>
                <Text style={styles.headerTitle}>来訪記録一覧</Text>
                <Text style={styles.headerSub}>{title} / {subtitle}</Text>
              </View>
            )}
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                {visitCols.map(c => (
                  <View key={c.label} style={{ width: c.width }}>
                    <Text style={styles.thCell}>{c.label}</Text>
                  </View>
                ))}
              </View>
              {pageVisits.map((v, i) => (
                <View key={v.id} style={(pageIdx * ROWS_PER_PAGE + i) % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                  <View style={{ width: '18%' }}><Text style={styles.tdCell}>{formatDateTime(v.check_in_at)}</Text></View>
                  <View style={{ width: '18%' }}><Text style={styles.tdCell}>{formatDateTime(v.check_out_at)}</Text></View>
                  <View style={{ width: '12%' }}><Text style={styles.tdCell}>{formatDuration(v.check_in_at, v.check_out_at)}</Text></View>
                  <View style={{ width: '16%' }}><Text style={styles.tdCell}>{v.visitor_name}</Text></View>
                  <View style={{ width: '20%' }}><Text style={styles.tdCell}>{v.visitor_company}</Text></View>
                  <View style={{ width: '16%' }}><Text style={styles.tdCell}>{v.purpose}</Text></View>
                </View>
              ))}
            </View>

            <View style={styles.footer} fixed>
              <Text style={styles.footerText}>Reception Kiosk — 来訪管理システム</Text>
              <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
            </View>
          </Page>
        )
      })}
    </Document>
  )
}
