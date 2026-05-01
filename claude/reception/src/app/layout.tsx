import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Reception Kiosk — 証拠が残る。",
  description: "バックヤードの入退室・手荷物を写真・映像・顔認証で記録。業者・スタッフの持ち込み/持ち出しを証拠として保全する内部不正防止ツール。",
  manifest: "/manifest.json",
  themeColor: "#0f1a2e",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "受付",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
