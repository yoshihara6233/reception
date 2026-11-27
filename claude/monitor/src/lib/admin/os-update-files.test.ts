import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { OS_UPDATE_MAX_SIGNED, parseOsUpdateSigned } from './os-update-files'

const b64u = (b: Buffer) => b.toString('base64url')

/** G・VMS の internal/osfile と同じ作り方で署名した 1 行を作る */
function makeSigned(body: unknown, priv = keys.privateKey) {
  const raw = Buffer.from(JSON.stringify(body), 'utf8')
  const sig = sign(null, Buffer.concat([Buffer.from('nvmsosu1\n'), raw]), priv)
  return `nvmsosu1.${b64u(raw)}.${b64u(sig)}`
}
const keys = generateKeyPairSync('ed25519')
const pub = (k = keys.publicKey) => k.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64')

const BODY = {
  id: 'GVMS-SA-2026-001-U1', advisory: 'GVMS-SA-2026-001', cve: 'CVE-2026-98432', issued_at: '2026-11-06',
  title: 'カーネルの修正', reboot: true,
  packages: [{ name: 'kernel', at_least: '6.12.0-55.1.el10' }, { name: 'kernel-core', at_least: '6.12.0-55.1.el10' }],
}

describe('parseOsUpdateSigned（接続仕様 §14）', () => {
  it('本文を読み、1 行は書き換えずに返す', () => {
    const line = makeSigned(BODY)
    const r = parseOsUpdateSigned(`  ${line}\n`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.signed).toBe(line)
    expect(r.signatureChecked).toBe(false)
    expect(r.body).toMatchObject({ id: 'GVMS-SA-2026-001-U1', title: 'カーネルの修正', reboot: true, cve: 'CVE-2026-98432' })
    expect(r.body.packages).toHaveLength(2)
  })

  it('公開鍵があれば署名を確かめる（合えば通す・新旧の鍵を並べてよい）', () => {
    const other = generateKeyPairSync('ed25519')
    const r = parseOsUpdateSigned(makeSigned(BODY), `${pub(other.publicKey)}, ${pub()}`)
    expect(r).toMatchObject({ ok: true, signatureChecked: true })
  })

  it('★別の鍵の署名は断る', () => {
    const other = generateKeyPairSync('ed25519')
    expect(parseOsUpdateSigned(makeSigned(BODY, other.privateKey), pub())).toEqual({ ok: false, error: 'bad_signature' })
  })

  it('★署名の後で本文を書き換えたものは断る', () => {
    const [p, , s] = makeSigned(BODY).split('.')
    const forged = `${p}.${b64u(Buffer.from(JSON.stringify({ ...BODY, title: '別の題' })))}.${s}`
    expect(parseOsUpdateSigned(forged, pub())).toEqual({ ok: false, error: 'bad_signature' })
  })

  it('形の違うものを断る', () => {
    expect(parseOsUpdateSigned('nvmsupd1.abc.def')).toEqual({ ok: false, error: 'bad_format' })
    expect(parseOsUpdateSigned('nvmsosu1.abc')).toEqual({ ok: false, error: 'bad_format' })
    expect(parseOsUpdateSigned('nvmsosu1.a b.c')).toEqual({ ok: false, error: 'bad_format' })
    expect(parseOsUpdateSigned(`nvmsosu1.${b64u(Buffer.from('not json'))}.c2ln`)).toEqual({ ok: false, error: 'bad_body' })
    expect(parseOsUpdateSigned('nvmsosu1.' + 'a'.repeat(OS_UPDATE_MAX_SIGNED) + '.c2ln')).toEqual({ ok: false, error: 'too_large' })
  })

  it('中身の検査は G・VMS 側と同じ（番号・題・部品）', () => {
    expect(parseOsUpdateSigned(makeSigned({ ...BODY, id: 'bad id!' }))).toEqual({ ok: false, error: 'bad_id' })
    expect(parseOsUpdateSigned(makeSigned({ ...BODY, title: ' ' }))).toEqual({ ok: false, error: 'no_title' })
    expect(parseOsUpdateSigned(makeSigned({ ...BODY, packages: [] }))).toEqual({ ok: false, error: 'bad_packages' })
    expect(parseOsUpdateSigned(makeSigned({ ...BODY, packages: [{ name: 'Kernel', at_least: '1' }] }))).toEqual({ ok: false, error: 'bad_packages' })
    expect(parseOsUpdateSigned(makeSigned({ ...BODY, packages: [BODY.packages[0], BODY.packages[0]] }))).toEqual({ ok: false, error: 'bad_packages' })
    expect(parseOsUpdateSigned(makeSigned({ ...BODY, packages: Array.from({ length: 17 }, (_, i) => ({ name: `p${i}`, at_least: '1' })) }))).toEqual({ ok: false, error: 'bad_packages' })
  })

  it('reboot が真でなければ再起動なし・任意の項目は無ければ null', () => {
    const r = parseOsUpdateSigned(makeSigned({ id: 'X-1', title: 't', packages: [{ name: 'curl', at_least: '8.1' }] }))
    expect(r).toMatchObject({ ok: true, body: { reboot: false, advisory: null, cve: null, issued_at: null } })
  })
})
