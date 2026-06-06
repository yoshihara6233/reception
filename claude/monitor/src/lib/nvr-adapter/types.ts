/**
 * F46.3: NvrAdapter 型は @intereco/shared に移設済。
 *
 * このファイルは下位互換のための **shim** (re-export)。
 * 既存コードの `import { NvrCapabilities } from '@/lib/nvr-adapter/types'` は
 * そのまま動き続ける。新規コードは `@intereco/shared` から直接 import 推奨。
 *
 * 正本: packages/shared/src/nvr-adapter/types.ts
 */
export * from '@intereco/shared/nvr-adapter'
