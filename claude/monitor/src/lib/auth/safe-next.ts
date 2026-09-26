/**
 * ログイン後の戻り先。**G・VMS の拠点へのログイン (OAuth の同意画面) だけを許す** —
 * 任意の next を通すと、ログイン画面が外のサイトへの踏み台になる (open redirect)。
 */
export function safeNext(next: string | null): string {
  if (next && /^\/oauth\/consent\?authorization_id=[A-Za-z0-9_-]{1,128}$/.test(next)) return next
  return '/stores'
}
