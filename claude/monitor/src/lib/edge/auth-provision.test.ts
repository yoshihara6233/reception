import { describe, expect, it } from 'vitest'
import { edgeAuthEmail, mayWithholdServiceRole } from './auth-provision'

describe('edgeAuthEmail', () => {
  it('edge_id から決定的に導出する（provisioning と bootstrap で一致必須）', () => {
    const id = '17f0cd0b-ce89-409c-bb1e-dec924ee22e2'
    expect(edgeAuthEmail(id)).toBe(`edge+${id}@edge.intereco.local`)
  })
})

describe('mayWithholdServiceRole（Phase B4 の安全装置）', () => {
  it('scoped_only でなければ常に鍵を返す（既定の運用を壊さない）', () => {
    expect(mayWithholdServiceRole({
      scopedOnly: false, mintedToken: true, clientTokenStillFresh: true,
    })).toBe(false)
  })

  it('この応答でトークンを発行できたなら省いてよい', () => {
    expect(mayWithholdServiceRole({
      scopedOnly: true, mintedToken: true, clientTokenStillFresh: false,
    })).toBe(true)
  })

  it('エッジが「手持ちがまだ有効」と申告していれば省いてよい（再発行を省いた応答）', () => {
    expect(mayWithholdServiceRole({
      scopedOnly: true, mintedToken: false, clientTokenStillFresh: true,
    })).toBe(true)
  })

  it('★トークンを渡せなかった応答では鍵を省かない（エッジを丸腰にしない）', () => {
    // provisioning 失敗・GoTrue 障害・SECRETS_ENC_KEY 未設定など。
    // ここで鍵まで止めると、そのエッジは何もできなくなる。次の pull で締まればよい。
    expect(mayWithholdServiceRole({
      scopedOnly: true, mintedToken: false, clientTokenStillFresh: false,
    })).toBe(false)
  })
})
