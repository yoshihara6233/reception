/**
 * F46.3: エラー型は @intereco/shared に移設済 (shim)。
 * 正本: packages/shared/src/nvr-adapter/errors.ts
 */
export {
  NvrAdapterError, UnsupportedOperationError, AuthError,
} from '@intereco/shared/nvr-adapter'
export type { NvrErrorCode } from '@intereco/shared/nvr-adapter'
