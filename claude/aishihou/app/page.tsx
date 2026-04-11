"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const TEL = "06-4256-7878";
const TEL_HREF = `tel:${TEL.replace(/-/g, "")}`;
const CONTACT_EMAIL = "npo@ai-shiho-shoshi.jp";
const MAIL_HREF = `mailto:${CONTACT_EMAIL}`;

// ---- Header ----
function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-shadow duration-300 ${
        scrolled ? "shadow-md" : ""
      } bg-white`}
    >
      {/* Desktop */}
      <div className="hidden md:flex items-stretch justify-between border-b-2 border-[#2c4a7c] px-6">
        <div className="flex items-center py-4">
          <Link href="/">
            <p className="text-xl font-black text-[#2c4a7c] leading-tight hover:opacity-75 transition-opacity">司法書士 あい法務事務所</p>
            <p className="text-xs text-gray-500 mt-0.5">大阪の相続・借金問題専門</p>
          </Link>
        </div>

        <nav className="flex items-center gap-6 px-4">
          {[
            { href: "#services", label: "業務内容" },
            { href: "#flow", label: "ご相談の流れ" },
            { href: "/profile", label: "代表プロフィール" },
            { href: "#about", label: "事務所案内" },
            { href: "#access", label: "アクセス" },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-gray-600 hover:text-[#2c4a7c] font-medium transition-colors"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <a
          href={TEL_HREF}
          className="flex flex-col items-center justify-center bg-[#2c4a7c] text-white px-8 py-3 hover:bg-[#1a2f5e] transition-colors"
        >
          <span className="text-xs mb-0.5">📞 お気軽にご相談ください</span>
          <span className="text-xl font-black tracking-wide">{TEL}</span>
          <span className="text-[10px] text-blue-200 mt-0.5">平日9:00〜18:00 / 土日祝対応可</span>
        </a>
      </div>

      {/* Mobile */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b-2 border-[#2c4a7c]">
        <Link href="/">
          <p className="text-lg font-black text-[#2c4a7c] leading-tight hover:opacity-75 transition-opacity">司法書士 あい法務事務所</p>
        </Link>
        <div className="flex items-center gap-3">
          <a
            href={TEL_HREF}
            className="bg-[#2c4a7c] text-white text-xs px-3 py-2 rounded font-bold"
          >
            📞 {TEL}
          </a>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="text-gray-600 p-1"
            aria-label="メニュー"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav className="md:hidden bg-white border-b border-gray-200 px-4 py-2">
          {[
            { href: "#services", label: "業務内容" },
            { href: "#flow", label: "ご相談の流れ" },
            { href: "/profile", label: "代表プロフィール" },
            { href: "#about", label: "事務所案内" },
            { href: "#access", label: "アクセス" },
            { href: "#contact", label: "無料相談" },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              className="block py-3 text-sm text-gray-700 border-b border-gray-100 last:border-0"
            >
              {item.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}

// ---- Hero ----
function Hero() {
  return (
    <section className="pt-[72px] md:pt-[88px] bg-gradient-to-br from-[#eef3fb] via-[#f5f8ff] to-[#fff8ee]">
      <div className="max-w-6xl mx-auto px-4 py-14 md:py-20 grid md:grid-cols-2 gap-10 items-center">
        <div>
          <span className="inline-block bg-[#d4a853] text-white text-xs font-bold px-4 py-1.5 rounded-full mb-5">
            ✅ 初回相談 完全無料
          </span>
          <h1 className="text-3xl md:text-4xl font-black text-[#1a2744] leading-relaxed mb-5">
            はじめての方も、<br />
            <span className="text-[#2c4a7c]">安心してご相談ください。</span>
          </h1>
          <p className="text-base text-gray-600 leading-loose mb-8">
            相続のこと、借金のこと、不動産のこと…<br />
            「誰に聞けばいいかわからない」という方も大歓迎。<br />
            司法書士がやさしく丁寧にご説明します。
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <a
              href="#contact"
              className="inline-flex items-center justify-center gap-2 bg-[#d4a853] hover:bg-[#b8922e] text-white font-black text-lg px-8 py-4 rounded-full shadow-lg transition-colors"
            >
              無料相談を予約する →
            </a>
            <a
              href={TEL_HREF}
              className="inline-flex items-center justify-center gap-2 border-2 border-[#2c4a7c] text-[#2c4a7c] font-black text-lg px-8 py-4 rounded-full hover:bg-[#2c4a7c] hover:text-white transition-colors"
            >
              📞 {TEL}
            </a>
          </div>
        </div>

        <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-[#dde8f5] to-[#c8d8ef] h-64 md:h-80 flex items-center justify-center">
          <div className="text-center">
            <div className="text-6xl mb-3">🤝</div>
            <p className="text-[#2c4a7c] text-sm font-medium">丁寧な相談対応</p>
          </div>
          <div className="absolute bottom-4 right-4 bg-white/80 rounded-lg px-3 py-2 text-xs text-gray-600">
            出張・オンライン相談も対応
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- Trust Bar ----
function TrustBar() {
  const stats = [
    { num: "500", unit: "件以上", label: "累計相談件数" },
    { num: "98", unit: "%", label: "ご依頼後の解決率" },
    { num: "15", unit: "年", label: "豊富な実務経験" },
    { num: "0", unit: "円", label: "初回相談料" },
  ];
  return (
    <div className="bg-[#2c4a7c] py-6">
      <div className="max-w-4xl mx-auto px-4 grid grid-cols-2 md:grid-cols-4">
        {stats.map((s, i) => (
          <div
            key={i}
            className="text-center py-4 border-r border-white/20 last:border-0"
          >
            <p className="text-3xl font-black text-[#d4a853] leading-none">
              {s.num}
              <span className="text-lg">{s.unit}</span>
            </p>
            <p className="text-xs text-blue-200 mt-1">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Services ----
function Services() {
  const services = [
    {
      icon: "⚖️",
      title: "相続・遺産分割",
      desc: "親が亡くなって何から始めればよいか…名義変更・遺産分割協議書など、相続手続き全般をサポートします。",
      href: "/services/souzoku",
    },
    {
      icon: "📜",
      title: "遺言書・後見",
      desc: "「老後が心配」「財産を子供に残したい」遺言書作成や任意後見・法定後見の手続きをお手伝いします。",
      href: "/services/yuigon",
    },
    {
      icon: "💰",
      title: "借金・債務整理",
      desc: "返済が苦しい、督促が来ている…任意整理・個人再生・自己破産から最適な方法を提案します。",
      href: "/services/saimu",
    },
    {
      icon: "🏠",
      title: "不動産登記",
      desc: "売買・相続・贈与による所有権移転登記、抵当権の設定・抹消登記を迅速に対応します。",
      href: "/services/fudosan",
    },
  ];

  return (
    <section id="services" className="py-16 bg-[#f7faff]">
      <div className="max-w-5xl mx-auto px-4">
        <p className="text-xs font-bold text-[#d4a853] tracking-widest mb-2">SERVICES</p>
        <h2 className="text-2xl md:text-3xl font-black text-[#1a2744] mb-10 leading-snug">
          こんなお悩み、<br className="md:hidden" />ご相談ください
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {services.map((s, i) => (
            <div
              key={i}
              className="bg-white rounded-2xl p-7 shadow-sm border border-blue-50 hover:shadow-md hover:border-blue-200 transition-all"
            >
              <div className="text-4xl mb-4">{s.icon}</div>
              <h3 className="text-lg font-black text-[#1a2744] mb-2">{s.title}</h3>
              <p className="text-sm text-gray-600 leading-relaxed mb-4">{s.desc}</p>
              <Link href={s.href} className="text-sm font-bold text-[#2c4a7c] hover:underline">
                詳しく見る →
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---- Flow ----
function Flow() {
  const steps = [
    {
      num: "1",
      title: "お電話またはメールでご連絡",
      desc: "「まず話を聞いてほしい」だけでも構いません。お気軽にご連絡ください。ご都合に合わせて日程を調整します。",
    },
    {
      num: "2",
      title: "無料相談（対面・オンライン・出張）",
      desc: "状況を詳しくお聞きし、最適な解決策をご提案します。初回は完全無料。秘密厳守です。",
    },
    {
      num: "3",
      title: "費用のご説明・ご依頼",
      desc: "費用を明確にお伝えします。ご納得いただいてからのご依頼なので安心です。",
    },
    {
      num: "4",
      title: "手続き開始・解決へ",
      desc: "迅速・丁寧に対応します。進捗はこまめにご報告しますのでご安心ください。",
    },
  ];

  return (
    <section id="flow" className="py-16">
      <div className="max-w-3xl mx-auto px-4">
        <p className="text-xs font-bold text-[#d4a853] tracking-widest mb-2">FLOW</p>
        <h2 className="text-2xl md:text-3xl font-black text-[#1a2744] mb-10 leading-snug">
          ご相談から解決まで、<br />4つのステップ
        </h2>
        <div className="flex flex-col">
          {steps.map((s, i) => (
            <div key={i} className="flex gap-5 pb-8 last:pb-0">
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 rounded-full bg-[#2c4a7c] text-white flex items-center justify-center text-xl font-black flex-shrink-0">
                  {s.num}
                </div>
                {i < steps.length - 1 && (
                  <div className="w-0.5 flex-1 bg-blue-100 mt-2 min-h-8" />
                )}
              </div>
              <div className="pt-2 pb-8 last:pb-0">
                <h3 className="text-base font-black text-[#1a2744] mb-2">{s.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---- About ----
function About() {
  return (
    <section id="about" className="py-16 bg-[#f7faff]">
      <div className="max-w-5xl mx-auto px-4">
        <p className="text-xs font-bold text-[#d4a853] tracking-widest mb-2">ABOUT</p>
        <h2 className="text-2xl md:text-3xl font-black text-[#1a2744] mb-10 leading-snug">
          事務所案内
        </h2>
        <div className="grid md:grid-cols-2 gap-10 items-start">
          {/* 事務所紹介 */}
          <div>
            <div className="bg-white rounded-2xl p-7 border border-blue-50 shadow-sm mb-6">
              <h3 className="font-black text-[#1a2744] text-lg mb-4 pb-3 border-b border-blue-50">
                司法書士 あい法務事務所
              </h3>
              <dl className="flex flex-col gap-3 text-sm">
                {[
                  { label: "代表司法書士", value: "松井 勇ニ" },
                  { label: "登録番号", value: "大阪司法書士会 第3268号" },
                  { label: "簡易認定番号", value: "第712111号" },
                  { label: "所属", value: "大阪司法書士会 / 簡裁訴訟代理等関係業務認定" },
                  { label: "従業員数", value: "理事3名 / 監事1名 / 社員10名" },
                  { label: "TEL", value: "06-4256-7878" },
                  { label: "FAX", value: "06-4256-8983" },
                  { label: "メール", value: "info@ai-shiho-shoshi.jp" },
                  { label: "受付時間", value: "平日 9:00〜18:00（土日祝応相談）" },
                ].map(({ label, value }) => (
                  <div key={label} className="grid grid-cols-[7rem_1fr] gap-2">
                    <dt className="text-gray-500 font-medium">{label}</dt>
                    <dd className="text-[#1a2744] font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* 特徴 */}
            <div className="bg-white rounded-2xl p-7 border border-blue-50 shadow-sm">
              <h3 className="font-black text-[#1a2744] mb-4">当事務所の特徴</h3>
              <ul className="flex flex-col gap-3">
                {[
                  { icon: "💬", text: "初回相談無料・秘密厳守。「まず話を聞いてほしい」だけでも歓迎です。" },
                  { icon: "🚗", text: "出張相談対応。ご自宅・病院・施設へ訪問します（大阪府内・周辺地域）。" },
                  { icon: "💻", text: "オンライン相談（Zoom・LINEビデオ）にも対応しています。" },
                  { icon: "📋", text: "費用は事前に明確にご提示。ご納得いただいてからのご依頼です。" },
                  { icon: "⚡", text: "オンライン申請を活用し、不動産登記を迅速に処理します。" },
                ].map(({ icon, text }, i) => (
                  <li key={i} className="flex gap-3 items-start text-sm text-gray-600">
                    <span className="text-xl flex-shrink-0">{icon}</span>
                    <span className="leading-relaxed">{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 取扱業務 */}
          <div>
            <div className="bg-white rounded-2xl p-7 border border-blue-50 shadow-sm">
              <h3 className="font-black text-[#1a2744] mb-4">取扱業務</h3>
              <div className="flex flex-col gap-2">
                {[
                  { category: "相続・遺言", items: ["相続人調査・戸籍収集", "遺産分割協議書作成", "相続登記", "相続放棄申立て", "遺言書作成（公正証書・自筆）"] },
                  { category: "成年後見", items: ["任意後見契約書作成", "法定後見申立て", "後見人業務（継続サポート）"] },
                  { category: "借金・債務整理", items: ["任意整理", "個人再生", "自己破産", "過払い金返還請求"] },
                  { category: "不動産登記", items: ["売買・相続・贈与による所有権移転", "抵当権設定・抹消", "住所・氏名変更登記"] },
                  { category: "商業・法人登記", items: ["会社設立", "役員変更", "本店移転"] },
                ].map(({ category, items }) => (
                  <div key={category} className="border-b border-blue-50 last:border-0 pb-3 last:pb-0 mb-1">
                    <p className="text-xs font-black text-[#2c4a7c] mb-1.5">{category}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {items.map((item) => (
                        <span key={item} className="text-xs bg-blue-50 text-gray-600 px-2 py-0.5 rounded-full">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- Access ----
function Access() {
  return (
    <section id="access" className="py-16 bg-white">
      <div className="max-w-5xl mx-auto px-4">
        <p className="text-xs font-bold text-[#d4a853] tracking-widest mb-2">ACCESS</p>
        <h2 className="text-2xl md:text-3xl font-black text-[#1a2744] mb-10 leading-snug">
          アクセス
        </h2>
        <div className="grid md:grid-cols-2 gap-8 items-start">
          {/* 地図 */}
          <div className="rounded-2xl overflow-hidden border border-blue-100 shadow-sm aspect-video md:aspect-auto md:h-80">
            <iframe
              src="https://maps.google.com/maps?q=%E5%A4%A7%E9%98%AA%E9%A7%85%E5%89%8D%E7%AC%AC%E4%B8%80%E3%83%93%E3%83%AB&hl=ja&z=17&output=embed"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              title="事務所アクセスマップ"
            />
          </div>

          {/* 住所・アクセス情報 */}
          <div className="flex flex-col gap-4">
            <div className="bg-[#f7faff] rounded-2xl p-6 border border-blue-50">
              <h3 className="font-black text-[#1a2744] mb-4">事務所所在地</h3>
              <address className="not-italic text-sm text-gray-700 leading-loose">
                <p className="font-bold text-base text-[#1a2744] mb-2">司法書士 あい法務事務所</p>
                〒530-0001<br />
                大阪市北区梅田1丁目3番1-700号<br />
                大阪駅前第一ビル7階10-1号室<br />
                <a href={`tel:0642567878`} className="font-bold text-[#2c4a7c] mt-2 inline-block">
                  TEL: 06-4256-7878
                </a>
              </address>
            </div>

            <div className="bg-[#f7faff] rounded-2xl p-6 border border-blue-50">
              <h3 className="font-black text-[#1a2744] mb-4">交通アクセス</h3>
              <ul className="flex flex-col gap-3 text-sm">
                {[
                  { icon: "🚃", line: "JR「大阪駅」", detail: "中央南口より徒歩約3分" },
                  { icon: "🚇", line: "大阪メトロ四つ橋線「西梅田駅」", detail: "より徒歩約2分" },
                  { icon: "🚇", line: "阪神電車「大阪梅田駅」", detail: "より徒歩約2分" },
                  { icon: "🚃", line: "JR東西線「北新地駅」", detail: "より徒歩約3分" },
                  { icon: "🚗", line: "お車でお越しの方", detail: "大阪駅前第一ビル地下駐車場をご利用ください" },
                ].map(({ icon, line, detail }) => (
                  <li key={line} className="flex items-start gap-3">
                    <span className="text-xl flex-shrink-0">{icon}</span>
                    <div>
                      <p className="font-bold text-[#1a2744]">{line}</p>
                      <p className="text-gray-600">{detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-[#f7faff] rounded-2xl p-6 border border-blue-50">
              <h3 className="font-black text-[#1a2744] mb-3">営業時間</h3>
              <div className="flex flex-col gap-2 text-sm">
                {[
                  { day: "平日（月〜金）", time: "9:00〜18:00" },
                  { day: "土曜・日曜・祝日", time: "応相談" },
                ].map(({ day, time }) => (
                  <div key={day} className="flex justify-between items-center border-b border-blue-100 last:border-0 pb-2 last:pb-0">
                    <span className="text-gray-600">{day}</span>
                    <span className="font-bold text-[#2c4a7c]">{time}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-3">
                ※ 事前にご予約いただければ時間外・休日も対応可能な場合があります。
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- Contact ----
function Contact() {
  return (
    <section
      id="contact"
      className="py-16 bg-gradient-to-br from-[#2c4a7c] to-[#1a2f5e]"
    >
      <div className="max-w-4xl mx-auto px-4">
        <p className="text-xs font-bold text-[#d4a853] tracking-widest mb-2">CONTACT</p>
        <h2 className="text-2xl md:text-3xl font-black text-white mb-3 leading-snug">
          まずは無料でご相談ください
        </h2>
        <p className="text-blue-200 mb-10 text-sm">
          秘密厳守 / 相談料無料 / 出張相談対応可 / オンライン相談OK
        </p>

        <div className="grid md:grid-cols-3 gap-4">
          <a
            href={TEL_HREF}
            className="flex flex-col gap-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl p-6 transition-colors"
          >
            <div className="text-3xl">📞</div>
            <p className="text-xs text-blue-200">お電話</p>
            <p className="text-xl font-black text-[#d4a853] tracking-wide">{TEL}</p>
            <p className="text-xs text-blue-300">平日 9:00〜18:00 / 土日祝対応可</p>
          </a>
          <a
            href={MAIL_HREF}
            className="flex flex-col gap-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl p-6 transition-colors min-w-0"
          >
            <div className="text-3xl">✉️</div>
            <p className="text-xs text-blue-200">メール相談（24時間受付）</p>
            <p className="text-sm font-bold text-[#d4a853] break-all">{CONTACT_EMAIL}</p>
            <p className="text-xs text-blue-300">1営業日以内にご返信します</p>
          </a>
          <div className="flex flex-col gap-2 bg-white/10 border border-white/20 rounded-2xl p-6">
            <div className="text-3xl">🚗</div>
            <p className="text-xs text-blue-200">出張相談</p>
            <p className="text-sm font-bold text-white">ご自宅・病院・施設へ訪問</p>
            <p className="text-xs text-blue-300">大阪府内・周辺地域対応</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---- Footer ----
function Footer() {
  return (
    <footer className="bg-[#f0f4fb] border-t border-blue-100 py-10">
      <div className="max-w-5xl mx-auto px-4">
        <div className="grid md:grid-cols-3 gap-8 mb-8">
          <div>
            <p className="text-xl font-black text-[#2c4a7c] mb-2">司法書士 あい法務事務所</p>
            <p className="text-sm text-gray-600 leading-relaxed">
              大阪の相続・遺言・債務整理・<br />
              不動産登記専門の司法書士事務所です。
            </p>
          </div>
          <div>
            <p className="font-bold text-[#1a2744] mb-3 text-sm">取扱業務</p>
            <ul className="flex flex-col gap-1.5">
              {[
                { href: "/services/souzoku", label: "相続・遺産分割" },
                { href: "/services/yuigon", label: "遺言書・後見" },
                { href: "/services/saimu", label: "借金・債務整理" },
                { href: "/services/fudosan", label: "不動産登記" },
              ].map((s) => (
                <li key={s.href}>
                  <Link href={s.href} className="text-sm text-gray-600 hover:text-[#2c4a7c]">
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-bold text-[#1a2744] mb-3 text-sm">事務所情報</p>
            <address className="not-italic text-sm text-gray-600 leading-relaxed">
              〒530-0001<br />
              大阪市北区梅田1丁目3番1-700号<br />
              大阪駅前第一ビル7階10-1号室<br />
              <a href={TEL_HREF} className="font-bold text-[#2c4a7c]">
                TEL: {TEL}
              </a><br />
              平日 9:00〜18:00
            </address>
            <p className="text-xs text-gray-500 mt-2">大阪司法書士会所属</p>
          </div>
        </div>
        <div className="border-t border-blue-100 pt-6 text-center">
          <p className="text-xs text-gray-400">
            © {new Date().getFullYear()} 司法書士 あい法務事務所. All Rights Reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

// ---- Page ----
export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <TrustBar />
        <Services />
        <Flow />
        <About />
        <Access />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
