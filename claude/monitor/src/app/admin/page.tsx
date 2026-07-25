import { redirect } from 'next/navigation'

// 旧ダッシュボードは廃止。中身（構成・稼働カウント／env警告）は
// /admin/reports/usage（利用状況レポート）へ集約した。/admin は互換のため転送。
export default function AdminHome() {
  redirect('/admin/reports/usage')
}
