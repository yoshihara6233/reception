/**
 * /admin/visits/[id]/evidence
 *
 * 入退室エビデンスレポート — 印刷/PDF保存用ページ。
 * ブラウザの「印刷 → PDFとして保存」で1枚のPDFになる。
 * 警察・本部報告・社内調査用途。
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import EvidencePrintTrigger from './EvidencePrintTrigger'

interface Props {
  params: Promise<{ id: string }>
}

async function makeSignedUrl(
  supabase: ReturnType<typeof createAdminClient>,
  path: string | null
): Promise<string | null> {
  if (!path) return null
  const { data } = await supabase.storage.from('visit-photos').createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default async function EvidencePage({ params }: Props) {
  const { id } = await params
  const supabase = createAdminClient()

  const { data: visit } = await supabase
    .from('visits')
    .select(`
      *,
      visitors(*),
      stores(name),
      areas(name),
      visit_photos(*),
      baggage_declarations(
        id, context, inspection_mode, declaration_text, status,
        photo_path_contents, photo_path_empty, staff_notes, reviewed_at,
        vms_inspection_id, vms_hls_url, inspection_started_at, inspection_ended_at,
        created_at
      )
    `)
    .eq('id', id)
    .single()

  if (!visit) notFound()

  const visitor = visit.visitors as any
  const store   = visit.stores as any
  const area    = visit.areas  as any
  const photos  = (visit.visit_photos as any[]) || []
  const decls   = (visit.baggage_declarations as any[]) || []

  // 顔写真・名刺の signed URL
  const facePhoto = photos.find((p: any) => p.type === 'face')
  const cardPhoto = photos.find((p: any) => p.type === 'card')
  const faceUrl   = await makeSignedUrl(supabase, facePhoto?.storage_path ?? null)
  const cardUrl   = await makeSignedUrl(supabase, cardPhoto?.storage_path ?? null)

  // 手荷物申告（入室・退室）の signed URL
  const checkin  = decls.find((d: any) => d.context === 'checkin')
  const checkout = decls.find((d: any) => d.context === 'checkout')

  const [ciContents, ciEmpty, coContents, coEmpty] = await Promise.all([
    makeSignedUrl(supabase, checkin?.photo_path_contents  ?? null),
    makeSignedUrl(supabase, checkin?.photo_path_empty     ?? null),
    makeSignedUrl(supabase, checkout?.photo_path_contents ?? null),
    makeSignedUrl(supabase, checkout?.photo_path_empty    ?? null),
  ])

  const generatedAt = new Date().toLocaleString('ja-JP')
  const reportNo    = `RCP-${id.slice(0, 8).toUpperCase()}`

  return (
    <>
      <EvidencePrintTrigger />
      <style>{`
        @media print {
          @page { size: A4; margin: 15mm 12mm; }
          body { font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
        }
        body { font-family: 'Hiragino Sans', 'Noto Sans JP', sans-serif; }
      `}</style>

      {/* 印刷アクションバー（画面のみ） */}
      <div className="no-print fixed top-0 left-0 right-0 z-50 bg-[#0f1a2e] text-white px-6 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold">🔒 入退室エビデンスレポート</span>
          <span className="text-xs text-white/50">{reportNo}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-white text-[#0f1a2e] text-sm font-bold rounded-lg hover:bg-white/90 transition-colors"
          >
            🖨️ PDFとして保存
          </button>
          <button
            onClick={() => window.close()}
            className="px-3 py-2 border border-white/20 text-white/70 text-sm rounded-lg hover:border-white/40"
          >
            閉じる
          </button>
        </div>
      </div>

      {/* レポート本体 */}
      <div className="bg-white min-h-screen pt-16 print:pt-0">
        <div className="max-w-3xl mx-auto px-8 py-6 print:px-0 print:py-0">

          {/* ヘッダー */}
          <div className="border-b-2 border-[#0f1a2e] pb-4 mb-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-widest mb-1">
                  Reception Kiosk — 入退室エビデンスレポート
                </p>
                <h1 className="text-2xl font-bold text-[#0f1a2e]">
                  入退室記録 / 手荷物検査記録
                </h1>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">レポート番号</p>
                <p className="text-sm font-mono font-bold text-[#0f1a2e]">{reportNo}</p>
                <p className="text-[10px] text-gray-400 mt-1">出力: {generatedAt}</p>
              </div>
            </div>
          </div>

          {/* 来訪者情報 */}
          <section className="mb-6">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-4 h-0.5 bg-gray-300 inline-block"></span>
              来訪者情報
            </h2>
            <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
              <InfoItem label="氏名"   value={visitor?.name ?? '—'} bold />
              <InfoItem label="会社名" value={visitor?.company ?? '—'} bold />
              <InfoItem label="部署"   value={visitor?.department ?? '—'} />
              <InfoItem label="電話"   value={visitor?.phone ?? '—'} />
              <InfoItem label="メール" value={visitor?.email ?? '—'} />
            </div>
          </section>

          {/* 入退室情報 */}
          <section className="mb-6">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-4 h-0.5 bg-gray-300 inline-block"></span>
              入退室情報
            </h2>
            <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
              <InfoItem label="店舗"     value={store?.name ?? '—'} />
              <InfoItem label="エリア"   value={area?.name  ?? '—'} />
              <InfoItem label="来訪目的" value={visit.purpose ?? '—'} />
              <InfoItem
                label="ステータス"
                value={visit.status === 'checked_in' ? '入室中' :
                       visit.status === 'checked_out' ? 'チェックアウト済み' :
                       visit.status === 'auto_closed' ? '自動クローズ' : visit.status}
              />
              <InfoItem label="入室時刻" value={fmt(visit.check_in_at)}  bold />
              <InfoItem label="退室時刻" value={fmt(visit.check_out_at)} bold />
            </div>
          </section>

          {/* 手荷物検査 — 入室 */}
          {checkin && (
            <section className="mb-6 border border-blue-100 rounded-xl p-4">
              <h2 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-3">
                📥 手荷物検査（入室時）
              </h2>
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <InfoItem label="申告日時"  value={fmt(checkin.created_at)} />
                <InfoItem label="検査方式"  value={checkin.inspection_mode === 'video' ? '映像録画' : '写真撮影'} />
                <InfoItem label="審査状況"
                  value={checkin.status === 'approved' ? '✅ 承認済み' :
                         checkin.status === 'flagged'  ? '🚨 フラグあり' : '⏳ 審査待ち'} />
                <InfoItem label="申告内容"  value={checkin.declaration_text || '（記載なし）'} />
                {checkin.staff_notes && <InfoItem label="スタッフメモ" value={checkin.staff_notes} />}
                {checkin.reviewed_at && <InfoItem label="審査完了日時" value={fmt(checkin.reviewed_at)} />}
              </div>
              {(ciContents || ciEmpty) && (
                <div className="grid grid-cols-2 gap-3">
                  <PhotoBox label="中身写真（持ち込み物）" url={ciContents} />
                  <PhotoBox label="空カバン写真"           url={ciEmpty}    />
                </div>
              )}
              {checkin.inspection_mode === 'video' && checkin.vms_inspection_id && (
                <div className="mt-3 p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
                  🎥 映像記録あり — 検査ID: {checkin.vms_inspection_id}
                  {checkin.inspection_started_at && ` / 開始: ${fmt(checkin.inspection_started_at)}`}
                  {checkin.inspection_ended_at   && ` / 終了: ${fmt(checkin.inspection_ended_at)}`}
                </div>
              )}
            </section>
          )}

          {/* 手荷物検査 — 退室 */}
          {checkout && (
            <section className="mb-6 border border-orange-100 rounded-xl p-4">
              <h2 className="text-xs font-bold text-orange-600 uppercase tracking-wider mb-3">
                📤 手荷物検査（退室時）
              </h2>
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <InfoItem label="申告日時"  value={fmt(checkout.created_at)} />
                <InfoItem label="検査方式"  value={checkout.inspection_mode === 'video' ? '映像録画' : '写真撮影'} />
                <InfoItem label="審査状況"
                  value={checkout.status === 'approved' ? '✅ 承認済み' :
                         checkout.status === 'flagged'  ? '🚨 フラグあり' : '⏳ 審査待ち'} />
                <InfoItem label="申告内容"  value={checkout.declaration_text || '（記載なし）'} />
                {checkout.staff_notes && <InfoItem label="スタッフメモ" value={checkout.staff_notes} />}
                {checkout.reviewed_at && <InfoItem label="審査完了日時" value={fmt(checkout.reviewed_at)} />}
              </div>
              {(coContents || coEmpty) && (
                <div className="grid grid-cols-2 gap-3">
                  <PhotoBox label="中身写真（持ち出し物）" url={coContents} />
                  <PhotoBox label="空カバン写真"           url={coEmpty}    />
                </div>
              )}
              {checkout.inspection_mode === 'video' && checkout.vms_inspection_id && (
                <div className="mt-3 p-3 bg-orange-50 rounded-lg text-xs text-orange-700">
                  🎥 映像記録あり — 検査ID: {checkout.vms_inspection_id}
                  {checkout.inspection_started_at && ` / 開始: ${fmt(checkout.inspection_started_at)}`}
                  {checkout.inspection_ended_at   && ` / 終了: ${fmt(checkout.inspection_ended_at)}`}
                </div>
              )}
            </section>
          )}

          {/* 来訪者写真 */}
          {(faceUrl || cardUrl) && (
            <section className="mb-6">
              <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="w-4 h-0.5 bg-gray-300 inline-block"></span>
                来訪者写真
              </h2>
              <div className="grid grid-cols-2 gap-4">
                {faceUrl && <PhotoBox label="顔写真"    url={faceUrl} tall />}
                {cardUrl && <PhotoBox label="名刺・身分証" url={cardUrl} />}
              </div>
            </section>
          )}

          {/* フッター */}
          <div className="border-t border-gray-200 pt-4 mt-8">
            <div className="grid grid-cols-3 gap-4 text-[10px] text-gray-400">
              <div>
                <p className="font-semibold text-gray-600 mb-1">出力情報</p>
                <p>出力日時: {generatedAt}</p>
                <p>レポート番号: {reportNo}</p>
              </div>
              <div>
                <p className="font-semibold text-gray-600 mb-1">記録保全</p>
                <p>本レポートは Reception Kiosk が</p>
                <p>自動生成した入退室記録です。</p>
              </div>
              <div>
                <p className="font-semibold text-gray-600 mb-1">注意事項</p>
                <p>個人情報を含みます。</p>
                <p>取り扱いに注意してください。</p>
              </div>
            </div>

            {/* 署名欄 */}
            <div className="mt-6 grid grid-cols-3 gap-4">
              {['作成者', '確認者', '承認者'].map(role => (
                <div key={role} className="border border-gray-200 rounded-lg p-3">
                  <p className="text-[10px] text-gray-400 mb-8">{role}</p>
                  <div className="border-b border-gray-200"></div>
                  <p className="text-[9px] text-gray-300 mt-1">氏名・日付</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </>
  )
}

// ── 小コンポーネント ─────────────────────────────────────────────────────────

function InfoItem({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] text-gray-400 mb-0.5">{label}</dt>
      <dd className={`text-gray-800 ${bold ? 'font-semibold' : ''}`}>{value}</dd>
    </div>
  )
}

function PhotoBox({ label, url, tall }: { label: string; url: string | null; tall?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-gray-400 mb-1">{label}</p>
      <div className={`rounded-lg overflow-hidden bg-gray-100 border border-gray-200 ${tall ? 'aspect-[3/4]' : 'aspect-[4/3]'} relative`}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-300 text-sm">
            写真なし
          </div>
        )}
      </div>
    </div>
  )
}
