/**
 * 本番 env 必須チェック（是正5）。
 *
 * CRON_SECRET / ALERT_EMAILS 等は「未設定でも黙ってスキップ」する設計のものが多く、
 * 設定漏れに気づけない（例: ALERT_EMAILS 未設定だとエッジ死活アラートがログのみ）。
 * ここで一覧化し、管理ダッシュボードに欠落を警告表示する。値そのものは絶対に返さない。
 *
 * server-only（process.env 参照）。クライアントへは set/missing の真偽のみ渡すこと。
 */

export interface EnvCheckItem {
  key:      string
  /** true=欠けると機能が止まる／false=推奨（欠けると片肺運用） */
  required: boolean
  set:      boolean
  /** 何に使うか（欠落時に何が起きるか） */
  purpose:  string
}

export function checkCriticalEnv(): EnvCheckItem[] {
  const has = (k: string) => !!process.env[k]?.trim()
  return [
    { key: 'NEXT_PUBLIC_SUPABASE_URL',      required: true,  set: has('NEXT_PUBLIC_SUPABASE_URL'),      purpose: 'Supabase 接続（全機能）' },
    { key: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', required: true,  set: has('NEXT_PUBLIC_SUPABASE_ANON_KEY'), purpose: 'Supabase publishable キー（認証）' },
    { key: 'SUPABASE_SERVICE_ROLE_KEY',     required: true,  set: has('SUPABASE_SERVICE_ROLE_KEY'),     purpose: 'Supabase secret キー（サーバ処理全般）' },
    { key: 'CRON_SECRET',                   required: true,  set: has('CRON_SECRET'),                   purpose: '未設定だと死活監視・PB7再送・クリーンアップの cron が全停止（503）' },
    { key: 'RESEND_API_KEY',                required: true,  set: has('RESEND_API_KEY'),                purpose: '未設定だと発報通知・死活アラート・パスワード再設定のメールが送れない' },
    { key: 'ALERT_EMAILS',                  required: false, set: has('ALERT_EMAILS'),                  purpose: '未設定だとエッジ死活アラートがログのみ（誰にも届かない）' },
    { key: 'ALERT_WEBHOOK_URL',             required: false, set: has('ALERT_WEBHOOK_URL'),             purpose: '運用アラートの第2経路（Slack/Discord 等）。メール見落とし対策に推奨' },
    { key: 'NEXT_PUBLIC_SITE_URL',          required: false, set: has('NEXT_PUBLIC_SITE_URL'),          purpose: '通知メール内リンク・エッジ ingest URL の基点（未設定は既定URLで動作）' },
    // SFU（LiveKit Cloud）ベータ。LIVEKIT_ENABLED='true'＋以下3点が揃うと高画質SFUライブが有効。
    { key: 'LIVEKIT_URL',                   required: false, set: has('LIVEKIT_URL'),                   purpose: 'SFUベータ: LiveKit プロジェクトURL（wss://…）。LIVEKIT_ENABLED=true 時に必須' },
    { key: 'LIVEKIT_API_KEY',               required: false, set: has('LIVEKIT_API_KEY'),               purpose: 'SFUベータ: LiveKit APIキー。token/ingress 発行に必須' },
    { key: 'LIVEKIT_API_SECRET',            required: false, set: has('LIVEKIT_API_SECRET'),            purpose: 'SFUベータ: LiveKit APIシークレット。token/ingress 発行に必須' },
  ]
}

/** 欠落のみ（required→推奨の順）。 */
export function missingCriticalEnv(): EnvCheckItem[] {
  return checkCriticalEnv()
    .filter((i) => !i.set)
    .sort((a, b) => Number(b.required) - Number(a.required))
}
