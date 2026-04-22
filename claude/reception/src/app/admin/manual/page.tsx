'use client'

import { useState } from 'react'
import { useSiteConfig } from '@/lib/site-config'

type Role = 'admin' | 'manager' | 'viewer'

const ROLE_META: Record<Role, { icon: string; label: string; color: string; bg: string }> = {
  admin:   { icon: '👑', label: '管理者',  color: '#1e3a5f', bg: '#e8eef5' },
  manager: { icon: '🏪', label: '店長',    color: '#0d9488', bg: '#e6f7f5' },
  viewer:  { icon: '👁',  label: '閲覧者', color: '#6366f1', bg: '#eef2ff' },
}

// ── 共通コンポーネント ─────────────────────────────────────────────────────────

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-4">
      <h2 className="text-base font-bold text-[#1e3a5f] border-b-2 border-[#1e3a5f]/10 pb-2 mb-4 print:text-sm">
        {title}
      </h2>
      <div className="space-y-3 mb-8">{children}</div>
    </section>
  )
}

function Step({ n, title, desc }: { n: number; title: string; desc?: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#1e3a5f] text-white text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div>
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        {desc && <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p>}
      </div>
    </div>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex gap-2 text-sm text-blue-800">
      <span className="flex-shrink-0 text-base">💡</span>
      <span className="leading-relaxed">{children}</span>
    </div>
  )
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex gap-2 text-sm text-amber-800">
      <span className="flex-shrink-0 text-base">⚠️</span>
      <span className="leading-relaxed">{children}</span>
    </div>
  )
}

