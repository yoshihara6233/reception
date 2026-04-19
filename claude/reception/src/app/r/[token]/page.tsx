import { validateQrToken } from '@/lib/qr/validate'
import { ReceptionContent } from './reception-content'

interface Props {
  params: Promise<{ token: string }>
}

export default async function ReceptionPage({ params }: Props) {
  const { token } = await params
  const result = await validateQrToken(token)

  if (!result.valid) {
    return (
      <div className="min-h-screen bg-[#f0f2f5] flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center max-w-sm">
          <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">&#x26A0;</span>
          </div>
          <h1 className="text-lg font-semibold text-[#1e3a5f] mb-2">無効なQRコード / Invalid QR</h1>
          <p className="text-sm text-gray-500">{result.error}</p>
        </div>
      </div>
    )
  }

  return (
    <ReceptionContent
      token={token}
      storeName={result.storeName!}
      areaName={result.areaName!}
    />
  )
}
