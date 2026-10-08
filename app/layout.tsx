import type { Metadata } from "next";
import "./moqi.css";

export const metadata: Metadata = {
  title: "默契好友 · 把日常变成默契",
  description: "为朋友出一份专属测试，发现彼此的默契。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
