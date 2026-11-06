/**
 * 利用約款への同意（2026-11-06・G・VMS の WBS G-9・約款の本体 第 4 条 2 項・3 項）。
 *
 * 外部の確認で「使っただけで同意とみなす形では、定型約款の組入れ（民法 第 548 条の 2）を満たさない
 * おそれ」と指摘があり、約款の掲載先を見せて明示の「同意する」を押してもらう形（クリックラップ）にした。
 *
 *  - **テナント管理者の利用者ごとに**、初めてログインしたときと、約款の版が上がったあとに求める
 *    （契約者＝テナントの管理者。運営（super_admin）と、管理者でない役割には求めない）
 *  - 同意したら日時・版・利用者・接続元を terms_consents に残す（消さない）
 *  - **約款の版（TERMS_VERSION）が空のあいだは何も求めない**（施行日が決まるまで）
 *
 * G・VMS 側（現場）も同じ形（G・VMS の internal/api/terms.go）。
 * Edge ランタイム（middleware）からも使うので Web 標準だけで書く。
 */

/** 今の約款の版。空 = 同意を求めない（施行日の前）。 */
export function termsVersion(): string {
  return (process.env.TERMS_VERSION ?? '').trim()
}

/** 約款の掲載先（同意の画面に出す）。 */
export function termsUrl(): string {
  return (process.env.TERMS_URL ?? '').trim() || 'https://g-vms.com/terms'
}

/** この役割に同意を求めるか（テナント管理者だけ）。 */
export function termsRequiredForRole(role: string | null | undefined): boolean {
  return role === 'tenant_admin'
}

/** 同意の画面とその受け口（関門の外に置く。/login と /api/auth は middleware の許可パス）。 */
export const TERMS_PAGE = '/login/terms'
