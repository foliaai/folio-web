"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  X,
  Camera,
  RotateCcw,
  Check,
  Copy,
  Edit2,
  Settings,
  HelpCircle,
  LogOut,
  Sparkles,
  Loader2,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { GenderBadge } from "@/components/ui/GenderBadge";
import { useUserProfile } from "@/lib/hooks/useUserProfile";
import { useAuth } from "@/components/auth/AuthProvider";

interface ProfilePanelProps {
  /**
   * 完成一次跳转后的回调：抽屉形态用它收起自身，页面形态不需要。
   */
  onNavigate?: () => void;
  className?: string;
}

/**
 * 个人空间正文（用户卡片 + 简介 + 账户操作）。
 *
 * 桌面端由 ProfileDrawer 包一层抽屉壳渲染，移动端由 /profile 页面直接渲染，
 * 两处共用同一份内容，避免样式与交互各写一遍后逐渐分叉。
 */
export function ProfilePanel({ onNavigate, className }: ProfilePanelProps) {
  const { user, isAuthenticated, logout } = useAuth();
  const {
    userId,
    avatarUrl,
    nickname,
    bio,
    gender,
    departments,
    isLoading,
    uploadAvatar,
    deleteAvatar,
    updateProfile,
  } = useUserProfile();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const displayName =
    nickname ||
    user?.name ||
    user?.username ||
    (userId ? `用户 ${userId.slice(0, 8)}` : "未命名用户");

  const displayBio =
    bio ||
    "暂无个人简介。点击编辑按钮添加简介，介绍您的工作或研究方向。";

  const handleStartEdit = () => {
    setEditName(nickname || user?.name || "");
    setEditBio(bio || "");
    setIsEditing(true);
    setStatusMsg(null);
  };

  const handleSaveProfile = async () => {
    setIsSaving(true);
    setStatusMsg(null);
    try {
      await updateProfile({
        nickname: editName.trim() || undefined,
        bio: editBio.trim() || undefined,
      });
      setIsEditing(false);
      setStatusMsg({ type: "success", text: "个人资料已保存" });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      setStatusMsg({ type: "error", text: err?.message || "保存失败" });
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 清空 input 允许重复选择相同文件
    e.target.value = "";

    setStatusMsg(null);
    try {
      await uploadAvatar(file);
      setStatusMsg({ type: "success", text: "头像已成功更新" });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      setStatusMsg({ type: "error", text: err?.message || "头像上传失败" });
    }
  };

  const handleResetAvatar = async () => {
    setStatusMsg(null);
    try {
      await deleteAvatar();
      setStatusMsg({ type: "success", text: "已重置为默认品牌字符徽章" });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      setStatusMsg({ type: "error", text: err?.message || "重置头像失败" });
    }
  };

  const handleCopyUserId = () => {
    if (!userId) return;
    navigator.clipboard.writeText(userId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* 隐藏的文件上传 input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
      />

      {/* 用户基础信息卡片 */}
      <div className="relative rounded-2xl bg-gray-50/80 border border-gray-200/80 p-4">
        <div className="flex items-start gap-3.5">
          {/* 头像区域：左下角相机修改按钮（GitHub 风格交互） */}
          <div className="relative shrink-0">
            <UserAvatar
              userId={userId}
              avatarUrl={avatarUrl}
              name={displayName}
              size={58}
              shape="rounded-xl"
              className="shadow-xs ring-1 ring-black/5"
            />

            {/* GitHub 风格：位于头像左下角的圆形修改按钮 */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="absolute -bottom-1 -left-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-gray-700 border border-gray-200 shadow-sm transition-all hover:scale-110 hover:bg-primary hover:text-white hover:border-primary cursor-pointer"
              title="修改头像 (点击上传图片)"
              aria-label="修改头像"
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
            </button>

            {/* 性别标志（♂/♀ 角标；未知不显示） */}
            <GenderBadge gender={gender} className="absolute -bottom-1 -right-1" />
          </div>

          {/* 用户信息与名称 */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-base font-bold text-foreground">
                {displayName}
              </h2>
              {!isEditing && (
                <button
                  onClick={handleStartEdit}
                  className="p-1 text-muted hover:text-primary transition-colors"
                  title="编辑昵称与简介"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* User ID 与复制 */}
            <div className="mt-1 flex items-center gap-1.5">
              <span className="font-mono text-xs text-muted-subtle">ID:</span>
              <span className="font-mono text-xs text-muted truncate max-w-[130px]">
                {userId}
              </span>
              <button
                onClick={handleCopyUserId}
                className="p-0.5 text-muted hover:text-foreground transition-colors"
                title="复制用户 ID"
              >
                {copiedId ? (
                  <Check className="h-3 w-3 text-primary" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>

            {/* 所属组织（OA 身份属性只读标签；公网 Logto 用户隐藏） */}
            {departments.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {departments.map((dept) => (
                  <span
                    key={dept.id}
                    title={dept.is_main ? `${dept.name}（主部门）` : dept.name}
                    className={cn(
                      "inline-flex max-w-full items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1",
                      dept.is_main
                        ? "bg-primary/10 text-primary-deep ring-primary/20"
                        : "bg-gray-100 text-muted ring-gray-200"
                    )}
                  >
                    <Building2 className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{dept.name}</span>
                  </span>
                ))}
              </div>
            )}

            {avatarUrl ? (
              <div className="mt-2 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary-deep ring-1 ring-primary/20">
                  <Sparkles className="h-2.5 w-2.5" />
                  自定义头像
                </span>
                <button
                  onClick={handleResetAvatar}
                  disabled={isLoading}
                  className="inline-flex items-center gap-0.5 text-[10px] text-muted hover:text-red-600 transition-colors"
                  title="恢复默认头像"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  恢复默认
                </button>
              </div>
            ) : null}
          </div>
        </div>

        {/* 状态反馈提示 */}
        {statusMsg && (
          <div
            className={cn(
              "mt-3 rounded-lg px-2.5 py-1.5 text-xs flex items-center gap-1.5 transition-all",
              statusMsg.type === "success"
                ? "bg-primary/10 text-primary-deep border border-primary/20"
                : "bg-red-50 text-red-600 border border-red-200"
            )}
          >
            {statusMsg.type === "success" ? (
              <Check className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <X className="h-3.5 w-3.5 shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </div>
        )}
      </div>

      {/* 个人简介模块 */}
      {isEditing ? (
        <section className="rounded-2xl bg-gray-50/80 border border-gray-200/80 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
              编辑个人资料
            </h3>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">昵称</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              maxLength={30}
              className="w-full rounded-lg bg-white border border-gray-300 px-3 py-1.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary/20 focus:outline-hidden transition-colors"
              placeholder="请输入您的昵称"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">简介</label>
            <textarea
              value={editBio}
              onChange={(e) => setEditBio(e.target.value)}
              rows={3}
              maxLength={200}
              className="w-full rounded-lg bg-white border border-gray-300 px-3 py-1.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary/20 focus:outline-hidden resize-none transition-colors"
              placeholder="填写您的个人简介或研究方向..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="rounded-lg bg-gray-200/70 hover:bg-gray-300/70 px-3 py-1.5 text-xs text-foreground transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSaveProfile}
              disabled={isSaving}
              className="flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-light px-3.5 py-1.5 text-xs font-medium text-white transition-colors"
            >
              {isSaving && <Loader2 className="h-3 w-3 animate-spin" />}
              保存
            </button>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl bg-gray-50/80 border border-gray-200/80 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-muted uppercase tracking-wider">
              个人简介
            </h3>
          </div>
          <p className="text-xs leading-relaxed text-muted whitespace-pre-wrap">
            {displayBio}
          </p>
        </section>
      )}

      {/* 账户操作与设置 */}
      <section className="rounded-2xl bg-gray-50/80 border border-gray-200/80 p-2 space-y-1">
        <Link
          href="/settings"
          onClick={onNavigate}
          className="flex items-center justify-between rounded-xl p-2.5 text-xs text-foreground transition-colors hover:bg-white hover:shadow-xs"
        >
          <div className="flex items-center gap-2.5">
            <Settings className="h-4 w-4 text-muted" />
            <span>系统与模型设置</span>
          </div>
          <span className="text-[10px] text-muted-subtle">前往</span>
        </Link>

        <Link
          href="/help"
          onClick={onNavigate}
          className="flex items-center justify-between rounded-xl p-2.5 text-xs text-foreground transition-colors hover:bg-white hover:shadow-xs"
        >
          <div className="flex items-center gap-2.5">
            <HelpCircle className="h-4 w-4 text-muted" />
            <span>关于开发者</span>
          </div>
          <span className="text-[10px] text-muted-subtle">查看</span>
        </Link>

        {isAuthenticated && (
          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center justify-between rounded-xl p-2.5 text-xs text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
          >
            <div className="flex items-center gap-2.5">
              <LogOut className="h-4 w-4" />
              <span>退出当前登录</span>
            </div>
          </button>
        )}
      </section>
    </div>
  );
}
