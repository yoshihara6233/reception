import { describe, expect, it } from 'vitest'
import { edgeAuthEmail } from './auth-provision'

describe('edgeAuthEmail', () => {
  it('edge_id から決定的に導出する（provisioning と bootstrap で一致必須）', () => {
    const id = '17f0cd0b-ce89-409c-bb1e-dec924ee22e2'
    expect(edgeAuthEmail(id)).toBe(`edge+${id}@edge.intereco.local`)
  })
})
