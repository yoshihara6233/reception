import React from 'react'
import {
  Document, Page, Text, View, StyleSheet,
} from '@react-pdf/renderer'

// ── 型 ──────────────────────────────────────────────────────────────────────

export interface AuditReportVisit {
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

export interface AuditReportProps {
  storeName: string
  dateFrom: string
  dateTo: string
  visits: AuditReportVisit[]
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
    borderBottomColor: '#7c3aed',
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'NotoSansJP',
    color: '#7c3aed',
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
  // 監査情報バナー
  auditBanner: {
    backgroundColor: '#f5f3ff',
    borderRadius: 6,
    padding: 10,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#7c3aed',
  },
  auditBannerTitle: {
    fontSize: 9,
    fontFamily: 'NotoSansJP',
    color: '#5b21b6',
    marginBottom: 4,
  },
  auditBannerRow: {
    flexDirection: 'row',
    gap: 24,
  },
  auditBannerLabel: {
    fontSize: 8,
    color: '#7c3aed',
  },
  auditBannerValue: {
    fontSize: 8,
    color: '#1a1a1a',
    marginLeft: 4,
  },
  // サマリーカード
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#f5f3ff',
    borderRadius: 6,
    padding: 12,
  },
  summaryLabel: {
    fontSize: 8,
    color: '#7c3aed',
    marginBottom: 4,
  },
  summaryValue: {
    fontSize: 22,
    fontFamily: 'NotoSansJP',
    color: '#5b21b6',
  },
  summaryUnit: {
    fontSize: 10,
    color: '#7c3aed',
    marginLeft: 2,
  },
  // セクションタイトル
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'NotoSansJP',
    color: '#5b21b6',
    marginBottom: 8,
    marginTop: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#7c3aed',
    paddingLeft: 6,
  },
  // テーブル
  table: {
    width: '100%',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#5b21b6',
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
    backgroundColor: '#faf5ff',
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
  // 免責・機密表示
  confidential: {
    fontSize: 7,
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: 8,
  },
})

// ── ユーティリティ ────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
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

// ── 来訪者別集計 ──────────────────────────────────────────────────────────────

function getVisitorSummary(visits: AuditReportVisit[]): Array<{
  name: string
  company: string
  count: number
}> {
  const map: Record<string, { name: string; company: string; count: number }> = {}
  for (const v of visits) {
    const key = `${v.visitor_name}::${v.visitor_company}`
    if (!map[key]) {
      map[key] = { name: v.visitor_name, company: v.visitor_company, count: 0 }
    }
    map[key].count++
  }
  return Object.values(map).sort((a, b) => b.count - a.count)
}

// ── PDF コンポーネント ─────────────────────────────────────────────────────────

