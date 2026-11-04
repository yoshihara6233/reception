/**
 * テナントの料金プラン・状態の表示名 (2026-11-04・シナリオ試験の所見)。
 *
 * テナントの一覧に starter・trial などの内部名がそのまま出ていて、編集の選択肢にも
 * 「スターター (starter)」と内部名が付いていた。一覧とフォームで同じ表を使う。
 * 運営管理の画面 (日本語だけ) で使うので、i18n には載せていない。知らない値はそのまま返す。
 */
export const PLAN_LABELS: Record<string, string> = {
  starter:    'スターター',
  standard:   'スタンダード',
  enterprise: 'エンタープライズ',
}

export const TENANT_STATUS_LABELS: Record<string, string> = {
  trial:     'トライアル',
  active:    '稼働',
  suspended: '停止',
}

export function planLabel(p: string): string {
  return PLAN_LABELS[p] ?? p
}

export function tenantStatusLabel(s: string): string {
  return TENANT_STATUS_LABELS[s] ?? s
}
