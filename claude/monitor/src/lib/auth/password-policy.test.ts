import { describe, expect, it } from 'vitest'
import { passwordProblem } from './password-policy'

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
