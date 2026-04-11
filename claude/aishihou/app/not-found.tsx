import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ページが見つかりません | 司法書士 あい法務事務所",
};

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-[#f7faff]">
      {/* Simple header */}
      <header className="bg-white border-b-2 border-[#2c4a7c] px-6 py-4">
        <Link href="/">
          <p className="text-xl font-black text-[#2c4a7c] leading-tight hover:opacity-75 transition-opacity inline-block">
            司法書士 あい法務事務所
          </p>
        </Link>
      </header>

      {/* 404 content */}
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <p className="text-7xl font-black text-[#2c4a7c] mb-4">404</p>
          <h1 className="text-xl font-black text-[#1a2744] mb-3">
            ページが見つかりません
          </h1>
          <p className="text-sm text-gray-600 leading-relaxed mb-8">
            お探しのページは移動または削除された可能性があります。<br />
            トップページからご確認ください。
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 bg-[#2c4a7c] hover:bg-[#1a2f5e] text-white font-bold px-6 py-3 rounded-full transition-colors"
            >
              トップページへ戻る
            </Link>
            <Link
              href="/#contact"
              className="inline-flex items-center justify-center gap-2 border-2 border-[#2c4a7c] text-[#2c4a7c] font-bold px-6 py-3 rounded-full hover:bg-[#2c4a7c] hover:text-white transition-colors"
            >
              無料相談はこちら
            </Link>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t border-blue-100 py-4 text-center">
        <p className="text-xs text-gray-400">
          © {new Date().getFullYear()} 司法書士 あい法務事務所. All Rights Reserved.
        </p>
      </footer>
    </div>
  );
}
