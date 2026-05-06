import { notFound } from 'next/navigation'
import { validateQrToken } from '@/lib/qr/validate'
import { ReceptionContent } from './reception-content'

interface Props {
  params: Promise<{ token: string }>
  searchParams: Promise<{ pre?: string }>
}

export default async function ReceptionPage({ params, searchParams }: Props) {
  const { token } = await params
  const { pre } = await searchParams
  const result = await validateQrToken(token)

  // Invalid or revoked QR token → HTTP 404
  if (!result.valid) {
    notFound()
  }

  return (
    <ReceptionContent
      token={token}
      storeName={result.storeName!}
      areaName={result.areaName!}
      preToken={pre}
    />
  )
}
