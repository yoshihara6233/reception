/**
 * エッジ端末トークンのハッシュ化（脆弱性検査 M-5）。
 *
 * ── なぜハッシュか ──────────────────────────────────────────────────────
 * `edge_devices.device_token` は、スキーマ上で**唯一の平文の秘密**だった。
 * 同じ用途の `enrollment_tokens.token_hash` は最初からハッシュで引いており、
 * ここだけ揃っていなかった。DB を読める経路が 1 つでもあれば
 * （super_admin の画面・バックアップ・ダンプの流出）**任意のエッジに
 * なりすませる**ため、保管側から平文を消す。
 *
 * ── なぜ SHA-256 で足りるか（scrypt にしない理由）──────────────────────
 * これは**人が決めるパスワードではなく 32 バイトの乱数**
 * （`randomBytes(32).toString('hex')`）。総当たりも辞書も成立しないので、
 * 鍵伸長は不要で、認証のたびに走るコストの方が問題になる。
 * キオスク PIN が scrypt なのは 4〜6 桁の人間由来だからで、根拠が違う。
 * 同じ理由で `enrollment_tokens` も SHA-256 を使っている（方式を揃える）。
 *
 * ── 比較は DB の索引引きで行う ──────────────────────────────────────────
 * `.eq('device_token_hash', hash)` で一意索引を引く。タイミング差は
 * ネットワークの揺らぎに埋もれるうえ、**ハッシュを知られても平文は作れない**
 * ので、ここでの定数時間比較は要らない。定数時間が要るのは
 * 「秘密そのものと突き合わせる」場面（キオスク cookie / 署名 URL）。
 */
import { createHash } from 'node:crypto'

/** device_token の SHA-256（hex）。DB の `edge_devices.device_token_hash` と同じ形。 */
export function hashDeviceToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}
