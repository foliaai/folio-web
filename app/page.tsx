"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { AgentChatPanel } from "@/components/agent/AgentChatPanel";

/**
 * / — 首页：通用智能体入口
 *
 * 未登录：自动跳转 /login（携带 next 回跳）。
 * 已登录：通用 agent 对话面板（模型选择 + 思考档位 + 工具轨迹，
 * 后端为 folio-agent-server /api/v1，经 Caddy 网关）。
 */
export default function HomePage() {
  const { isAuthenticated, isReady } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace("/login?next=%2F");
    }
  }, [isReady, isAuthenticated, router]);

  // 会话状态就绪前不渲染，避免登录页闪现
  if (!isReady || !isAuthenticated) {
    return <div className="min-h-screen bg-dark" />;
  }

  return <AgentChatPanel />;
}
