import { AdminSidebar } from './admin-sidebar'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f0f2f5] flex">
      <AdminSidebar />

      {/* Main content */}
      <main className="ml-64 flex-1 p-8">
        {children}
      </main>
    </div>
  )
}
