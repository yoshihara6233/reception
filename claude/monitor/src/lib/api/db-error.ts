/**
 * DB の失敗を、中身を返さずに記録する (2026-10-29・自主診断 ASVS 16.5.1・13.4.2・16.3.4)。
 *
 * 以前は約 50 の受け口が PostgREST の誤りの文 (制約名・列名・表の名前・値) をそのまま応答に
 * 載せていた。スキーマの形を外へ教え、しかもサーバ側のログには何も残らなかった。
 * いまは応答には決まった文字 (`db_error`) だけを返し、元の文は受け口の名前を添えて
 * サーバのログ (Vercel) に書く。切り分けはログで行う。
 */
export const DB_ERROR = 'db_error'

/** 誤りをログに書き、応答に載せる決まった文字を返す。 */
export function dbErrorCode(err: { message?: string; code?: string } | null | undefined, where: string): string {
  console.error(`[api] ${where} の DB の操作に失敗しました`, { code: err?.code, message: err?.message?.slice(0, 500) })
  return DB_ERROR
}
