import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  resolvePaths,
  releaseDir,
  readState,
  writeState,
  readRunningVersion,
} from './runner.js'
import { initialState, beginUpdate } from './core.js'

describe('resolvePaths', () => {
  it('EDGE_ROOT 未設定なら null（OTA 無効）', () => {
    expect(resolvePaths(undefined)).toBeNull()
  })
  it('配下パスを正しく組む', () => {
    const p = resolvePaths('/home/intereco/edge')
    expect(p).toMatchObject({
      root: '/home/intereco/edge',
      repo: '/home/intereco/edge/repo',
      current: '/home/intereco/edge/current',
      knownGood: '/home/intereco/edge/known-good',
      state: '/home/intereco/edge/shared/ota-state.json',
    })
  })
  it('releaseDir は releases/<version>', () => {
    const p = resolvePaths('/edge')!
    expect(releaseDir(p, 'abc1234')).toBe('/edge/releases/abc1234')
  })
})

describe('state IO（temp dir）', () => {
  let root: string
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'ota-test-'))
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('state が無ければ running 版で初期化して返す', async () => {
    const p = resolvePaths(root)!
    const s = await readState(p, 'sha0')
    expect(s).toMatchObject({ running_version: 'sha0', known_good_version: 'sha0', status: 'idle' })
  })

  it('write→read で往復する', async () => {
    const p = resolvePaths(root)!
    const s = beginUpdate(initialState('sha0', '2026-01-01T00:00:00Z'), 'sha1', '2026-01-01T00:01:00Z')
    await writeState(p, s)
    const back = await readState(p, 'sha0')
    expect(back).toEqual(s)
  })

  it('壊れた state は初期化にフォールバック', async () => {
    const p = resolvePaths(root)!
    await fs.mkdir(join(root, 'shared'), { recursive: true })
    await fs.writeFile(p.state, '{ not json', 'utf8')
    const s = await readState(p, 'sha9')
    expect(s.status).toBe('idle')
    expect(s.running_version).toBe('sha9')
  })

  it('readRunningVersion は current/VERSION を読む（無ければ unknown）', async () => {
    const p = resolvePaths(root)!
    expect(await readRunningVersion(p)).toBe('unknown')
    await fs.mkdir(p.current, { recursive: true })
    await fs.writeFile(join(p.current, 'VERSION'), 'abc1234\n', 'utf8')
    expect(await readRunningVersion(p)).toBe('abc1234')
  })
})
