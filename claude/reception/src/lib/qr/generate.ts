import { randomBytes } from 'crypto'

export function generateQrToken(): string {
  return randomBytes(16).toString('hex') // 32-char hex string
}

export function getQrUrl(token: string, baseUrl: string): string {
  return `${baseUrl}/r/${token}`
}
