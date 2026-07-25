'use client'

/**
 * 店舗別オプション（巡回/発報/検査）の ON/OFF ピッカー。店舗新規・編集フォーム共用。
 *
 * 各オプションは「テナントが契約済み(contracted)」であれば ON にできる。数量上限
 * (limit)は**ソフト運用**＝超過しても ON 可能で、超過時は警告表示のみ（ブロックしない）。
 * 未契約(contracted=false)のみ ON 不可（チェックボックス無効）。onCount は自店舗を
 * 除外して渡す想定（編集時は自店舗を除く）。強制/警告の本体はサーバAPI側（ここはUIガイド）。
 */
export interface OptAvail {
  contracted: boolean
  limit:      number | null
  onCount:    number
}
export interface StoreOptionsAvail {
  patrol:  OptAvail
  alarm:   OptAvail
  baggage: OptAvail
}
export interface StoreOptionState {
  opt_patrol:  boolean
  opt_alarm:   boolean
  opt_baggage: boolean
}

const ROWS: { key: keyof StoreOptionState; avail: keyof StoreOptionsAvail; label: string }[] = [
  { key: 'opt_patrol',  avail: 'patrol',  label: '巡回（AI警備 / /security）' },
  { key: 'opt_alarm',   avail: 'alarm',   label: '発報（アラーム / /alarms）' },
  { key: 'opt_baggage', avail: 'baggage', label: '手荷物検査（/baggage）' },
]

export function StoreOptionsFieldset({
  value, avail, onChange,
}: {
  value: StoreOptionState
  avail: StoreOptionsAvail
  onChange: (next: StoreOptionState) => void
}) {
  return (
    <fieldset className="rounded border border-slate-200 p-3">
      <legend className="px-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
        利用オプション（この店舗）
      </legend>
      <p className="mb-2 text-[11px] text-slate-500">
        テナントが契約している機能を ON にできます。上限を超えても登録は可能で、超過時は
        <b className="text-amber-600">警告</b>を表示します（未契約の機能は ON にできません）。
      </p>
      <div className="space-y-2">
        {ROWS.map(({ key, avail: ak, label }) => {
          const a = avail[ak]
          const checked = value[key]
          const disabled = !a.contracted && !checked         // 未契約は新規ONのみ不可
          const used = a.onCount + (checked ? 1 : 0)          // この店舗を ON にした場合の使用数
          const over = a.limit != null && used > a.limit      // 上限超過（登録は可・警告）
          let note = ''
          let tone = 'text-slate-500'
          if (!a.contracted) { note = 'テナント未契約'; tone = 'text-amber-600' }
          else if (a.limit == null) { note = '上限なし' }
          else {
            note = `${used.toLocaleString()} / 上限 ${a.limit.toLocaleString()} 店舗` + (over ? '（上限超過・警告）' : '')
            tone = over ? 'text-amber-600 font-bold' : 'text-slate-500'
          }
          return (
            <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <label className={`flex min-w-[15rem] items-center gap-2 text-sm ${disabled ? 'text-slate-400' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
                />
                {label}
              </label>
              <span className={`text-[11px] ${tone}`}>{note}</span>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