export function AuditReportPDF({ storeName, dateFrom, dateTo, visits, generatedAt }: AuditReportProps) {
  const visitorSummary = getVisitorSummary(visits)
  const inRoomCount = visits.filter(v => v.status === 'checked_in').length
  const checkedOutCount = visits.filter(v => v.status !== 'checked_in').length
  const uniqueVisitors = visitorSummary.length

  const subtitle = storeName === 'all' ? '全店舗' : storeName
  const periodLabel = `${formatDate(dateFrom)} 〜 ${formatDate(dateTo)}`

  // 来訪記録テーブルの列定義
  const visitCols = [
    { label: '入室日時', width: '17%' },
    { label: '退室日時', width: '17%' },
    { label: '滞在時間', width: '10%' },
    { label: '氏名', width: '14%' },
    { label: '会社名', width: '18%' },
    { label: '部署', width: '12%' },
    { label: '目的', width: '12%' },
  ]

  // 来訪者別集計テーブルの列定義
  const visitorCols = [
    { label: '氏名', width: '30%' },
    { label: '会社名', width: '50%' },
    { label: '来訪回数', width: '20%' },
  ]

  const ROWS_PER_PAGE = 38

  return (
    <Document>
      {/* ── ページ1: サマリー + 来訪記録先頭 ── */}
      <Page size="A4" style={styles.page}>
        {/* 機密表示 */}
        <Text style={styles.confidential}>【機密】本書類は監査目的のみに使用してください</Text>

        {/* ヘッダー */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>来訪記録 監査レポート</Text>
          <View style={styles.headerMeta}>
            <Text style={styles.headerSub}>{subtitle}</Text>
            <Text style={styles.headerSub}>出力日時: {generatedAt}</Text>
          </View>
        </View>

        {/* 監査情報バナー */}
        <View style={styles.auditBanner}>
          <Text style={styles.auditBannerTitle}>レポート対象情報</Text>
          <View style={styles.auditBannerRow}>
            <View style={{ flexDirection: 'row' }}>
              <Text style={styles.auditBannerLabel}>対象期間:</Text>
              <Text style={styles.auditBannerValue}>{periodLabel}</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Text style={styles.auditBannerLabel}>対象店舗:</Text>
              <Text style={styles.auditBannerValue}>{subtitle}</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Text style={styles.auditBannerLabel}>出力者:</Text>
              <Text style={styles.auditBannerValue}>管理者</Text>
            </View>
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
            <Text style={styles.summaryLabel}>ユニーク来訪者</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
              <Text style={styles.summaryValue}>{uniqueVisitors}</Text>
              <Text style={styles.summaryUnit}>名</Text>
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

        {/* 来訪記録一覧 — 1ページ目の分 */}
        <Text style={styles.sectionTitle}>来訪記録一覧</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            {visitCols.map(c => (
              <View key={c.label} style={{ width: c.width }}>
                <Text style={styles.thCell}>{c.label}</Text>
              </View>
            ))}
          </View>
          {visits.slice(0, ROWS_PER_PAGE).map((v, i) => (
            <View key={v.id} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <View style={{ width: '17%' }}><Text style={styles.tdCell}>{formatDateTime(v.check_in_at)}</Text></View>
              <View style={{ width: '17%' }}><Text style={styles.tdCell}>{formatDateTime(v.check_out_at)}</Text></View>
              <View style={{ width: '10%' }}><Text style={styles.tdCell}>{formatDuration(v.check_in_at, v.check_out_at)}</Text></View>
              <View style={{ width: '14%' }}><Text style={styles.tdCell}>{v.visitor_name}</Text></View>
              <View style={{ width: '18%' }}><Text style={styles.tdCell}>{v.visitor_company}</Text></View>
              <View style={{ width: '12%' }}><Text style={styles.tdCell}>{v.visitor_department || '—'}</Text></View>
              <View style={{ width: '12%' }}><Text style={styles.tdCell}>{v.purpose}</Text></View>
            </View>
          ))}
        </View>

        {/* フッター */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Reception Kiosk — 来訪管理システム / 監査用</Text>
          <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>

      {/* ── 来訪記録の続き (2ページ目以降) ── */}
      {visits.length > ROWS_PER_PAGE && Array.from(
        { length: Math.ceil((visits.length - ROWS_PER_PAGE) / ROWS_PER_PAGE) },
        (_, pageIdx) => {
          const startIdx = ROWS_PER_PAGE + pageIdx * ROWS_PER_PAGE
          const pageVisits = visits.slice(startIdx, startIdx + ROWS_PER_PAGE)
          return (
            <Page key={`visit-${pageIdx}`} size="A4" style={styles.page}>
              <View style={styles.table}>
                <View style={styles.tableHeader}>
                  {visitCols.map(c => (
                    <View key={c.label} style={{ width: c.width }}>
                      <Text style={styles.thCell}>{c.label}</Text>
                    </View>
                  ))}
                </View>
                {pageVisits.map((v, i) => (
                  <View key={v.id} style={(startIdx + i) % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
                    <View style={{ width: '17%' }}><Text style={styles.tdCell}>{formatDateTime(v.check_in_at)}</Text></View>
                    <View style={{ width: '17%' }}><Text style={styles.tdCell}>{formatDateTime(v.check_out_at)}</Text></View>
                    <View style={{ width: '10%' }}><Text style={styles.tdCell}>{formatDuration(v.check_in_at, v.check_out_at)}</Text></View>
                    <View style={{ width: '14%' }}><Text style={styles.tdCell}>{v.visitor_name}</Text></View>
                    <View style={{ width: '18%' }}><Text style={styles.tdCell}>{v.visitor_company}</Text></View>
                    <View style={{ width: '12%' }}><Text style={styles.tdCell}>{v.visitor_department || '—'}</Text></View>
                    <View style={{ width: '12%' }}><Text style={styles.tdCell}>{v.purpose}</Text></View>
                  </View>
                ))}
              </View>

              <View style={styles.footer} fixed>
                <Text style={styles.footerText}>Reception Kiosk — 来訪管理システム / 監査用</Text>
                <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
              </View>
            </Page>
          )
        }
      )}

      {/* ── 最終ページ: 来訪者別集計 ── */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.confidential}>【機密】本書類は監査目的のみに使用してください</Text>

        <View style={styles.header}>
          <Text style={styles.headerTitle}>来訪者別集計</Text>
          <Text style={styles.headerSub}>{periodLabel} / {subtitle}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            {visitorCols.map(c => (
              <View key={c.label} style={{ width: c.width }}>
                <Text style={styles.thCell}>{c.label}</Text>
              </View>
            ))}
          </View>
          {visitorSummary.map((row, i) => (
            <View key={`${row.name}-${row.company}`} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <View style={{ width: '30%' }}><Text style={styles.tdCell}>{row.name}</Text></View>
              <View style={{ width: '50%' }}><Text style={styles.tdCell}>{row.company}</Text></View>
              <View style={{ width: '20%' }}><Text style={styles.tdCell}>{row.count}回</Text></View>
            </View>
          ))}
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Reception Kiosk — 来訪管理システム / 監査用</Text>
          <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
