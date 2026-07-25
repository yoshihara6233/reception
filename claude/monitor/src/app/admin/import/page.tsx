import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { ImportForm } from './import-form'
import { getT } from '@/lib/i18n/server'

export default async function ImportPage() {
  const t = await getT()
  return (
    <AdminShell pathname="/admin/import" section="admin">
      <PageHeader
        title={t.adminImport.title}
        crumb={[{ href: '/admin', label: t.breadcrumb.admin }, { href: '/admin/import', label: t.adminImport.title }]}
      />
      <div className="grid max-w-5xl grid-cols-2 gap-5 px-5 py-5">
        <ImportForm
          kind="stores"
          title="店舗 (stores)"
          endpoint="/api/admin/import/stores"
          help={
            <ul className="list-disc pl-4">
              <li><b>必須列:</b> <code>name</code></li>
              <li><b>任意列:</b> <code>address, area_code, latitude, longitude, timezone, tenant_id, external_id, opt_patrol, opt_alarm, opt_baggage</code></li>
              <li><code>external_id</code>（既存 UUID）一致時は更新、なければ新規作成</li>
              <li>緯度経度を空にすると後でジオコーディング</li>
              <li><code>opt_patrol / opt_alarm / opt_baggage</code>：巡回/発報/検査の ON/OFF（<code>true</code>/<code>false</code>・空=OFF）。列を付けた行だけ反映。ON はテナント契約済み＋上限内が必要（超過行は失敗）</li>
            </ul>
          }
          example={`name,address,area_code,latitude,longitude,opt_patrol,opt_alarm,opt_baggage\n渋谷南店,東京都渋谷区道玄坂1-2-3,KANTO,35.658,139.701,true,true,false\n大阪梅田店,大阪府大阪市北区梅田1-1-3,KANSAI,34.703,135.498,false,false,true`}
        />
        <ImportForm
          kind="cameras"
          title="カメラ (recorder_cameras)"
          endpoint="/api/admin/import/cameras"
          help={
            <ul className="list-disc pl-4">
              <li><b>必須列:</b> <code>recorder_id, channel, grid_pos</code></li>
              <li><b>任意列:</b> <code>name, enabled</code></li>
              <li><code>(recorder_id, channel)</code> でアップサート</li>
              <li><code>grid_pos</code> は 0〜15（16分割の位置）</li>
            </ul>
          }
          example={`recorder_id,channel,name,grid_pos,enabled\n<uuid>,1,入口,0,true\n<uuid>,2,店頭,1,true`}
        />
      </div>
    </AdminShell>
  )
}
