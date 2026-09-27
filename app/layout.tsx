import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { AuthModalProvider } from "@/components/auth/AuthModalProvider";
import { AppShell } from "@/components/layout/AppShell";
import { getAuthProviderName } from "@/lib/auth-providers";

// 标签页小图标随部署品牌切换：捷配内网用无极方标，公网用 FoliaAI 头像
const faviconUrl =
  getAuthProviderName() === "oa"
    ? "/brand/jiepei-favicon.png"
    : "/brand/foliaai.png";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#FFFFFF",
};

export const metadata: Metadata = {
  title: "FoliaAI",
  description: "以知识为源，让效率生长",
  icons: {
    icon: [
      { url: faviconUrl, type: "image/png" },
    ],
    apple: [
      { url: faviconUrl, type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-full overflow-x-hidden antialiased">
        <AuthProvider>
          <AuthModalProvider>
            <AppShell>{children}</AppShell>
          </AuthModalProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