function ItemList({ items }: { items: { icon?: string; label: string; desc?: string }[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <span className="flex-shrink-0 text-base leading-5">{item.icon ?? '▸'}</span>
          <span>
            <span className="font-semibold text-gray-800">{item.label}</span>
            {item.desc && <span className="text-gray-500"> — {item.desc}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

// ── コンテンツ ────────────────────────────────────────────────────────────────

function AdminManual({ loc }: { loc: string }) {
  return (
    <>
      <Section id="s-login" title="1. ログイン">
        <Step n={1} title="管理者ポータルへアクセス" desc="ブラウザで管理者URLを開き、メールアドレスとパスワードを入力してログインします。" />
        <Step n={2} title="ダッシュボードが表示されます" desc="ログイン成功後、全体の来訪状況サマリーが自動で表示されます。" />
        <Tip>パスワードを忘れた場合は「パスワードをお忘れですか？」リンクからリセットできます。</Tip>
      </Section>

      <Section id="s-dashboard" title="2. ダッシュボード">
        <ItemList items={[
          { icon: '📊', label: '本日サマリー', desc: '入室中の人数・本日来訪数・未審査手荷物・長時間滞在者を確認できます' },
          { icon: '🚨', label: 'アラートパネル', desc: '手荷物検査率の低下・アンマッチ率上昇などの警告が自動表示されます' },
          { icon: `🏪`, label: `${loc}別ランキング`, desc: `${loc}ごとの来客数・検査率・未承認件数を比較できます` },
          { icon: '📈', label: '推移グラフ', desc: '来訪数・検査率・フラグ件数の時系列変化を確認できます' },
        ]} />
        <Tip>「✏️ レイアウト編集」ボタンでウィジェットの表示/非表示・並び順をカスタマイズできます。</Tip>
      </Section>

      <Section id="s-visits" title="3. 来訪履歴">
        <Step n={1} title="来訪履歴を開く" desc="メニューの「運用」→「来訪履歴」をクリックします。" />
        <Step n={2} title="絞り込み・検索" desc={`名前・会社名・目的・${loc}・日付範囲でフィルタリングできます。`} />
        <Step n={3} title="詳細確認" desc="行をクリックすると来訪者の詳細情報・写真・チェックイン/アウト時刻が確認できます。" />
        <Step n={4} title="CSVエクスポート" desc="「CSVエクスポート」ボタンで絞り込み結果をExcel形式でダウンロードできます。" />
      </Section>

      <Section id="s-baggage" title="4. 手荷物検査">
        <Step n={1} title="手荷物検査を開く" desc="メニューの「運用」→「手荷物検査」をクリックします。" />
        <Step n={2} title="ステータスタブで確認" desc="「要対応」タブで未審査・フラグの申告を確認します。" />
        <Step n={3} title="審査・承認" desc="各件の詳細を確認し「承認」または「フラグ」を設定します。" />
        <Warn>フラグを設定した場合は来訪者対応が必要です。スタッフへの連絡を忘れずに。</Warn>
      </Section>

      <Section id="s-stores" title={`5. ${loc}管理`}>
        <Step n={1} title={`新しい${loc}を登録`} desc={`「${loc}管理」→「+ 新規追加」ボタンから${loc}名・住所を入力します。`} />
        <Step n={2} title="エリアを追加" desc={`${loc}内のエリア（入口・受付など）を追加し、それぞれにQRコードが発行されます。`} />
        <Step n={3} title="QRコードを印刷" desc="エリアの「🖨」ボタンからQRコードを印刷し、受付場所に掲示します。" />
        <Tip>QRコードはいつでも「再発行」できます。古いQRコードは即座に無効になります。</Tip>
      </Section>

      <Section id="s-users" title="6. ユーザー管理">
        <Step n={1} title="ユーザー管理を開く" desc="「設定」→「ユーザー管理」をクリックします。" />
        <Step n={2} title="新規ユーザーを追加" desc="「+ ユーザー追加」ボタンからメールアドレス・名前・権限を設定します。" />
        <ItemList items={[
          { icon: '👑', label: '管理者', desc: '全機能・全データへのアクセス権限' },
          { icon: '🏪', label: '店長',   desc: `担当${loc}のみの参照・設定変更権限` },
          { icon: '👁',  label: '閲覧者', desc: 'データの参照のみ（変更・設定変更は不可）' },
        ]} />
      </Section>

      <Section id="s-settings" title="7. 設定">
        <ItemList items={[
          { icon: '🏷️', label: '拠点の呼び方', desc: '「店舗」「倉庫」など来訪先の呼称をカスタマイズできます' },
          { icon: '📸', label: '受付フロー設定', desc: '名刺撮影・顔写真・手荷物検査の必須/任意/非表示を設定' },
          { icon: '📋', label: '来訪目的', desc: 'チェックイン時の選択肢を追加・削除できます' },
          { icon: '🎥', label: '手荷物検査モード', desc: '写真・動画（i-PRO）の記録方式を入室/退室別に設定' },
        ]} />
      </Section>
    </>
  )
}

function ManagerManual({ loc }: { loc: string }) {
  return (
    <>
      <Section id="s-login" title="1. ログイン">
        <Step n={1} title="管理者ポータルへアクセス" desc="ブラウザで管理者URLを開き、メールアドレスとパスワードを入力してログインします。" />
        <Tip>店長権限では担当する{loc}のデータのみ閲覧・操作できます。他の{loc}のデータは表示されません。</Tip>
      </Section>

      <Section id="s-dashboard" title="2. ダッシュボード">
        <ItemList items={[
          { icon: '📊', label: '本日サマリー', desc: '担当店舗の入室中人数・本日来訪数・未審査手荷物を確認できます' },
          { icon: '🚨', label: 'アラートパネル', desc: '担当店舗に関するアラートが表示されます' },
          { icon: '📈', label: '推移グラフ', desc: '担当店舗の来訪数推移を確認できます' },
        ]} />
      </Section>

      <Section id="s-visits" title="3. 来訪履歴の確認">
        <Step n={1} title="来訪履歴を開く" desc="「運用」→「来訪履歴」をクリックします。" />
        <Step n={2} title="担当店舗の履歴を確認" desc={`自動的に担当${loc}の来訪のみ表示されます。`} />
        <Step n={3} title="詳細を確認" desc="来訪者名・会社・目的・滞在時間などの詳細を確認できます。" />
        <Step n={4} title="CSVエクスポート" desc="「CSVエクスポート」で来訪データをダウンロードできます。" />
      </Section>

      <Section id="s-baggage" title="4. 手荷物検査の審査">
        <Step n={1} title="手荷物検査を開く" desc="「運用」→「手荷物検査」をクリックします。" />
        <Step n={2} title="「要対応」タブを確認" desc="未審査またはフラグのついた申告が表示されます。" />
        <Step n={3} title="申告内容を確認" desc="写真・申告内容・来訪者情報を確認します。" />
        <Step n={4} title="審査を完了" desc="問題なければ「承認」、気になる点があれば「フラグ」を選択します。" />
        <Warn>フラグを設定した場合はスタッフへの連絡・対応が必要です。</Warn>
      </Section>

      <Section id="s-staff" title="5. スタッフ管理">
        <Step n={1} title="スタッフ設定を開く" desc={`「${loc}管理」→ 担当${loc}を選択 → 「スタッフ」タブ`} />
        <Step n={2} title="スタッフを追加" desc="「+ スタッフ追加」から名前・メール・Slack IDを登録します。" />
        <Step n={3} title="スタッフを無効化" desc="退職・異動の際は「無効化」ボタンで通知送信を停止できます。" />
      </Section>

      <Section id="s-settings" title={`6. ${loc}設定の確認`}>
        <ItemList items={[
          { icon: '🔔', label: '通知設定', desc: `担当${loc}のチェックイン通知先（Slack/メール）を確認・変更できます` },
          { icon: '🖨',  label: 'QRコード印刷', desc: `受付QRコードの印刷は「${loc}管理」→ エリアの🖨ボタンから` },
        ]} />
        <Tip>受付フロー設定（名刺・顔写真の要否など）の変更は管理者にご依頼ください。</Tip>
      </Section>
    </>
  )
}

function ViewerManual({ loc }: { loc: string }) {
  return (
    <>
      <Section id="s-login" title="1. ログイン">
        <Step n={1} title="管理者ポータルへアクセス" desc="ブラウザで管理者URLを開き、メールアドレスとパスワードを入力してログインします。" />
        <Tip>閲覧者権限はデータの参照のみです。来訪データの変更・設定の変更はできません。</Tip>
      </Section>

      <Section id="s-dashboard" title="2. ダッシュボード">
        <ItemList items={[
          { icon: '📊', label: '本日サマリー', desc: '入室中人数・本日来訪数・未審査手荷物・長時間滞在者の数を確認できます' },
          { icon: '🚨', label: 'アラートパネル', desc: '検査率低下・未承認件数などの警告が確認できます（対応は店長・管理者が行います）' },
          { icon: '📈', label: '推移グラフ', desc: '来訪数の時系列変化を確認できます' },
        ]} />
      </Section>

      <Section id="s-visits" title="3. 来訪履歴の参照">
        <Step n={1} title="来訪履歴を開く" desc="「運用」→「来訪履歴」をクリックします。" />
        <Step n={2} title="検索・絞り込み" desc={`名前・会社・${loc}・日付で絞り込めます。`} />
        <Step n={3} title="詳細を閲覧" desc="来訪者の情報・写真・滞在時間などを確認できます。" />
        <Tip>CSVエクスポートも利用可能です。機密情報の取り扱いには十分ご注意ください。</Tip>
      </Section>

      <Section id="s-baggage" title="4. 手荷物検査の確認">
        <Step n={1} title="手荷物検査を開く" desc="「運用」→「手荷物検査」をクリックします。" />
        <Step n={2} title="申告一覧を確認" desc="各タブ（審査待ち・承認済み・フラグなど）で状況を確認できます。" />
        <Warn>審査・承認の操作は店長・管理者権限が必要です。気になる件は担当者へご連絡ください。</Warn>
      </Section>

      <Section id="s-limits" title="5. 閲覧者権限の制限">
        <ItemList items={[
          { icon: '🚫', label: '来訪データの変更・削除' },
          { icon: '🚫', label: '手荷物検査の審査・フラグ設定' },
          { icon: '🚫', label: 'ユーザー管理・権限変更' },
          { icon: '🚫', label: '受付フロー・通知設定の変更' },
          { icon: '🚫', label: `${loc}・エリアの登録・変更` },
        ]} />
        <Tip>設定変更が必要な場合は管理者または店長にご依頼ください。</Tip>
      </Section>
    </>
  )
}

// ── メインコンポーネント ────────────────────────────────────────────────────────

export default function ManualPage() {
  const { locationName } = useSiteConfig()
  const [role, setRole] = useState<Role>('admin')

  const meta = ROLE_META[role]

  const sectionsByRole: Record<Role, { id: string; title: string }[]> = {
    admin: [
      { id: 's-login', title: '1. ログイン' },
      { id: 's-dashboard', title: '2. ダッシュボード' },
      { id: 's-visits', title: '3. 来訪履歴' },
      { id: 's-baggage', title: '4. 手荷物検査' },
      { id: 's-stores', title: `5. ${locationName}管理` },
      { id: 's-users', title: '6. ユーザー管理' },
      { id: 's-settings', title: '7. 設定' },
    ],
    manager: [
      { id: 's-login', title: '1. ログイン' },
      { id: 's-dashboard', title: '2. ダッシュボード' },
      { id: 's-visits', title: '3. 来訪履歴' },
      { id: 's-baggage', title: '4. 手荷物検査' },
      { id: 's-staff', title: '5. スタッフ管理' },
      { id: 's-settings', title: `6. ${locationName}設定` },
    ],
    viewer: [
      { id: 's-login', title: '1. ログイン' },
      { id: 's-dashboard', title: '2. ダッシュボード' },
      { id: 's-visits', title: '3. 来訪履歴' },
      { id: 's-baggage', title: '4. 手荷物検査' },
      { id: 's-limits', title: '5. 権限制限' },
    ],
  }

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4; margin: 20mm 15mm; }
          body { font-size: 12px; }
          .print\\:hidden { display: none !important; }
          .no-print { display: none !important; }
          nav, header, aside { display: none !important; }
        }
      `}</style>

      {/* ページヘッダー */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">操作マニュアル</h1>
          <p className="text-sm text-gray-400 mt-0.5">Reception 管理システムの操作手順書</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#1e3a5f] text-white text-sm font-semibold rounded-xl hover:bg-[#2c4f7c] transition-colors shadow-sm"
        >
          <span>🖨️</span>
          PDFで保存
        </button>
      </div>

      {/* ロールタブ */}
      <div className="flex gap-2 mb-6 print:hidden">
        {(Object.entries(ROLE_META) as [Role, typeof ROLE_META[Role]][]).map(([r, m]) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-sm ${
              role === r ? 'text-white' : 'bg-white text-gray-400 hover:text-gray-700'
            }`}
            style={role === r ? { backgroundColor: m.color } : {}}
          >
            {m.icon} {m.label}向け
          </button>
        ))}
      </div>

      {/* 印刷時タイトル */}
      <div className="hidden print:block mb-6">
        <div className="flex items-center gap-3 border-b-2 border-gray-200 pb-4">
          <span className="text-3xl">{meta.icon}</span>
          <div>
            <p className="text-xs text-gray-400">Reception 管理システム 操作マニュアル</p>
            <h1 className="text-xl font-bold" style={{ color: meta.color }}>
              {meta.label}向けマニュアル
            </h1>
          </div>
        </div>
      </div>

      {/* 本文レイアウト */}
      <div className="flex gap-6 items-start max-w-4xl">

        {/* サイドバー目次 */}
        <aside className="hidden lg:block w-48 flex-shrink-0 sticky top-4 print:hidden">
          <div className="bg-white rounded-2xl shadow-sm p-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">目次</p>
            <nav className="space-y-0.5">
              {sectionsByRole[role].map(s => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="block text-xs text-gray-500 hover:text-[#1e3a5f] py-1.5 px-2 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                >
                  {s.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* マニュアル本文 */}
        <div className="flex-1 min-w-0">
          {/* 権限説明バナー */}
          <div
            className="rounded-2xl px-5 py-4 mb-6 print:mb-4 flex items-start gap-3"
            style={{ backgroundColor: meta.bg, border: `1px solid ${meta.color}20` }}
          >
            <span className="text-2xl flex-shrink-0">{meta.icon}</span>
            <div>
              <p className="font-bold text-sm mb-1" style={{ color: meta.color }}>
                {meta.label}（{
                  role === 'admin'   ? 'tenant_admin' :
                  role === 'manager' ? 'store_manager' : 'viewer'
                }）向けマニュアル
              </p>
              <p className="text-xs text-gray-600 leading-relaxed">
                {role === 'admin'   && `全${locationName}・全機能へのアクセス権限があります。システムの管理・設定変更が可能です。`}
                {role === 'manager' && `担当${locationName}のみのデータアクセス権限があります。来訪管理・手荷物審査・スタッフ管理が可能です。`}
                {role === 'viewer'  && `データの閲覧のみ可能です。設定変更・データ修正は管理者または店長にご依頼ください。`}
              </p>
            </div>
          </div>

          {/* 本文カード */}
          <div className="bg-white rounded-2xl shadow-sm px-8 py-6 print:shadow-none print:px-0 print:rounded-none">
            {role === 'admin'   && <AdminManual   loc={locationName} />}
            {role === 'manager' && <ManagerManual loc={locationName} />}
            {role === 'viewer'  && <ViewerManual  loc={locationName} />}

            {/* 印刷フッター */}
            <div className="hidden print:block border-t border-gray-100 pt-4 mt-6 text-xs text-gray-400 text-center">
              Reception 管理システム 操作マニュアル — {meta.label}向け
              <br />ご不明な点は管理者にお問い合わせください。
            </div>
          </div>

          <p className="text-xs text-gray-400 text-center mt-4 print:hidden">
            「PDFで保存」→ 印刷ダイアログで「PDFとして保存」を選択してください
          </p>
        </div>
      </div>
    </>
  )
}
