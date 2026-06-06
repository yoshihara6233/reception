/**
 * NVR Adapter エラー型 (packages/shared 版・正本)
 */
import type { NvrVendor } from './types'

export type NvrErrorCode =
  | 'auth_failed'
  | 'unauthorized'
  | 'not_found'
  | 'timeout'
  | 'protocol_error'
  | 'rate_limited'
  | 'channel_unavailable'
  | 'unsupported'
  | 'transient'
  | 'unknown'

export class NvrAdapterError extends Error {
  constructor(
    public readonly vendor:  NvrVendor,
    public readonly code:    NvrErrorCode,
    message:                 string,
    public readonly cause?:  unknown,
  ) {
    super(message)
    this.name = 'NvrAdapterError'
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, NvrAdapterError)
    }
  }

  get isRetryable(): boolean {
    return this.code === 'timeout'
        || this.code === 'transient'
        || this.code === 'rate_limited'
  }
}

export class UnsupportedOperationError extends NvrAdapterError {
  constructor(vendor: NvrVendor, operation: string) {
    super(vendor, 'unsupported', `Operation not supported by ${vendor}: ${operation}`)
    this.name = 'UnsupportedOperationError'
  }
}

export class AuthError extends NvrAdapterError {
  constructor(vendor: NvrVendor, message = 'authentication failed') {
    super(vendor, 'auth_failed', message)
    this.name = 'AuthError'
  }
}
