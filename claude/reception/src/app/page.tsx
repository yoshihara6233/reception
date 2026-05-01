import Link from 'next/link'

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0f1a2e] flex flex-col">

      {/* ナビゲーション */}
      <nav className="flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-white/10 rounded-lg flex items-center justify-center">
            <span className="text-white text-xs font-bold">R</span>
          </div>
          <span className="text-white/60 text-sm font-medium">Reception Kiosk</span>
        </div>
        <Link
          href="/admin/dashboard"
          className="text-white/50 text-sm hover:text-white/80 transition-colors"
        >
          管理画面 →
        </Link>
      </nav>

      {/* ヒーローセクション */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">

        {/* バッジ */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 mb-8">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span className="text-white/60 text-xs font-medium">
            小売バックヤード向けセキュリティキオスク
          </span>
        </div>

        {/* メインキャッチ */}
        <h1 className="text-5xl sm:text-6xl font-bold text-white leading-tight mb-4">
          誰が、いつ、
          <br />
          <span className="text-emerald-400">何を持って入ったか。</span>
          <br />
          証拠が残る。
        </h1>

        {/* サブコピー */}
        <p className="text-white/50 text-lg max-w-xl mb-12 leading-relaxed">
          バックヤードの入退室 + 手荷物を写真・映像・顔認証で記録。
          業者・スタッフの持ち込み / 持ち出しを証拠として保全します。
        </p>

        {/* CTAボタン */}
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <Link
            href="/admin/dashboard"
            className="px-8 py-3.5 bg-white text-[#0f1a2e] rounded-xl text-sm font-bold hover:bg-white/90 transition-colors shadow-lg"
          >
            管理画面を開く
          </Link>
          <Link
            href="/r/demo-qr-token-abc123"
            className="px-8 py-3.5 border border-white/20 text-white/70 rounded-xl text-sm font-medium hover:border-white/40 hover:text-white transition-colors"
          >
            デモを試す →
          </Link>
        </div>
      </div>

      {/* 機能ハイライト */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/5 border-t border-white/5">
        {[
          { icon: '📸', label: '手荷物写真', desc: '持ち込み/持ち出しを物的証拠に' },
          { icon: '🎥', label: '映像録画',   desc: '入退室時の全行動を動画で保全' },
          { icon: '🧬', label: '顔認証',     desc: '同一人物の入退室履歴を照合' },
          { icon: '📋', label: 'エビデンス出力', desc: 'PDF一枚で調査・報告に使える' },
        ].map((f) => (
          <div key={f.label} className="bg-[#0f1a2e] px-6 py-5 text-center">
            <div className="text-2xl mb-2">{f.icon}</div>
            <p className="text-white/80 text-sm font-semibold mb-0.5">{f.label}</p>
            <p className="text-white/30 text-xs">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* フッター */}
      <div className="px-8 py-4 border-t border-white/5 flex items-center justify-center">
        <p className="text-white/20 text-xs">
          Reception Kiosk — バックヤード内部不正防止ツール
        </p>
      </div>
    </div>
  )
}
