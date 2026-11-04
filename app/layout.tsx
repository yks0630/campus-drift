import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "极速热场 · 校园漂移赛",
  description: "把手机变成方向盘。60 秒竖屏体感赛车，漂移、氮气与全场实时排位。",
  icons: {
    icon: "/assets/racing/car_yellow_1.png",
    shortcut: "/assets/racing/car_yellow_1.png",
  },
};

export const viewport: Viewport = {width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#121f30"};

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
