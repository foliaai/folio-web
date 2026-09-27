"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, LoaderCircle } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { getAuthProviderLabel, getAuthProviderName } from "@/lib/auth-providers";

// 左侧品牌区卖点（与平台规划一致：统一入口 / 知识库 / 技能 / 治理）
const BRAND_POINTS = [
  "企业身份统一登录，无需注册",
  "知识库统一管理，文档检索与智能问答",
  "技能中心，可复用的 AI 能力编排",
  "RBAC 角色权限，全链路登录审计",
];

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, isReady, login } = useAuth();
  const providerLabel = getAuthProviderLabel();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nextPath, setNextPath] = useState("/");

  useEffect(() => {
    const next =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("next") || "/"
        : "/";
    setNextPath(next);
  }, []);

  useEffect(() => {
    if (isReady && isAuthenticated) {
      router.replace(nextPath);
    }
  }, [isAuthenticated, isReady, nextPath, router]);

  const handleLogin = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      await login(nextPath);
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "跳转登录失败，请重试"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-white">
      {/* ==================== 左侧品牌区（大屏显示） ==================== */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-primary-deep p-12 xl:p-16 lg:flex">
        {/* 装饰光斑：primary-light 在深绿底上做出渐变层次 */}
        <div className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-primary-light/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 -left-24 h-[26rem] w-[26rem] rounded-full bg-primary/50 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
            <LayoutGrid className="h-6 w-6 text-white" />
          </div>
          <span className="text-xl font-semibold tracking-wide text-white">
            Folio
          </span>
        </div>

        <div className="relative max-w-xl">
          <h1 className="text-5xl font-light leading-tight text-white xl:text-6xl">
            统一入口
          </h1>
          <h1 className="mt-1 text-5xl font-bold leading-tight text-white xl:text-6xl">
            AI 知识底座
          </h1>
          <p className="mt-8 text-[15px] leading-7 text-white/90">
            知识库、技能与 Agent
            的统一使用入口，可管控、可审计，保障数据安全合规。
          </p>

          <ul className="mt-10 space-y-5">
            {BRAND_POINTS.map((point) => (
              <li key={point} className="flex items-center gap-3">
                <span
                  className="h-2 w-2 shrink-0 bg-white/70"
                  aria-hidden="true"
                />
                <span className="text-[15px] leading-6 text-white/90">
                  {point}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-white/75">
          FolioAI © 2026 · Folio 平台 MVP v0.1
        </p>
      </aside>

      {/* ==================== 右侧登录区 ==================== */}
      <main className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-1/2">
        <div className="mx-auto w-full max-w-md">
          {/* 小屏品牌行：左侧品牌区隐藏时保持品牌存在 */}
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-deep">
              <LayoutGrid className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-semibold tracking-wide text-foreground">
              Folio
            </span>
          </div>

          <h2 className="text-4xl font-bold text-foreground">欢迎登录</h2>
          <p className="mt-3 text-base text-muted">
            使用 {providerLabel} 账号访问 Folio
          </p>

          <div className="mt-10 border-t border-hairline" />

          <div className="mt-10 space-y-4">
            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            {getAuthProviderName() === "oa" &&
              !process.env.NEXT_PUBLIC_OA_SSO_LOGOUT_URL && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                  <p className="font-medium">更换账号登录？</p>
                  <p className="mt-1">
                    OA
                    授权状态由浏览器保留，直接点击登录会免扫码恢复为原账号。换人请任选其一：
                  </p>
                  <p className="mt-1">
                    ① 用无痕窗口打开本系统，扫码即新账号； ② 按 F12 → 应用 →
                    Cookie，删除 jiepei.com 下的 WuJiAppAuthbtns
                    后再点登录； ③ 先在无极 OA 中退出登录。
                  </p>
                </div>
              )}

            <button
              type="button"
              onClick={handleLogin}
              disabled={isSubmitting || !isReady}
              className="flex h-14 w-full items-center justify-center gap-3 rounded-lg bg-primary px-4 text-base font-medium text-white transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? (
                <LoaderCircle className="h-5 w-5 animate-spin" />
              ) : (
                <LayoutGrid className="h-5 w-5" />
              )}
              {isSubmitting
                ? "正在跳转..."
                : `使用 ${providerLabel} 账号登录`}
            </button>

            <p className="text-center text-xs text-muted-subtle">
              会话加密传输，符合企业安全合规要求
            </p>
          </div>

          <div className="mt-10 border-t border-hairline" />

          <p className="mt-8 text-sm leading-6 text-muted-subtle">
            登录即表示同意
            <span className="font-medium text-foreground">使用规范</span> 与
            <span className="font-medium text-foreground">隐私政策</span>
            。如需帮助请查看
            <Link
              href="/help"
              className="font-medium text-primary-deep underline-offset-2 hover:underline"
            >
              帮助中心
            </Link>
            。
          </p>
        </div>
      </main>
    </div>
  );
}
