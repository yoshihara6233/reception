/**
 * 端末の控え (Service Worker の Cache Storage) の扱い (2026-10-29・自主診断 ASVS 14.3.1・14.3.3)。
 *
 * 控えてよいのは「誰が見ても同じもの」だけ: ビルドの静的ファイル (/_next/static/)・アイコン・
 * /offline の画面。認証済みの画面の HTML は控えない。
 * public/sw-v2.js の isShareablePath と同じ判定にしておくこと (SW は素の JS で import できない)。
 */
import { authFetch } from '@/lib/auth/post-json'

export const OFFLINE_PATH = '/offline'

/** 控えてよい (利用者によって中身が変わらない) パスか。 */
export function isShareableCachePath(pathname: string): boolean {
  return pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/favicon.ico' ||
    pathname === OFFLINE_PATH
}

/** Cache Storage の最小限の形 (試験で差し替えられるように)。 */
export interface CacheStorageLike {
  keys(): Promise<string[]>
  open(name: string): Promise<{
    keys(): Promise<ReadonlyArray<{ url: string }>>
    delete(request: { url: string }): Promise<boolean>
  }>
}

/**
 * 控えのうち、共有してよいもの以外をすべて消す。消した数を返す。
 *
 * ログアウト・サインインの画面を開いたときに呼ぶ。サーバへつながらなくても端末だけで消せる
 * (ASVS 14.3.1 の「接続できないときもクライアント側で片付ける」)。
 * 以前の版 (f72 以前) の SW が控えた画面の HTML も、ここで消える。
 */
export async function clearAuthenticatedCaches(storage?: CacheStorageLike | null): Promise<number> {
  const cs = storage ?? (typeof caches === 'undefined' ? null : (caches as unknown as CacheStorageLike))
  if (!cs) return 0
  let removed = 0
  try {
    for (const name of await cs.keys()) {
      const cache = await cs.open(name)
      for (const req of await cache.keys()) {
        let path: string
        try { path = new URL(req.url).pathname } catch { path = '' }
        if (isShareableCachePath(path)) continue
        if (await cache.delete(req)) removed++
      }
    }
  } catch {
    // 控えが使えない端末 (プライベートブラウズなど) では何もしない
  }
  return removed
}

/**
 * サインアウトしてログインの画面へ移る (ヘッダーのログアウト・停止中の案内・多要素の確認の画面)。
 *
 * 1. サーバでセッションを失効させる (/api/auth/logout・応答の Clear-Site-Data で HTTP の控えも消える)
 * 2. 端末の控えを消す (サーバへつながらなくても行う)
 * 3. 読み直しを伴う移動でログインへ。画面の中の状態 (Next のルーターの控え) も捨て、
 *    戻るの履歴にも今の画面を残さない (replace)
 */
export async function signOutAndLeave(deps: SignOutDeps = {}): Promise<void> {
  const logout = deps.logout ?? (() => authFetch('/api/auth/logout'))
  const clear = deps.clear ?? (() => clearAuthenticatedCaches())
  const go = deps.go ?? ((path: string) => window.location.replace(path))
  // **どちらも待つ上限を決める** (2026-11-04・シナリオ試験 S-4)。パソコンの Chrome で
  // ログアウトを押すとボタンが処理中のまま止まり、ログインの画面へ移らなかった
  // (読み直すとログインの画面が出る = セッションは消えていた)。応答の Clear-Site-Data: "cache" で
  // Chrome が控えを消し終わるまで応答を返さないか、Cache Storage の片付けが終わらないと、
  // 3. の移動まで進まない。失効はサーバで先に済み、控えはログインの画面でも消すので、
  // 待ちきれなくても移ってよい
  try {
    await withTimeout(logout(), deps.logoutWaitMs ?? LOGOUT_WAIT_MS)
  } catch {
    // 失効に失敗しても端末の側は片付けてログインへ移る
  }
  try {
    await withTimeout(clear(), deps.cacheWaitMs ?? CACHE_WAIT_MS)
  } catch {
    // 片付けられなくてもログインへ移る
  }
  go('/login')
}

/** ログアウトの応答を待つ上限。サーバの失効はふつう 1 秒かからない */
export const LOGOUT_WAIT_MS = 3_000
/** 端末の控えの片付けを待つ上限。ログインの画面を開いたときにも片付ける */
export const CACHE_WAIT_MS = 2_000

/** signOutAndLeave の差し替え口 (試験用)。 */
export interface SignOutDeps {
  logout?: () => Promise<unknown>
  clear?: () => Promise<unknown>
  go?: (path: string) => void
  logoutWaitMs?: number
  cacheWaitMs?: number
}

/** p が ms 以内に終われば待ち、終わらなければ待たずに進む (p は止めない)。 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(undefined), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}
