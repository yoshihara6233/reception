/**
 * 店舗切替中のスケルトン。
 *
 * AppShell はページの内側にあるため、店舗を切り替えるとサーバー側の解決が終わるまで
 * App Router は遷移せず、旧画面が固まったままになっていた（体感5秒の主因）。
 * loading.tsx を置くと押した瞬間にこの骨組みへ切り替わり、待ちが「反応している待ち」になる。
 *
 * 実寸は ShellBody の `md:grid-cols-[280px_1fr_360px]` に合わせてある。ここがずれると
 * 遷移の前後でレイアウトが跳ねるため、あちらを変えたらこちらも直すこと。
 * Genesis Edge 準拠: 紙・墨のみ、影なし1pxボーダー、藍は使わない（待機中に強調はしない）。
 */
function Bar({ w = 'w-full', h = 'h-3' }: { w?: string; h?: string }) {
  return <div className={`${w} ${h} rounded-[2px] bg-ge-paper-3 animate-pulse`} />
}

export default function StoreLoading() {
  return (
    <div className="flex h-dvh flex-col bg-ge-paper" aria-busy="true" aria-live="polite">
      <span className="sr-only">店舗を読み込んでいます</span>

      {/* ヘッダー */}
      <div className="flex h-14 shrink-0 items-center gap-4 border-b border-ge-paper-3 px-4">
        <Bar w="w-44" h="h-4" />
        <div className="flex-1" />
        <Bar w="w-24" h="h-6" />
      </div>

      <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[280px_1fr_360px]">
        {/* 店舗ツリー */}
        <div className="hidden flex-col gap-3 border-r border-ge-paper-3 p-4 md:flex">
          <Bar w="w-28" h="h-4" />
          <Bar h="h-9" />
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 pl-2">
              <div className="size-2 rounded-full bg-ge-paper-3" />
              <Bar w={i % 4 === 0 ? 'w-24' : 'w-40'} />
            </div>
          ))}
        </div>

        {/* 16分割グリッド */}
        <div className="flex flex-col gap-3 p-4">
          <Bar w="w-72" h="h-4" />
          <div className="grid flex-1 grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-ge-paper-3 bg-ge-paper-3 sm:grid-cols-4">
            {Array.from({ length: 16 }).map((_, i) => (
              <div key={i} className="aspect-video animate-pulse bg-ge-paper-2" />
            ))}
          </div>
        </div>

        {/* 店舗詳細 */}
        <div className="hidden flex-col gap-3 border-l border-ge-paper-3 p-4 lg:flex">
          <Bar w="w-32" h="h-4" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Bar key={i} w={i % 2 ? 'w-48' : 'w-full'} />
          ))}
        </div>
      </div>
    </div>
  )
}
