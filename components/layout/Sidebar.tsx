"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Settings,
  HelpCircle,
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

const bottomItems = [
  { icon: Settings, label: "设置", href: "/settings" },
  { icon: HelpCircle, label: "关于", href: "/help" },
];

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

  // 移动端底部栏展示的导航列表（个人资料并入设置页首个 tab，不再单独设「我的」）
  const mobileNavItems = [
    { key: "knowledge", label: "知识库", href: "/knowledge", icon: FEATURES.find((f) => f.key === "knowledge")?.icon || Sparkles },
    { key: "skills", label: "技能", href: "/skills", icon: FEATURES.find((f) => f.key === "skills")?.icon || Sparkles },
    { key: "agents", label: "智能体", href: "/agents", icon: FEATURES.find((f) => f.key === "agents")?.icon || Sparkles },
    { key: "settings", label: "设置", href: "/settings", icon: Settings },
  ];

  return (
    <>
      {/* 桌面端侧边栏 (md 及以上显示) */}
      <aside className="fixed left-0 top-0 z-[1000] hidden h-screen w-[60px] flex-col items-center bg-dark-card py-5 md:flex">
        {/* User Avatar */}
        <button
          onClick={handleAvatarClick}
          className="mb-8 flex items-center justify-center rounded-xl p-0.5 transition-transform hover:scale-108 focus:outline-hidden cursor-pointer"
          aria-label="用户中心"
        >
          <UserAvatar
            userId={userId}
            avatarUrl={avatarUrl}
            name={user?.name || user?.username}
            size={32}
            shape="rounded-lg"
            className="shadow-xs ring-1 ring-gray-200/80 hover:ring-primary/50 transition-all"
          />
        </button>

        {/* Navigation Items */}
        <nav className="flex flex-1 flex-col gap-5">
          {FEATURES.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));

            const showLockBadge =
              item.locked || (!isAuthenticated && item.requiresAuth);

            const content = (
              <>
                {isActive && (
                  <span className="absolute -left-2.5 h-5 w-0.5 rounded-r bg-primary" />
                )}
                <Icon className="h-5 w-5 text-foreground" />
                {showLockBadge && (
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-white ring-1 ring-gray-200 text-primary-deep shadow-xs">
                    <Lock className="h-2.5 w-2.5 text-primary-deep" />
                  </span>
                )}
              </>
            );

            // 始终锁定（敬请期待）：未登录点击去登录页，登录后不可进入
            if (item.locked) {
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => handleLockedClick(item)}
                  className={cn(
                    "relative flex h-10 w-10 items-center justify-center rounded-lg transition-all",
                    isAuthenticated
                      ? "cursor-not-allowed"
                      : "cursor-pointer hover:bg-primary/10",
                    isActive ? "bg-primary/20" : ""
                  )}
                  aria-label={item.label}
                  aria-disabled={isAuthenticated}
                >
                  {content}
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
                  className="relative flex h-10 w-10 items-center justify-center rounded-lg transition-all cursor-pointer hover:bg-primary/10"
                  aria-label={item.label}
                >
                  {content}
                </button>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex h-10 w-10 items-center justify-center rounded-lg transition-all",
                  isActive ? "bg-primary/20" : "hover:bg-primary/10"
                )}
                aria-label={item.label}
              >
                {content}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Items */}
        <div className="flex flex-col gap-4">
          {bottomItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex h-10 w-10 items-center justify-center rounded-lg transition-all hover:bg-primary/10"
                aria-label={item.label}
              >
                <Icon className="h-5 w-5 text-foreground" />
              </Link>
            );
          })}

          {isAuthenticated && (
            <button
              onClick={logout}
              className="flex h-10 w-10 items-center justify-center rounded-lg transition-all hover:bg-red-500/10 cursor-pointer"
              aria-label="退出登录"
            >
              <LogOut className="h-5 w-5 text-foreground" />
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
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const showLockBadge =
            featConfig?.locked || (!isAuthenticated && featConfig?.requiresAuth);

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

          if (featConfig && (featConfig.locked || (!isAuthenticated && featConfig.requiresAuth))) {
            return (
              <button
                key={item.href}
                type="button"
                onClick={() => handleLockedClick(featConfig)}
                className={cn(
                  "flex flex-1 items-center justify-center px-1",
                  featConfig.locked && isAuthenticated
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
