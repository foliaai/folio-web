"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { useAuth } from "@/components/auth/AuthProvider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { isReady } = useAuth();

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-dark text-sm text-muted">
        正在检查登录状态...
      </div>
    );
  }

  if (pathname === "/login" || pathname === "/callback") {
    return <main>{children}</main>;
  }

  return (
    <>
      <Sidebar />
      <main className="ml-0 md:ml-[84px] pb-14 md:pb-0 min-h-[100dvh] md:min-h-screen">
        {children}
      </main>
    </>
  );
}
