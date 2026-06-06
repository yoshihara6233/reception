/**
 * F49.J: NVR 機種マスタ 編集ページ
 */
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer } from '@/lib/supabase/server'
import type { NvrModelsRow } from '@/lib/supabase/db-types'
import { updateNvrModelAndBack } from './actions'

export default async function EditNvrModelPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supa = await createSupabaseServer()
  const { data } = await supa.from('nvr_models').select('*').eq('id', id).single()
  if (!data) notFound()
  const m = data as unknown as NvrModelsRow

  return (
    <AdminShell pathname="/admin/nvr-models" section="admin">
      <PageHeader
        title={`NVR 機種編集: ${m.model_number}`}
        crumb={[
          { href: '/admin',            label: '設定' },
          { href: '/admin/nvr-models', label: 'NVR 機種' },
          { href: `/admin/nvr-models/${id}`, label: m.model_number },
        ]}
      />

      <form action={updateNvrModelAndBack} className="max-w-2xl space-y-4 px-5 py-5">
        <input type="hidden" name="id" value={m.id} />

        {/* 読み取り専用フィールド */}
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs dark:border-slate-700 dark:bg-slate-900">
          <div>
            <label className="text-slate-500">ベンダー</label>
            <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{m.vendor}</div>
          </div>
          <div>
            <label className="text-slate-500">機種番号</label>
            <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{m.model_number}</div>
          </div>
          <div>
            <label className="text-slate-500">機種ファミリ</label>
            <div className="font-mono text-slate-700 dark:text-slate-200">{m.model_family}</div>
          </div>
          <div>
            <label className="text-slate-500">作成日</label>
            <div className="font-mono text-slate-700 dark:text-slate-200">{m.created_at.slice(0, 10)}</div>
          </div>
        </div>

        {/* 編集可能フィールド */}
        <div className="space-y-3">
          <Field label="表示名" name="display_name" defaultValue={m.display_name} required />

          <div className="grid grid-cols-3 gap-3">
            <Field label="発売日" name="released_at" type="date" defaultValue={m.released_at ?? ''} />
            <Field label="EOL (生産終了)" name="eol_date" type="date" defaultValue={m.eol_date ?? ''} />
            <Field label="EOS (サポート終了)" name="eos_date" type="date" defaultValue={m.eos_date ?? ''} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="最大チャンネル数" name="max_channels" type="number" defaultValue={String(m.max_channels ?? '')} />
            <Field label="最大解像度" name="max_resolution" defaultValue={m.max_resolution ?? ''} placeholder="4K / 1080p / 720p / D1" />
          </div>

          <Field label="公式情報源 URL" name="source_url" defaultValue={m.source_url ?? ''} placeholder="https://i-pro.com/..." />

          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">備考</label>
            <textarea
              name="notes"
              defaultValue={m.notes ?? ''}
              rows={3}
              className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            className="rounded bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            💾 保存
          </button>
          <Link
            href="/admin/nvr-models"
            className="rounded border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            キャンセル
          </Link>
        </div>
      </form>
    </AdminShell>
  )
}

function Field({
  label, name, type = 'text', defaultValue, placeholder, required,
}: {
  label: string; name: string; type?: string; defaultValue?: string; placeholder?: string; required?: boolean
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
        {label}{required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className="mt-1 block w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      />
    </label>
  )
}
