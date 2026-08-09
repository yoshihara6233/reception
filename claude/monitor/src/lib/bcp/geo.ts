/**
 * BCP の距離計算。**2 つのルートに同じ実装が複製されていたのを 1 本にした。**
 *
 * `/api/bcp/test`（発令）と `/api/bcp/test/stores`（対象店舗の下見）が
 * それぞれ自前の `haversineKm` を持っていた。本体は同一だったが、
 * **片方だけ直せば静かにずれる**形（このプロジェクトで繰り返し起きている
 * 「片側落ち」そのもの）で、どちらも export されていないためテストからも
 * 触れなかった。
 *
 * 画面の「半径 N km の店舗が対象」という説明と、実際に発令される店舗が
 * 一致することがここの責任。ずれると、発令されたはずの店舗が録画を
 * 始めない／無関係な店舗が始まる。
 *
 * ⚠ **式は 1 文字も変えていない**（複製元と一致することを md5 で確認済み）。
 *   「移動のついでに直す」と、レビューで等価性を確かめられなくなる。
 *   `Math.sqrt(1 - a)` が対蹠点付近の丸め誤差で NaN になる可能性を疑って
 *   20 万件＋対蹠点を総当たりしたが**再現しなかった**ので、ガードは入れて
 *   いない。geo.property.test.ts がその探索を常時続ける。
 */

/** 地球の平均半径 (km)。JMA の距離表記と揃える一般的な値。 */
const EARTH_RADIUS_KM = 6371

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = EARTH_RADIUS_KM
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
