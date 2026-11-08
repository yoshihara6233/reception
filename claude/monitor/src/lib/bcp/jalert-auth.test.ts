import { describe, expect, it } from 'vitest'
import {
  bearerToken,
  constantTimeEqual,
  dbKey,
  isAuthorizedInvoke,
  secretKeyByName,
} from '../../../supabase/functions/jalert-poller/auth'

// jalert-poller の呼び出しの認証と DB の鍵の選び方（2026-11-09・ASVS 13.3.2）。
// 値はすべて試験用の作り物。

const INVOKE = 'invoke-secret-for-test-0123456789'
const LEGACY = 'eyJlegacy.test.token'
const NEWKEY = 'sb_secret_testvalue'

describe('bearerToken', () => {
  it('Bearer の後ろを取り出す', () => {
    expect(bearerToken(`Bearer ${INVOKE}`)).toBe(INVOKE)
    expect(bearerToken(`bearer ${INVOKE}`)).toBe(INVOKE)
  })
  it('形が違えば null', () => {
    expect(bearerToken(null)).toBeNull()
    expect(bearerToken('')).toBeNull()
    expect(bearerToken(INVOKE)).toBeNull()
    expect(bearerToken('Basic abc')).toBeNull()
    expect(bearerToken('Bearer a b')).toBeNull()
  })
})

describe('constantTimeEqual', () => {
  it('同じなら true・違えば false', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('', '')).toBe(true)
  })
})

describe('isAuthorizedInvoke', () => {
  it('専用の合言葉なら通す', () => {
    expect(isAuthorizedInvoke(`Bearer ${INVOKE}`, { JALERT_INVOKE_SECRET: INVOKE })).toBe(true)
  })
  it('違う値・無い値は通さない', () => {
    expect(isAuthorizedInvoke(`Bearer ${INVOKE}x`, { JALERT_INVOKE_SECRET: INVOKE })).toBe(false)
    expect(isAuthorizedInvoke(null, { JALERT_INVOKE_SECRET: INVOKE })).toBe(false)
  })
  it('合言葉が未設定ならだれも通さない（フェイルクローズ）', () => {
    expect(isAuthorizedInvoke('Bearer ', {})).toBe(false)
    expect(isAuthorizedInvoke(`Bearer ${INVOKE}`, { JALERT_INVOKE_SECRET: '  ' })).toBe(false)
  })
  it('旧式の鍵は逃げ道を開けたときだけ通す', () => {
    const env = { JALERT_INVOKE_SECRET: INVOKE, SUPABASE_SERVICE_ROLE_KEY: LEGACY }
    expect(isAuthorizedInvoke(`Bearer ${LEGACY}`, env)).toBe(false)
    expect(isAuthorizedInvoke(`Bearer ${LEGACY}`, { ...env, JALERT_ALLOW_LEGACY_INVOKE: '1' })).toBe(true)
    // 逃げ道を開けても合言葉は通る
    expect(isAuthorizedInvoke(`Bearer ${INVOKE}`, { ...env, JALERT_ALLOW_LEGACY_INVOKE: '1' })).toBe(true)
    // '1' 以外は開けたことにしない
    expect(isAuthorizedInvoke(`Bearer ${LEGACY}`, { ...env, JALERT_ALLOW_LEGACY_INVOKE: 'true' })).toBe(false)
  })
  it('公開用の鍵（anon）では通らない', () => {
    // 以前は入口の JWT の確かめだけだったので、公開用の鍵でも起動できた
    expect(isAuthorizedInvoke('Bearer eyJanon.public.key', { JALERT_INVOKE_SECRET: INVOKE })).toBe(false)
  })
})

describe('dbKey', () => {
  it('専用の鍵を使う', () => {
    expect(dbKey({ JALERT_DB_KEY: NEWKEY, SUPABASE_SERVICE_ROLE_KEY: LEGACY, JALERT_ALLOW_LEGACY_INVOKE: '1' })).toBe(NEWKEY)
  })
  it('専用の鍵が無ければ、逃げ道を開けたときだけ旧式の鍵', () => {
    expect(dbKey({ SUPABASE_SERVICE_ROLE_KEY: LEGACY })).toBeNull()
    expect(dbKey({ SUPABASE_SERVICE_ROLE_KEY: LEGACY, JALERT_ALLOW_LEGACY_INVOKE: '1' })).toBe(LEGACY)
  })
  it('何も無ければ null', () => {
    expect(dbKey({})).toBeNull()
  })
})

describe('secretKeyByName（SUPABASE_SECRET_KEYS）', () => {
  const raw = JSON.stringify({ default: 'sb_secret_default', jalert_poller: NEWKEY })
  it('名前で引く', () => {
    expect(secretKeyByName(raw, 'jalert_poller')).toBe(NEWKEY)
    expect(secretKeyByName(raw, 'none')).toBeNull()
  })
  it('形が違えば null', () => {
    expect(secretKeyByName(undefined, 'jalert_poller')).toBeNull()
    expect(secretKeyByName('not json', 'jalert_poller')).toBeNull()
    expect(secretKeyByName('["a"]', 'jalert_poller')).toBeNull()
    expect(secretKeyByName(JSON.stringify({ jalert_poller: 1 }), 'jalert_poller')).toBeNull()
  })
  it('dbKey は専用の名前の鍵を使い、default は使わない', () => {
    expect(dbKey({ SUPABASE_SECRET_KEYS: raw })).toBe(NEWKEY)
    expect(dbKey({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_default' }) })).toBeNull()
    expect(dbKey({ SUPABASE_SECRET_KEYS: raw, JALERT_SECRET_KEY_NAME: 'default' })).toBe('sb_secret_default')
    expect(dbKey({ SUPABASE_SECRET_KEYS: raw, JALERT_DB_KEY: 'sb_secret_explicit' })).toBe('sb_secret_explicit')
  })
})
