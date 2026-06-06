/**
 * /bcp/test — テストアラート発令
 *
 * 郵便番号または座標から半径を指定し、範囲内の全店舗に対して
 * BCP フローをトリガーする（is_test=true）。
 */
import Link from 'next/link'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { TestForm } from './test-form'
import { getT } from '@/lib/i18n/server'

export default async function BcpTestPage() {
  const t = await getT()
  const tt = t.bcpTest
  return (
    <AdminShell pathname="/bcp/test" section="bcp">
      <PageHeader
        title={tt.title}
        crumb={[
          { href: '/bcp', label: t.breadcrumb.bcp },
          { href: '/bcp/test', label: tt.crumb },
        ]}
      />

      <div className="px-5 py-5">
        <TestForm />

        <div className="mt-8 border-t border-slate-200 pt-5">
          <Link href="/bcp" className="text-xs text-slate-500 hover:underline">
            {tt.backLink}
          </Link>
        </div>
      </div>
    </AdminShell>
  )
}
