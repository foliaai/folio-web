"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LockedFeatureScreen } from "@/components/common/LockedFeatureScreen";
import { useAuth } from "@/components/auth/AuthProvider";

/**
 * / — 首页
 *
 * 未登录：自动跳转 /login（携带 next 回跳）。
 * 已登录：当前阶段首页整体锁定（敬请期待），引导前往「知识库」与「技能」。
 */
export default function HomePage() {
  const { isAuthenticated, isReady } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace("/login?next=%2F");
    }
  }, [isReady, isAuthenticated, router]);

  // 会话状态就绪前不渲染，避免锁定页在已登录用户面前闪现
  if (!isReady || !isAuthenticated) {
    return <div className="min-h-screen bg-gray-50" />;
  }

  return <LockedFeatureScreen featureLabel="首页" />;
}
