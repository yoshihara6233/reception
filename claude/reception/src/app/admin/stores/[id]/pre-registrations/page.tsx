'use client'

import { useParams } from 'next/navigation'
import { PreRegistrationsContent } from '@/app/admin/pre-registrations/page'

export default function StorePreRegistrationsPage() {
  const { id } = useParams<{ id: string }>()
  return <PreRegistrationsContent lockedStoreId={id} />
}
