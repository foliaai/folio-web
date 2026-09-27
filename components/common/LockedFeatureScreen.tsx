"use client";

import Link from "next/link";
import { LockKeyhole, LogIn, Sparkles } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useAuthModal } from "@/components/auth/AuthModalProvider";

interface LockedFeatureScreenProps {
  /** 特性展示名，如「首页」「Agent应用」 */
  featureLabel: string;
  /** 一句话副标题，默认「敬请期待」 */
  subtitle?: string;
  /** 首段说明文案，默认「该模块正在打磨中，暂未开放使用。」 */
  description?: string;
}

/**
 * 始终锁定（敬请期待）的全屏卡片。
 *
 * 用于「登录前后都不可用」的特性（首页 / Agent应用）：
 *   - 未登录：展示登录 CTA
 *   - 已登录：提示已登录，引导去知识库 / 技能
 */
export function LockedFeatureScreen({
  featureLabel,
  subtitle = "敬请期待",
  description,
}: LockedFeatureScreenProps) {
  const { isAuthenticated } = useAuth();
  const { openAuthModal } = useAuthModal();

  return (
    <div className="relative min-h-screen overflow-hidden px-6 py-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,179,107,0.08),transparent_35%)]" />
      <div className="relative z-10 mx-auto flex min-h-[80vh] max-w-xl flex-col items-center justify-center text-center">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 text-primary-light">
          <LockKeyhole className="h-7 w-7" />
        </div>
        <h1 className="mt-6 bg-gradient-to-r from-foreground to-primary bg-clip-text text-4xl font-light tracking-wide text-transparent">
          {featureLabel}
        </h1>
        <p className="mt-2 text-sm text-primary-light/90">{subtitle}</p>
        <p className="mt-4 max-w-md text-sm leading-7 text-muted">
          {description ?? "该模块正在打磨中，暂未开放使用。"}
          {isAuthenticated
            ? "你可以先使用左侧的「知识库」与「技能」继续你的工作。"
            : "登录后可先使用「知识库」与「技能」模块。"}
        </p>

        {isAuthenticated ? (
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/knowledge"
              className="inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-primary-light"
            >
              <Sparkles className="h-4 w-4" />
              进入知识库
            </Link>
            <Link
              href="/skills"
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm text-foreground transition hover:bg-gray-50 shadow-xs"
            >
              <Sparkles className="h-4 w-4" />
              进入技能
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={() =>
              openAuthModal({
                title: "登录后解锁更多能力",
                description:
                  "「" + featureLabel + "」暂未开放，登录后可先使用「知识库」与「技能」模块。",
                featureLabel,
              })
            }
            className="mt-7 inline-flex items-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-primary-light"
          >
            <LogIn className="h-4 w-4" />
            登录 / 注册
          </button>
        )}
      </div>
    </div>
  );
}
