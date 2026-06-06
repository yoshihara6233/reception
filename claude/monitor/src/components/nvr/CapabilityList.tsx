/**
 * F46.27: NVR capability チェックリスト UI
 *
 * adapter.capabilities を読んで「機能対応一覧」を○/×表示する。
 * NvrCapabilities 型は src/lib/nvr-adapter/types.ts と一致。
 */
import type { NvrCapabilities } from '@/lib/nvr-adapter/types'

interface CapabilityItem {
  key:    keyof NvrCapabilities | 'maxResolution' | 'maxChannels' | 'maxVodHours'
  label:  string
  value:  boolean | string | number
  detail?: string
}

interface Props {
  capabilities: NvrCapabilities
  /** 暫定機能 (実機検証で確定する旨を脚注表示) */
  provisional?: boolean
}

export function CapabilityList({ capabilities: c, provisional }: Props) {
  const items: CapabilityItem[] = [
    { key: 'supportsSnapshot',       label: 'スナップショット取得',     value: c.supportsSnapshot },
    { key: 'supportsLiveRtsp',       label: 'ライブ RTSP',              value: c.supportsLiveRtsp },
    { key: 'supportsVod',            label: '録画→MP4 エクスポート',
      value: c.supportsVod, detail: `最大 ${c.maxVodHours}時間` },
    { key: 'supportsEventPush',      label: 'ONVIF Event Push',        value: c.supportsEventPush },
    { key: 'supportsAiMetadata',     label: 'AI メタデータ受信',        value: c.supportsAiMetadata },
    { key: 'supportsActiveGuard',    label: 'iPRO Active Guard 連携',   value: c.supportsActiveGuard },
    { key: 'supportsTimelineSnapshot', label: 'タイムラインスナップショット (BCP)',
      value: c.supportsTimelineSnapshot },
    { key: 'supportsAiOnIpro',       label: 'AI on iPRO',               value: c.supportsAiOnIpro },
    { key: 'maxResolution',          label: '最大解像度',
      value: c.maxResolution },
    { key: 'maxChannels',            label: 'チャンネル数',
      value: c.maxChannels },
  ]

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          機能 (capability)
        </h3>
        {provisional && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
            暫定値 (実機検証で確定)
          </span>
        )}
      </div>

      <ul className="space-y-1.5 text-xs">
        {items.map((it) => (
          <li key={it.key} className="flex items-center justify-between">
            <span className="text-slate-600 dark:text-slate-300">{it.label}</span>
            <span className="flex items-center gap-2">
              {typeof it.value === 'boolean' ? (
                <span className={it.value
                  ? 'font-bold text-emerald-600 dark:text-emerald-400'
                  : 'font-bold text-slate-300 dark:text-slate-600'}>
                  {it.value ? '✓' : '✕'}
                </span>
              ) : (
                <span className="font-mono text-slate-700 dark:text-slate-200">
                  {String(it.value)}
                </span>
              )}
              {it.detail && (
                <span className="text-[10px] text-slate-400">{it.detail}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
