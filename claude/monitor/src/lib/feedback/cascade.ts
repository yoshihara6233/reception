/**
 * 話題の状態を、束ねた要望へ写す（基本設計 §3.5「話題の状態を変えると、束ねた要望の状態も変わる」）。
 *
 * 写すのは現場とテナントへ返す 3 つ（status・reply・fixed_version）だけ。
 * 話題の内部メモ・WBS・課題 URL は写さない（テナントへ出さない）。
 *
 * ここは「何がどう変わるか」を決めるだけの純粋な関数で、DB への書き込みと
 * 変更の記録（feedback_events）は呼び出し側が行う。値の変わらない要望は返さない
 * （記録を水増ししない・現場の差分取得に余計な行を出さない）。
 */

export interface ReturnedFields {
  status: string
  reply: string | null
  fixed_version: string | null
}

export interface ItemSnapshot extends ReturnedFields {
  id: string
}

/** 話題から写す値。undefined の項目は写さない（その項目は今回変えていない）。 */
export type CascadePatch = Partial<ReturnedFields>

export interface ItemChange {
  id: string
  before: Partial<ReturnedFields>
  after: Partial<ReturnedFields>
}

const FIELDS = ['status', 'reply', 'fixed_version'] as const

/** 写す項目だけを取り出す（undefined を落とす）。 */
export function cascadeFields(patch: CascadePatch): CascadePatch {
  const out: CascadePatch = {}
  for (const f of FIELDS) {
    if (patch[f] !== undefined) (out as Record<string, unknown>)[f] = patch[f]
  }
  return out
}

/** 束ねた要望のうち、値が変わるものと、その前後の値。 */
export function planCascade(patch: CascadePatch, items: ItemSnapshot[]): ItemChange[] {
  const fields = cascadeFields(patch)
  const keys = Object.keys(fields) as (keyof ReturnedFields)[]
  if (keys.length === 0) return []
  const changes: ItemChange[] = []
  for (const it of items) {
    const before: Partial<ReturnedFields> = {}
    const after: Partial<ReturnedFields> = {}
    for (const k of keys) {
      const next = fields[k] ?? null
      const cur = it[k] ?? null
      if (cur !== next) {
        ;(before as Record<string, unknown>)[k] = cur
        ;(after as Record<string, unknown>)[k] = next
      }
    }
    // 見送り (declined) は返事が必須（DB の check と同じ）。写した結果が「見送り・返事なし」に
    // なるときは返事を消さずに残す（要望へ個別に書いた見送りの理由を消さない）。
    const finalStatus = after.status ?? it.status
    const finalReply = 'reply' in after ? after.reply : it.reply
    if (finalStatus === 'declined' && !(finalReply && finalReply.trim())) {
      delete after.reply
      delete before.reply
    }
    if (Object.keys(after).length) changes.push({ id: it.id, before, after })
  }
  return changes
}

/** 変更を「同じ値へ変えるもの」ごとにまとめる（まとめて 1 文で更新するため）。 */
export function groupChanges(changes: ItemChange[]): { after: Partial<ReturnedFields>; ids: string[] }[] {
  const groups = new Map<string, { after: Partial<ReturnedFields>; ids: string[] }>()
  for (const c of changes) {
    const key = JSON.stringify(Object.entries(c.after).sort(([a], [b]) => a.localeCompare(b)))
    const g = groups.get(key) ?? { after: c.after, ids: [] }
    g.ids.push(c.id)
    groups.set(key, g)
  }
  return [...groups.values()]
}

/**
 * 要望を話題に束ねたとき、要望が話題から受け継ぐ値。
 * 状態は必ず受け継ぐ。返事と対応の版は、話題に値があるときだけ受け継ぐ
 * （話題にまだ返事が無いのに、要望へ個別に書いた返事を消さない）。
 */
export function inheritFromTopic(topic: ReturnedFields): CascadePatch {
  const out: CascadePatch = { status: topic.status }
  if (topic.reply) out.reply = topic.reply
  if (topic.fixed_version) out.fixed_version = topic.fixed_version
  return out
}
