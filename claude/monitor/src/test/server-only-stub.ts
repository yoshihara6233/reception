/**
 * vitest 用の `server-only` スタブ（vitest.config.ts の alias から参照）。
 *
 * `server-only` は「クライアントバンドルに混ざったらビルドを失敗させる」ための
 * マーカーパッケージで、実体のモジュールは存在しない。テストは node 環境で
 * 走るのでガードは不要＝何もしない空モジュールに差し替える。
 */
export {}
