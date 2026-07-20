/**
 * /baggage/settings — 手荷物検査の設定は /admin/baggage に集約したためリダイレクト。
 * （店舗別の有効化・カメラ選択も含め、全店舗を1画面で管理する）
 */
import { redirect } from 'next/navigation'

export default function BaggageSettingsRedirect() {
  redirect('/admin/baggage')
}
