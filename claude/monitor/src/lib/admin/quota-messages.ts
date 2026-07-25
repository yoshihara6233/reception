/**
 * 数量クォータ（店舗数・オプションON上限）の警告/エラーコードを日本語ラベルに。
 * クライアント/サーバ双方から使えるよう副作用なし（'server-only' を付けない）。
 *
 * コードは `store_limit_exceeded` / `option_limit_exceeded:patrol` / `option_not_contracted:alarm`
 * のように `base:option` 形式を取り得る。
 */
const OPT_JA: Record<string, string> = { patrol: '巡回', alarm: '発報', baggage: '手荷物検査' }

export function quotaMessage(code?: string): string {
  if (!code) return ''
  const [base, opt] = code.split(':')
  const optJa = opt ? OPT_JA[opt] ?? opt : ''
  switch (base) {
    case 'name_required':          return '店舗名(name)が空です'
    case 'duplicate_name':         return '同一名称の店舗が既にあるため登録をスキップしました'
    case 'tenant_unresolved':      return '登録先テナントが未確定です（操作中テナントを選択するか tenant_id 列を指定）'
    case 'store_limit_exceeded':   return '店舗数が上限を超えています（登録は完了）'
    case 'option_limit_exceeded':  return `${optJa}を ON にした店舗数が上限を超えています（登録は完了）`
    case 'option_not_contracted':  return `${optJa}はテナント未契約のため ON にできません`
    case 'tenant_required':        return 'テナントが必要です'
    case 'insufficient_role':      return '権限がありません'
    case 'invalid_body':           return '入力内容を確認してください'
    default:                       return code
  }
}
