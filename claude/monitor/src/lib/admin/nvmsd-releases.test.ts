import { describe, it, expect } from 'vitest'
import { edgePkg, nvmsdReleasePath } from './nvmsd-releases'

describe('edgePkg（OTA 配り分けの拠点形式）', () => {
  it('名乗りの無い拠点（0.1.66 以前）は deb / amd64', () => {
    expect(edgePkg({ pkg_format: null, pkg_arch: null })).toEqual({ format: 'deb', arch: 'amd64' })
    expect(edgePkg({})).toEqual({ format: 'deb', arch: 'amd64' })
  })
  it('名乗りをそのまま使う', () => {
    expect(edgePkg({ pkg_format: 'rpm', pkg_arch: 'arm64' })).toEqual({ format: 'rpm', arch: 'arm64' })
  })
  it('未知の値は既定へ倒す', () => {
    expect(edgePkg({ pkg_format: 'apk', pkg_arch: 'riscv64' })).toEqual({ format: 'deb', arch: 'amd64' })
  })
})

describe('nvmsdReleasePath', () => {
  it('同じ版の deb と rpm が別パスになる', () => {
    expect(nvmsdReleasePath('0.1.67', 'deb', 'amd64')).not.toBe(nvmsdReleasePath('0.1.67', 'rpm', 'amd64'))
  })
})
