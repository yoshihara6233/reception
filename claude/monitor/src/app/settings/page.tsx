import { redirect } from 'next/navigation'

/** /settings → /admin へリダイレクト（独立した設定項目なし） */
export default function SettingsPage() {
  redirect('/admin')
}
