/**
 * 発報受け口の共有トークン検証（純ロジック・config 非依存＝単体テスト対象）。
 *
 * expected が空＝検証無効（従来互換）。有効時は query `token` または
 * `X-Alarm-Token` ヘッダの一致を必須とする（query があればそちらを優先）。
 */
export function isAlarmTokenValid(
  expected: string,
  query: URLSearchParams,
  headerToken: string | string[] | undefined,
): boolean {
  if (!expected) return true
  const given = (query.get('token') ?? (Array.isArray(headerToken) ? headerToken[0] : headerToken) ?? '').trim()
  return given.length > 0 && given === expected
}
