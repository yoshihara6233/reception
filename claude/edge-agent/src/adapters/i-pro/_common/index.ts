/**
 * F46.15-17: i-PRO 共通モジュール public API
 */
export { IProCgiClient } from './cgi-client'
export type { CgiClientOptions, CgiGetOptions, CgiResponse } from './cgi-client'

export {
  detectIProFirmware,
  parseCgiSysInfo,
  parseSemver,
  inferFamily,
} from './firmware-detector'

export { deriveCapabilities } from './capability-matrix'
