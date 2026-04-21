import { AdminTopNav } from './admin-topnav'
import { AdminContentWrapper } from './admin-content-wrapper'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f0f2f5]">
      <AdminTopNav />
      <AdminContentWrapper>{children}</AdminContentWrapper>
    </div>
  )
}
