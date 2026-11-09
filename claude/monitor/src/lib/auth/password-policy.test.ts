import { describe, expect, it } from 'vitest'
import { passwordProblem, passwordRejectMessage } from './password-policy'

describe('passwordProblem (ASVS 6.2.11)', () => {
  it('製品・会社の名前を含むものを断る', () => {
    for (const p of ['Gvms2026!!', 'my-g-vms-pass', 'NVMS12345', 'genesis-edge1', 'Intereco99']) {
      expect(passwordProblem(p), p).toMatch(/製品や会社/)
    }
  })
  it('語に数字や記号を足しただけのものを断る', () => {
    for (const p of ['Admin2026!', 'password123', 'P@ssword1'.replace('@', 'a'), '1monitor!', 'Keibi-0001']) {
      expect(passwordProblem(p), p).toMatch(/推測されやすい/)
    }
  })
  it('語を含むだけの普通のパスワードは通す', () => {
    expect(passwordProblem('badminton-court-7')).toBeNull()
    expect(passwordProblem('correct horse battery staple')).toBeNull()
  })
  it('メールアドレスの名前の部分を含むものを断る (4 文字以上のとき)', () => {
    expect(passwordProblem('yamada-2026-x', 'yamada@example.jp')).toMatch(/メールアドレス/)
    expect(passwordProblem('Yamada1234', 'yamada12@example.jp')).toMatch(/メールアドレス/)
    expect(passwordProblem('abc-long-password', 'abc@example.jp')).toBeNull()
    expect(passwordProblem('some-long-phrase', null)).toBeNull()
  })
})

describe('passwordRejectMessage (認証基盤が断ったときの案内)', () => {
  it('weak_password は日本語の案内にする (500 にしない)', () => {
    expect(passwordRejectMessage({ code: 'weak_password' })).toMatch(/推測されやすい/)
    expect(passwordRejectMessage({ code: 'same_password' })).toMatch(/同じ/)
  })
  it('入力の誤りでないものは null (従来どおり 500 で返す)', () => {
    expect(passwordRejectMessage({ code: 'unexpected_failure' })).toBeNull()
    expect(passwordRejectMessage({})).toBeNull()
    expect(passwordRejectMessage(null)).toBeNull()
  })
})
