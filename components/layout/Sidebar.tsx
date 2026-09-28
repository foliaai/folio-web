"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Settings,
  HelpCircle,
  Home,
  LogOut,
  Lock,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { ProfileDrawer } from "./ProfileDrawer";
import { useAuth } from "@/components/auth/AuthProvider";
import { useUserProfile } from "@/lib/hooks/useUserProfile";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { FEATURES, type FeatureConfig } from "@/lib/features";

export const Sidebar = () => {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [showProfile, setShowProfile] = useState(false);
  const { isAuthenticated, logout, user } = useAuth();
  const { userId, avatarUrl } = useUserProfile();

  /** 未登录的统一入口：直跳登录页（带 next 回跳），不再弹登录弹窗 */
  const goToLogin = (next: string) => {
    router.push(`/login?next=${encodeURIComponent(next)}`);
  };

  const handleAvatarClick = () => {
    if (!isAuthenticated) {
      goToLogin(pathname);
      return;
    }
    setShowProfile(true);
  };

  /**
   * 锁定项点击：未登录去登录页；已登录的「敬请期待」项保持锁定（不弹窗）。
   */
  const handleLockedClick = (item: FeatureConfig) => {
    if (!isAuthenticated) {
      goToLogin(item.href);
    }
  };

  /** 图标 + 名称的导航按钮内容（名称常驻，与移动端底栏样式一致） */
  const navContent = (
    Icon: React.ComponentType<{ className?: string }>,
    label: string,
    { isActive = false, showLock = false } = {}
  ) => (
    <>
      {isActive && (
        <span className="absolute -left-1 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-r bg-primary" />
      )}
      <span className="relative">
        <Icon className={cn("h-5 w-5", isActive ? "text-primary" : "text-foreground")} />
        {showLock && (
          <span className="absolute -right-1.5 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-1 ring-gray-200 text-primary-deep shadow-xs">
            <Lock className="h-2.5 w-2.5 text-primary-deep" />
          </span>
        )}
      </span>
      <span
        className={cn(
          "text-[10px] font-medium leading-none",
          isActive ? "text-primary font-semibold" : "text-foreground/70"
        )}
      >
        {label}
      </span>
    </>
  );

  const itemClass = (isActive: boolean) =>
    cn(
      "relative flex w-[72px] flex-col items-center gap-1.5 rounded-lg py-2.5 transition-all",
      isActive ? "bg-primary/20" : "hover:bg-primary/10"
    );

  // 移动端底部栏：首页（通用智能体平台）+ 知识库 + 技能 + 智能体 + 设置
  const mobileNavItems = [
    { key: "home", label: "首页", href: "/", icon: FEATURES.find((f) => f.key === "home")?.icon || Home },
    { key: "knowledge", label: "知识库", href: "/knowledge", icon: FEATURES.find((f) => f.key === "knowledge")?.icon || Sparkles },
    { key: "skills", label: "技能", href: "/skills", icon: FEATURES.find((f) => f.key === "skills")?.icon || Sparkles },
    { key: "agents", label: "智能体", href: "/agents", icon: FEATURES.find((f) => f.key === "agents")?.icon || Sparkles },
    { key: "settings", label: "设置", href: "/settings", icon: Settings },
  ];

  return (
    <>
      {/* 桌面端侧边栏 (md 及以上显示)：图标 + 名称常驻，全部按钮一组置顶 */}
      <aside className="fixed left-0 top-0 z-[1000] hidden h-screen w-[84px] flex-col items-center bg-dark-card py-5 md:flex">
        {/* 用户头像（点击开个人空间抽屉；未登录去登录页） */}
        <button
          onClick={handleAvatarClick}
          className="mb-5 flex shrink-0 items-center justify-center rounded-xl p-0.5 transition-transform hover:scale-108 focus:outline-hidden cursor-pointer"
          aria-label="用户中心"
        >
          <UserAvatar
            userId={userId}
            avatarUrl={avatarUrl}
            name={user?.name || user?.username}
            size={36}
            shape="rounded-lg"
            className="shadow-xs ring-1 ring-gray-200/80 hover:ring-primary/50 transition-all"
          />
        </button>

        {/* 主导航（顶部区）：核心功能入口 */}
        <nav className="flex w-full flex-1 flex-col items-center gap-1" aria-label="主导航">
          {FEATURES.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));

            const showLockBadge =
              item.locked || (!isAuthenticated && item.requiresAuth);

            // 始终锁定（敬请期待）：未登录点击去登录页，登录后不可进入
            if (item.locked) {
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => handleLockedClick(item)}
                  className={cn(
                    itemClass(isActive),
                    isAuthenticated ? "cursor-not-allowed" : "cursor-pointer"
                  )}
                  aria-label={item.label}
                  aria-disabled={isAuthenticated}
                >
                  {navContent(Icon, item.label, { isActive, showLock: showLockBadge })}
                </button>
              );
            }

            // 需登录：未登录点击直跳登录页
            if (!isAuthenticated && item.requiresAuth) {
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => goToLogin(item.href)}
                  className={cn(itemClass(isActive), "cursor-pointer")}
                  aria-label={item.label}
                >
                  {navContent(Icon, item.label, { isActive, showLock: showLockBadge })}
                </button>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={itemClass(isActive)}
                aria-label={item.label}
              >
                {navContent(Icon, item.label, { isActive })}
              </Link>
            );
          })}
        </nav>

        {/* 非主要功能（底部区）：设置 / 关于 / 退出 */}
        <div className="mt-3 flex w-full flex-col items-center gap-1">
          {/* 设置（未登录上锁直跳登录页） */}
          {!isAuthenticated ? (
            <button
              type="button"
              onClick={() => goToLogin("/settings")}
              className={cn(itemClass(false), "cursor-pointer")}
              aria-label="设置"
            >
              {navContent(Settings, "设置", { showLock: true })}
            </button>
          ) : (
            <Link href="/settings" className={itemClass(pathname.startsWith("/settings"))} aria-label="设置">
              {navContent(Settings, "设置", { isActive: pathname.startsWith("/settings") })}
            </Link>
          )}

          {/* 关于（公开） */}
          <Link href="/help" className={itemClass(pathname.startsWith("/help"))} aria-label="关于">
            {navContent(HelpCircle, "关于", { isActive: pathname.startsWith("/help") })}
          </Link>

          {/* 退出（仅登录后） */}
          {isAuthenticated && (
            <button
              onClick={logout}
              className={cn(
                "relative flex w-[72px] flex-col items-center gap-1.5 rounded-lg py-2.5 transition-all hover:bg-red-500/10 cursor-pointer"
              )}
              aria-label="退出"
            >
              {navContent(LogOut, "退出")}
            </button>
          )}
        </div>
      </aside>

      {/* 移动端底部导航栏 (md 以下显示) */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-[1000] flex h-14 items-center justify-around border-t border-gray-200/90 bg-white/95 px-1 shadow-[0_-2px_10px_rgba(0,0,0,0.04)] backdrop-blur-md safe-area-pb md:hidden"
        aria-label="移动端导航"
      >
        {mobileNavItems.map((item) => {
          const Icon = item.icon;
          const featConfig = FEATURES.find((f) => f.href === item.href);
          const settingsLocked = !isAuthenticated && item.href === "/settings";
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const showLockBadge =
            featConfig?.locked ||
            (!isAuthenticated && featConfig?.requiresAuth) ||
            settingsLocked;

          const innerContent = (
            <div className="flex flex-col items-center gap-0.5 py-1">
              <div className="relative">
                <Icon
                  className={cn(
                    "h-5 w-5 transition-colors",
                    isActive ? "text-primary" : "text-muted"
                  )}
                />
                {showLockBadge && (
                  <span className="absolute -right-1.5 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white ring-1 ring-gray-200 text-primary-deep shadow-xs">
                    <Lock className="h-2 w-2 text-primary-deep" />
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium leading-none transition-colors",
                  isActive ? "text-primary font-semibold" : "text-muted"
                )}
              >
                {item.label}
              </span>
            </div>
          );

          if (
            settingsLocked ||
            (featConfig &&
              (featConfig.locked ||
                (!isAuthenticated && featConfig.requiresAuth)))
          ) {
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => {
                  if (!isAuthenticated) {
                    goToLogin(item.href);
                  }
                }}
                className={cn(
                  "flex flex-1 items-center justify-center px-1",
                  featConfig?.locked && isAuthenticated
                    ? "cursor-not-allowed"
                    : "cursor-pointer"
                )}
                aria-label={item.label}
              >
                {innerContent}
              </button>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-1 items-center justify-center px-1"
              aria-label={item.label}
            >
              {innerContent}
            </Link>
          );
        })}
      </nav>

      <ProfileDrawer isOpen={showProfile} onClose={() => setShowProfile(false)} />
    </>
  );
};
