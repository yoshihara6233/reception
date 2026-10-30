/**
 * パスワードの禁止語 (2026-10-31・自主診断 ASVS 6.2.11)。G・VMS の internal/auth/password.go と語をそろえる。
 *
 * よく使われるパスワードと漏えいしたパスワードは Supabase Auth が断る (漏えいの照合は 10/30 に有効化)。
 * ここで断るのは、この製品の利用者が思いつきやすい語:
 *   - 製品・会社の名前を含むもの
 *   - 推測されやすい語に数字や記号を足しただけのもの (Admin2026! など)。含むだけで断ると
 *     badminton のような普通の語まで断るので、文字の部分が一致するときだけ断る
 *   - メールアドレスの @ の前を含むもの (4 文字以上のときだけ。短い名前で普通のパスワードまで断らない)
 */
export const PASSWORD_CONTEXT_WORDS = ['gvms', 'g-vms', 'nvms', 'genesis', 'intereco'] as const

export const PASSWORD_PLAIN_WORDS = [
  'admin', 'administrator', 'root', 'password', 'passwd', 'user', 'guest', 'operator', 'viewer', 'monitor',
  'camera', 'kamera', 'security', 'video', 'recorder', 'keibi', 'kanshi', 'bouhan', 'bohan',
] as const

function lettersOnly(s: string): string {
  return s.replace(/[^\p{L}]/gu, '')
}

/** 決まりに合わなければ理由 (画面に出す文) を返す。合えば null */
export function passwordProblem(password: string, email?: string | null): string | null {
  const low = password.toLowerCase()
  if (PASSWORD_CONTEXT_WORDS.some((w) => low.includes(w))) {
    return '製品や会社の名前を含むパスワードは使えません。'
  }
  const letters = lettersOnly(low)
  if ((PASSWORD_PLAIN_WORDS as readonly string[]).includes(letters)) {
    return '推測されやすい語に数字や記号を足しただけのパスワードは使えません。'
  }
  const local = (email ?? '').split('@')[0]?.trim().toLowerCase() ?? ''
  if ([...local].length >= 4 && (low.includes(local) || (letters !== '' && letters === lettersOnly(local)))) {
    return 'メールアドレスの名前の部分を含むパスワードは使えません。'
  }
  return null
}
