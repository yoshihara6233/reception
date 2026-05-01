'use client'

import { createContext, useContext } from 'react'

export interface AdminAccess {
  role: string
  storeIds: string[]
  authenticated: boolean
  name: string
  email: string
}

const Ctx = createContext<AdminAccess>({
  role: 'tenant_admin',
  storeIds: [],
  authenticated: false,
  name: '',
  email: '',
})

export function AdminAccessProvider({
  value,
  children,
}: {
  value: AdminAccess
  children: React.ReactNode
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAdminAccess(): AdminAccess {
  return useContext(Ctx)
}
