'use client'

/**
 * 店舗別オプション（巡回/発報/検査）の ON/OFF ピッカー。店舗新規・編集フォーム共用。
 *
 * 各オプションは「テナントが契約済み(contracted)」かつ「ON にできる店舗数の
 * 上限(limit)内」のときだけ ON にできる。既に ON の店舗は onCount から除外して
 * 渡す想定（編集時は自店舗を除く）ため、`checked` が false のときのみ残数で判定する。
 * 強制の本体はサーバAPI側（ここはUIガイド）。
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
        テナントが契約し、かつ上限に空きがある機能のみ ON にできます。
      </p>
      <div className="space-y-2">
        {ROWS.map(({ key, avail: ak, label }) => {
          const a = avail[ak]
          const checked = value[key]
          const remaining = a.limit == null ? null : Math.max(0, a.limit - a.onCount)
          const canTurnOn = a.contracted && (a.limit == null || a.onCount < a.limit)
          const disabled = !checked && !canTurnOn
          let note = ''
          if (!a.contracted) note = 'テナント未契約'
          else if (remaining != null) note = `残り ${remaining.toLocaleString()} / 上限 ${a.limit!.toLocaleString()} 店舗`
          else note = '上限なし'
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
              <span className={`text-[11px] ${!a.contracted ? 'text-amber-600' : disabled ? 'text-red-600' : 'text-slate-500'}`}>
                {note}
              </span>
            </div>
          )
        })}
      </div>
    </fieldset>
  )
}
