import Link from 'next/link'

/**
 * super_admin が操作中テナント未選択のときにモニター各画面へ出すゲート。
 * テナントを跨いだ閲覧をさせないため、データの代わりにこれを表示して選択を促す。
 */
export function TenantGate() {
  return (
    <div className="flex flex-1 items-center justify-center px-5 py-16">
      <div className="max-w-md space-y-3 rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
        <p className="text-base font-bold text-slate-900">テナントを選択してください</p>
        <p>
          操作中テナントが未選択です。各テナントの店舗・巡回・発報・検査・死活監視は、
          そのテナントを選択してから閲覧・編集できます。
        </p>
        <p>
          <Link href="/admin/tenants" className="inline-block rounded bg-[#2C4A7E] px-4 py-1.5 font-medium text-white hover:opacity-90">
            運営管理 → テナントを選ぶ
          </Link>
        </p>
        <p className="text-xs text-slate-400">テナント一覧で「このテナントを操作」を押すと、以降の画面がそのテナントに固定されます。</p>
      </div>
    </div>
  )
}
