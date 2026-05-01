/**
 * /admin/stores/qr-print?name=xxx&url=https://...
 * 印刷専用ページ: ポップアップ不要、Safari 互換
 * qrcode npm パッケージでサーバーサイド SVG 生成
 */
import { generateQrSvg } from '@/lib/qr/generate'
import { PrintButton } from './PrintButton'

interface Props {
  searchParams: Promise<{ name?: string; url?: string }>
}

export default async function QrPrintPage({ searchParams }: Props) {
  const { name = 'QR Code', url = '' } = await searchParams

  const svgString = url ? await generateQrSvg(url) : null

  return (
    <>
      <style>{`
        @media print {
          /* 印刷時: ナビゲーションバーなど管理画面UIを非表示 */
          body > *:not(#qr-print-root) { display: none !important; }
          #qr-print-root .print-hide { display: none !important; }
        }
      `}</style>

      <div
        id="qr-print-root"
        className="flex flex-col items-center justify-center min-h-screen bg-white text-center px-8 py-12"
      >
        <h1 className="text-2xl font-bold text-[var(--ge-accent)] mb-2">{name}</h1>
        <p className="text-sm text-gray-400 mb-8">QRコード</p>

        {svgString ? (
          <div
            className="border-2 border-gray-100 rounded-2xl p-5 inline-block bg-white mb-6"
            dangerouslySetInnerHTML={{ __html: svgString }}
          />
        ) : (
          <div className="border-2 border-gray-100 rounded-2xl p-5 w-64 h-64 flex items-center justify-center text-gray-400 text-sm mb-6">
            URLが指定されていません
          </div>
        )}

        {url && (
          <p className="text-[11px] text-gray-300 break-all max-w-xs mb-8">{url}</p>
        )}

        <PrintButton />
      </div>
    </>
  )
}
