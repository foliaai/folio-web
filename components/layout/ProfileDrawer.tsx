"use client";

import { ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { ProfilePanel } from "@/components/layout/ProfilePanel";

interface ProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * 桌面端个人空间抽屉（md 及以上）。
 *
 * 移动端不弹抽屉：个人资料管理在设置页首个 tab（/settings）。
 */
export const ProfileDrawer = ({ isOpen, onClose }: ProfileDrawerProps) => {
  const { isAuthenticated } = useAuth();

  return (
    <>
      {/* 遮罩背景 */}
      <div
        className={cn(
          "fixed inset-0 z-[998] hidden bg-black/35 backdrop-blur-xs transition-opacity duration-300 md:block",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
      />

      {/* 抽屉容器：完全遵循网站纯白/极简质感设计规范。
          z 必须低于侧边栏（z-1000）：收起时 left-[60px] - 自身宽度只把抽屉推到
          x=0..60，那 60px 正好由侧边栏盖住；一旦抬到侧边栏之上，收起态就会在
          左栏上漏出一条白边和关闭按钮。 */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-[999] hidden h-full w-full max-w-[380px] flex-col bg-white text-foreground shadow-2xl transition-transform duration-300 ease-out md:left-[60px] md:flex md:border-r md:border-gray-200",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        aria-hidden={!isOpen}
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/70 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">个人空间</span>
            {isAuthenticated ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary-deep ring-1 ring-primary/20">
                <ShieldCheck className="h-3 w-3" />
                已登录
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-muted ring-1 ring-gray-200">
                访客模式
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-gray-200/70 hover:text-foreground"
            aria-label="关闭抽屉"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 抽屉内容区 */}
        <div className="flex-1 overflow-y-auto p-5">
          <ProfilePanel onNavigate={onClose} />
        </div>
      </aside>
    </>
  );
};
