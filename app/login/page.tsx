"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LayoutGrid, LoaderCircle } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { getBrandConfig, type BrandConfig } from "@/lib/brand";

/**
 * 品牌标：有 logoUrl 用品牌图，没有则回退通用图形图标。
 * - chip：白底圆角芯片 + 内边距（适配白底 PNG，如 FoliaAI 组织头像）
 * - raw ：图片自带完整底色方块，直接裸放 + 细白描边（适配自带圆角方标，如捷配）
 */
function BrandMark({ brand, boxClass }: { brand: BrandConfig; boxClass: string }) {
  const isRaw = brand.logoStyle === "raw";
  const containerClass = brand.logoUrl
    ? isRaw
      ? "ring-1 ring-white/25 shadow-lg"
      : "bg-white"
    : "bg-white/15";

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden ${containerClass} ${boxClass}`}
    >
      {brand.logoUrl ? (
        <img
          src={brand.logoUrl}
          alt=""
          className={`h-full w-full object-contain ${isRaw ? "" : "p-[12%]"}`}
        />
      ) : (
        <LayoutGrid className="h-1/2 w-1/2 text-white" />
      )}
    </div>
  );
}

/**
 * 品牌 Lockup：标志 +（名称 + 可选标语）两排文字，标志与文字块整体对齐。
 * size=lg 用于左侧品牌区，size=sm 用于小屏品牌行。
 */
function BrandLockup({ brand, size }: { brand: BrandConfig; size: "lg" | "sm" }) {
  const hasSlogan = Boolean(brand.slogan);
  const markClass =
    size === "lg"
      ? hasSlogan
        ? "h-14 w-14 rounded-xl"
        : "h-11 w-11 rounded-xl"
      : hasSlogan
        ? "h-12 w-12 rounded-lg"
        : "h-10 w-10 rounded-lg";

  return (
    <div className="flex items-center gap-3">
      <BrandMark brand={brand} boxClass={markClass} />
      <div className="flex min-w-0 flex-col">
        <span
          className={
            size === "lg"
              ? "text-xl font-semibold leading-7 tracking-wide text-white"
              : "text-base font-semibold leading-6 tracking-wide text-foreground"
          }
        >
          {brand.name}
        </span>
        {brand.slogan && (
          <p
            className={
              size === "lg"
                ? "mt-1.5 text-xs leading-4 tracking-wider text-white/80"
                : "mt-1 text-[11px] leading-4 tracking-wider text-muted"
            }
          >
            {brand.slogan}
          </p>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { isAuthenticated, isReady, login } = useAuth();
  const brand = getBrandConfig();
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

        <div className="relative">
          <BrandLockup brand={brand} size="lg" />
        </div>

        <div className="relative max-w-xl">
          <h1
            className="text-5xl font-light leading-tight text-white xl:text-6xl"
          >
            {brand.headline[0]}
          </h1>
          <h1 className="mt-1 text-5xl font-bold leading-tight text-white xl:text-6xl">
            {brand.headline[1]}
          </h1>
          <p className="mt-8 text-[15px] leading-7 text-white/90">
            {brand.description}
          </p>

          <ul className="mt-10 space-y-5">
            {brand.points.map((point) => (
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

        <p className="relative text-sm text-white/75">{brand.copyright}</p>
      </aside>

      {/* ==================== 右侧登录区 ==================== */}
      <main className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-1/2">
        <div className="mx-auto w-full max-w-md">
          {/* 小屏品牌行：左侧品牌区隐藏时保持品牌存在 */}
          <div className="mb-10 lg:hidden">
            <BrandLockup brand={brand} size="sm" />
          </div>

          <h2 className="text-4xl font-bold text-foreground">欢迎登录</h2>
          <p className="mt-3 text-base text-muted">
            使用 {brand.idpLabel} 账号访问 {brand.name}
          </p>

          <div className="mt-10 border-t border-hairline" />

          <div className="mt-10 space-y-4">
            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
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
                <BrandMark brand={brand} boxClass="h-6 w-6 rounded-md" />
              )}
              {isSubmitting ? "正在跳转..." : `使用 ${brand.idpLabel} 账号登录`}
            </button>

            <p className="text-center text-xs text-muted-subtle">
              {brand.trustLine}
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
