"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Sparkles,
  Database,
  Info,
  Check,
  Copy,
  Camera,
  RotateCcw,
  ShieldCheck,
  LogOut,
  RefreshCw,
  Trash2,
  Download,
  Edit2,
  ExternalLink,
  Cpu,
  Server,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  HardDrive,
  Terminal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useUserProfile } from "@/lib/hooks/useUserProfile";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  fetchChatModels,
  groupChatModelsByProvider,
  type ChatModelItem,
} from "@/lib/api/chat-models";
import { API_CONFIG, getCurrentUserId } from "@/lib/config";
import {
  THINKING_LEVEL_LABELS,
  THINKING_LEVEL_DESCS,
} from "@/lib/chat/thinking-levels";
import {
  getSendShortcut,
  getSettingsDefaultModel,
  getSettingsDefaultThinkingLevel,
  getSettingsEnableRoutePlan,
  setSendShortcut as persistSendShortcut,
  setSettingsDefaultModel,
  setSettingsDefaultThinkingLevel,
  setSettingsEnableRoutePlan,
} from "@/lib/chat/chat-preferences";

type TabType = "profile" | "ai" | "data" | "system";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>("profile");
  const { isAuthenticated, isReady, user, logout } = useAuth();
  const router = useRouter();

  // 未登录直达登录页（正常入口由侧边栏锁拦截，此处兜底直链访问）
  useEffect(() => {
    if (isReady && !isAuthenticated) {
      router.replace("/login?next=%2Fsettings");
    }
  }, [isReady, isAuthenticated, router]);
  const {
    userId,
    profile,
    avatarUrl,
    nickname,
    bio,
    isLoading: isProfileLoading,
    uploadAvatar,
    deleteAvatar,
    updateProfile,
    refreshProfile,
  } = useUserProfile();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ==================== 个人资料状态 ====================
  const [formName, setFormName] = useState("");
  const [formBio, setFormBio] = useState("");
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const syncFormFromProfile = useCallback(() => {
    if (profile) {
      setFormName(profile.nickname || user?.name || user?.username || "");
      setFormBio(profile.bio || "");
    } else {
      setFormName(user?.name || user?.username || "");
      setFormBio("");
    }
  }, [profile, user]);

  useEffect(() => {
    if (isEditingProfile) return;
    syncFormFromProfile();
  }, [isEditingProfile, syncFormFromProfile]);

  // ==================== AI 与模型状态 ====================
  const [chatModels, setChatModels] = useState<ChatModelItem[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [defaultModel, setDefaultModel] = useState("gpt-4o-mini");
  const [defaultThinking, setDefaultThinking] = useState("off");
  const [sendShortcut, setSendShortcut] = useState<"enter" | "cmd-enter">("enter");
  const [enableRoutePlan, setEnableRoutePlan] = useState(false);

  // ==================== 存储与缓存状态 ====================
  const [storageUsage, setStorageUsage] = useState<string>("0 KB");
  const [cachedItemsCount, setCachedItemsCount] = useState(0);
  const [clearingCache, setClearingCache] = useState(false);

  // ==================== 系统健康检测状态 ====================
  const [healthStatus, setHealthStatus] = useState<{
    api: "checking" | "online" | "offline";
    mysql: "checking" | "online" | "offline";
    models: "checking" | "online" | "offline";
    latency: number | null;
  }>({
    api: "checking",
    mysql: "checking",
    models: "checking",
    latency: null,
  });

  // 初始化从 localStorage 恢复设置
  useEffect(() => {
    if (typeof window === "undefined") return;

    // AI 设置
    const savedModel = getSettingsDefaultModel();
    if (savedModel) setDefaultModel(savedModel);

    const savedThinking = getSettingsDefaultThinkingLevel();
    if (savedThinking) setDefaultThinking(savedThinking);

    const savedShortcut = getSendShortcut();
    if (savedShortcut) setSendShortcut(savedShortcut);

    const savedRoutePlan = getSettingsEnableRoutePlan();
    setEnableRoutePlan(savedRoutePlan);

    // 计算 Storage 大小
    calculateStorageUsage();
  }, []);

  // 计算本地缓存大小
  const calculateStorageUsage = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      let totalBytes = 0;
      let count = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const val = localStorage.getItem(key) || "";
          totalBytes += key.length + val.length;
          count++;
        }
      }
      setCachedItemsCount(count);
      if (totalBytes < 1024) {
        setStorageUsage(`${totalBytes} B`);
      } else if (totalBytes < 1024 * 1024) {
        setStorageUsage(`${(totalBytes / 1024).toFixed(1)} KB`);
      } else {
        setStorageUsage(`${(totalBytes / (1024 * 1024)).toFixed(2)} MB`);
      }
    } catch {
      setStorageUsage("不可用");
    }
  }, []);

  // 拉取可用模型列表
  const loadModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const models = await fetchChatModels();
      setChatModels(models);
      if (models.length > 0 && !getSettingsDefaultModel()) {
        setDefaultModel(models[0].id);
      }
    } catch (err) {
      console.warn("拉取模型列表异常:", err);
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // 运行系统连通性检测
  const checkHealth = useCallback(async () => {
    setHealthStatus({
      api: "checking",
      mysql: "checking",
      models: "checking",
      latency: null,
    });

    const startTime = performance.now();
    try {
      // 1. 测试模型接口与后端连通性
      const models = await fetchChatModels();
      const endTime = performance.now();
      const latency = Math.round(endTime - startTime);

      setHealthStatus({
        api: "online",
        mysql: "online",
        models: models.length > 0 ? "online" : "offline",
        latency,
      });
    } catch (err) {
      setHealthStatus({
        api: "offline",
        mysql: "offline",
        models: "offline",
        latency: null,
      });
    }
  }, []);

  useEffect(() => {
    if (activeTab === "system") {
      checkHealth();
    }
  }, [activeTab, checkHealth]);

  // ==================== 交互处理函数 ====================

  const handleStartEditProfile = () => {
    syncFormFromProfile();
    setIsEditingProfile(true);
    setProfileMsg(null);
  };

  const handleCancelEditProfile = () => {
    syncFormFromProfile();
    setIsEditingProfile(false);
    setProfileMsg(null);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditingProfile) return;
    setIsSavingProfile(true);
    setProfileMsg(null);
    try {
      await updateProfile({
        nickname: formName.trim() || undefined,
        bio: formBio.trim() || undefined,
      });
      setIsEditingProfile(false);
      setProfileMsg({ type: "success", text: "个人资料保存成功" });
      setTimeout(() => setProfileMsg(null), 3000);
    } catch (err: any) {
      setProfileMsg({ type: "error", text: err?.message || "保存失败" });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setProfileMsg(null);
    try {
      await uploadAvatar(file);
      setProfileMsg({ type: "success", text: "头像上传成功并保存至 MinIO" });
      setTimeout(() => setProfileMsg(null), 3000);
    } catch (err: any) {
      setProfileMsg({ type: "error", text: err?.message || "上传头像失败" });
    }
  };

  const handleResetAvatar = async () => {
    setProfileMsg(null);
    try {
      await deleteAvatar();
      setProfileMsg({ type: "success", text: "已重置为默认品牌字符徽章" });
      setTimeout(() => setProfileMsg(null), 3000);
    } catch (err: any) {
      setProfileMsg({ type: "error", text: err?.message || "重置头像失败" });
    }
  };

  const handleCopyUserId = () => {
    if (!userId) return;
    navigator.clipboard.writeText(userId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleModelChange = (modelId: string) => {
    setDefaultModel(modelId);
    setSettingsDefaultModel(modelId);
  };

  const handleThinkingChange = (level: string) => {
    setDefaultThinking(level);
    setSettingsDefaultThinkingLevel(level);
  };

  const handleShortcutChange = (shortcut: "enter" | "cmd-enter") => {
    setSendShortcut(shortcut);
    persistSendShortcut(shortcut);
  };

  const handleRoutePlanChange = (enable: boolean) => {
    setEnableRoutePlan(enable);
    setSettingsEnableRoutePlan(enable);
  };

  // 导出所有数据
  const handleExportData = () => {
    if (typeof window === "undefined") return;
    const exportObj: Record<string, any> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        try {
          exportObj[key] = JSON.parse(localStorage.getItem(key) || "");
        } catch {
          exportObj[key] = localStorage.getItem(key);
        }
      }
    }
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aks_settings_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 清空本地缓存
  const handleClearCache = () => {
    if (typeof window === "undefined") return;
    if (!window.confirm("确定要清空本地会话缓存与界面记忆吗？该操作不会删除服务端数据。")) {
      return;
    }
    setClearingCache(true);
    setTimeout(() => {
      // 保留认证 Token
      const token = localStorage.getItem("ai_site_auth_token");
      const session = localStorage.getItem("ai_site_auth_session");
      const userKey = localStorage.getItem("ai_site_auth_user");

      localStorage.clear();

      if (token) localStorage.setItem("ai_site_auth_token", token);
      if (session) localStorage.setItem("ai_site_auth_session", session);
      if (userKey) localStorage.setItem("ai_site_auth_user", userKey);

      calculateStorageUsage();
      setClearingCache(false);
      alert("本地缓存已清理完成");
    }, 400);
  };

  const tabs = [
    { id: "profile", label: "个人资料", icon: User, desc: "账号身份与自定义头像" },
    { id: "ai", label: "AI 与模型", icon: Sparkles, desc: "模型、推理与对话偏好" },
    { id: "data", label: "数据与存储", icon: Database, desc: "本地缓存、备份与导出" },
    { id: "system", label: "系统与连通性", icon: Cpu, desc: "后端状态与运行环境" },
  ] as const;

  // 会话未就绪或未登录时不渲染（重定向登录页）
  if (!isReady || !isAuthenticated) {
    return <div className="min-h-screen bg-gray-50/60" />;
  }

  return (
    <div className="min-h-screen bg-gray-50/60 pb-16">
      {/* 隐藏的头像上传 input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleAvatarFileChange}
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
      />

      {/* 顶部与下方双栏共用同一套 max-w + 水平内边距，保证左右对齐 */}
      <header className="sticky top-0 z-30 border-b border-gray-200/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-10 sm:py-4">
          <h1 className="text-lg font-bold text-foreground">系统设置与偏好</h1>
          <p className="text-xs text-muted">定制您的 AI 工作区、模型参数与账号资料</p>
        </div>
      </header>

      {/* 主体双栏区域 */}
      <main className="mx-auto max-w-6xl px-4 py-4 sm:px-10 sm:py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          {/* 左侧选项卡导航 */}
          <aside className="flex flex-row gap-1.5 overflow-x-auto rounded-2xl border border-gray-200/80 bg-white p-2 shadow-xs lg:flex-col lg:overflow-visible">
            {tabs.map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-3 rounded-xl px-3.5 py-2.5 text-left text-xs font-medium transition-all",
                    isActive
                      ? "bg-primary/10 text-primary-deep font-semibold shadow-xs"
                      : "text-muted hover:bg-gray-100/80 hover:text-foreground"
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted")} />
                  <div className="min-w-0">
                    <div className="truncate">{t.label}</div>
                  </div>
                </button>
              );
            })}
          </aside>

          {/* 右侧设置主面板 */}
          <div className="min-w-0 space-y-6">
            {/* ==================== 1. 个人资料面板 ==================== */}
            {activeTab === "profile" && (
              <div className="space-y-6">
                {/* 用户身份与头像卡片 */}
                <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs">
                  <h2 className="text-sm font-bold text-foreground">个人身份与头像</h2>
                  <p className="mt-1 text-xs text-muted">
                    管理您在系统中的显示形象，头像支持上传高清图片并自动同步保存至 MinIO 对象存储。
                  </p>

                  <div className="mt-6 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
                    {/* 头像区域（左下角修改徽标交互） */}
                    <div className="relative shrink-0">
                      <UserAvatar
                        userId={userId}
                        avatarUrl={avatarUrl}
                        name={formName || user?.name || user?.username}
                        size={64}
                        shape="rounded-2xl"
                        className="shadow-sm ring-1 ring-black/5"
                      />

                      {/* GitHub 风格左下角相机修改徽标 */}
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isProfileLoading}
                        className="absolute -bottom-1 -left-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-gray-700 border border-gray-200 shadow-sm transition-all hover:scale-110 hover:bg-primary hover:text-white hover:border-primary cursor-pointer"
                        title="更换头像"
                        aria-label="更换头像"
                      >
                        {isProfileLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        ) : (
                          <Camera className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>

                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isProfileLoading}
                          className="rounded-xl border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-gray-50 hover:border-gray-300"
                        >
                          上传新图片
                        </button>
                        {avatarUrl && (
                          <button
                            type="button"
                            onClick={handleResetAvatar}
                            disabled={isProfileLoading}
                            className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>恢复默认徽章</span>
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-subtle">
                        支持 JPG、PNG、WEBP、GIF 或 SVG 格式，上传后自动等比缩放为 WebP 高清图。
                      </p>
                    </div>
                  </div>
                </div>

                {/* 个人资料表单 */}
                <form onSubmit={handleSaveProfile} className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs space-y-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-bold text-foreground">基本资料</h2>
                      <p className="mt-1 text-xs text-muted">
                        默认只读。需要改昵称或简介时，先点「修改」。
                      </p>
                    </div>
                    {!isEditingProfile ? (
                      <button
                        type="button"
                        onClick={handleStartEditProfile}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:border-gray-300 hover:bg-gray-50"
                      >
                        <Edit2 className="h-3.5 w-3.5 text-muted" />
                        修改
                      </button>
                    ) : null}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      昵称 / 显示名称
                    </label>
                    <input
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      maxLength={30}
                      readOnly={!isEditingProfile}
                      className={cn(
                        "w-full max-w-md rounded-xl border px-3.5 py-2 text-xs text-foreground transition-colors",
                        isEditingProfile
                          ? "border-gray-300 bg-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-hidden"
                          : "cursor-default border-gray-200 bg-gray-50 text-muted focus:outline-hidden"
                      )}
                      placeholder={isEditingProfile ? "设置您的称呼" : "未设置昵称"}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      个人简介 / 签名
                    </label>
                    <textarea
                      value={formBio}
                      onChange={(e) => setFormBio(e.target.value)}
                      rows={3}
                      maxLength={200}
                      readOnly={!isEditingProfile}
                      className={cn(
                        "w-full max-w-md rounded-xl border px-3.5 py-2 text-xs text-foreground resize-none transition-colors",
                        isEditingProfile
                          ? "border-gray-300 bg-white placeholder-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-hidden"
                          : "cursor-default border-gray-200 bg-gray-50 text-muted focus:outline-hidden"
                      )}
                      placeholder={isEditingProfile ? "介绍一下您的工作领域或研究兴趣..." : "未填写简介"}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      用户标识 (User ID)
                    </label>
                    <div className="flex max-w-md items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={userId}
                        className="flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2 font-mono text-xs text-muted cursor-default focus:outline-hidden"
                      />
                      <button
                        type="button"
                        onClick={handleCopyUserId}
                        className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-gray-50"
                      >
                        {copiedId ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-primary" />
                            <span className="text-primary-deep font-semibold">已复制</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5 text-muted" />
                            <span>复制</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {profileMsg && (
                    <div
                      className={cn(
                        "rounded-xl px-3.5 py-2 text-xs flex items-center gap-2",
                        profileMsg.type === "success"
                          ? "bg-primary/10 text-primary-deep border border-primary/20"
                          : "bg-red-50 text-red-600 border border-red-200"
                      )}
                    >
                      {profileMsg.type === "success" ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                      )}
                      <span>{profileMsg.text}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary-deep ring-1 ring-primary/20">
                        <ShieldCheck className="h-3 w-3" />
                        账号已登录
                      </span>
                    </div>
                    {isEditingProfile ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleCancelEditProfile}
                          disabled={isSavingProfile}
                          className="inline-flex items-center rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-gray-50 disabled:opacity-50"
                        >
                          取消
                        </button>
                        <button
                          type="submit"
                          disabled={isSavingProfile}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-medium text-white shadow-sm transition-all hover:bg-primary-light disabled:opacity-50"
                        >
                          {isSavingProfile && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          <span>保存资料</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </form>

                {/* 账号安全与退出 */}
                <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-bold text-foreground">会话与认证管理</h3>
                    <p className="mt-0.5 text-xs text-muted">
                      当前已登录，退出后将清除本地会话缓存并重定向至登录页。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={logout}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50/70 px-4 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 hover:text-red-700"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>退出登录</span>
                  </button>
                </div>
              </div>
            )}

            {/* ==================== 2. AI 与模型偏好面板 ==================== */}
            {activeTab === "ai" && (
              <div className="space-y-6">
                {/* 默认推理模型 */}
                <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-bold text-foreground">默认推理模型</h2>
                      <p className="mt-1 text-xs text-muted">
                        选择新建知识库问答或通用会话时默认加载的模型。由自托管 LiteLLM Proxy 统一调度。
                      </p>
                    </div>
                    <button
                      onClick={loadModels}
                      disabled={isLoadingModels}
                      className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-gray-100 transition-colors"
                      title="刷新模型列表"
                    >
                      <RefreshCw className={cn("h-4 w-4", isLoadingModels && "animate-spin text-primary")} />
                    </button>
                  </div>

                  <SettingsModelSelect
                    models={chatModels}
                    value={defaultModel}
                    onChange={handleModelChange}
                    loading={isLoadingModels}
                  />
                </div>

                {/* 默认思考推理强度 */}
                <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs space-y-4">
                  <div>
                    <h2 className="text-sm font-bold text-foreground">默认思考推理强度 (Reasoning Effort)</h2>
                    <p className="mt-1 text-xs text-muted">
                      控制支持思考模型的推理深度。深度思考会提升复杂长逻辑的准确率，但响应耗时会相应增加。
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 max-w-xl">
                    {(["off", "low", "medium", "high"] as const).map((level) => {
                      const isSelected = defaultThinking === level;
                      return (
                        <button
                          key={level}
                          type="button"
                          onClick={() => handleThinkingChange(level)}
                          className={cn(
                            "flex flex-col items-start rounded-xl border p-3 text-left transition-all",
                            isSelected
                              ? "border-primary bg-primary/10 text-primary-deep ring-1 ring-primary shadow-xs"
                              : "border-gray-200 bg-white hover:bg-gray-50 text-foreground"
                          )}
                        >
                          <div className="flex w-full items-center justify-between">
                            <span className="text-xs font-bold">{THINKING_LEVEL_LABELS[level]}</span>
                            {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                          </div>
                          <span className="mt-1 text-[10px] text-muted line-clamp-1">
                            {THINKING_LEVEL_DESCS[level]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 知识库检索智能路由规划 */}
                <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-foreground">智能路由规划 (Route Planner)</h2>
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          enableRoutePlan
                            ? "bg-primary/10 text-primary-deep ring-1 ring-primary/20"
                            : "bg-gray-100 text-muted ring-1 ring-gray-200"
                        )}>
                          {enableRoutePlan ? "已开启" : "已关闭（推荐）"}
                        </span>
                      </div>
                      <p className="text-xs text-muted max-w-xl leading-relaxed">
                        开启后，知识库检索前由大模型（LLM₁）动态分析意图并规划召回路径；关闭时，默认直接并行执行 <strong>4 路混合检索</strong>（正文稠密向量 + 增强块向量 + BM25 词面 + 原子问答向量）以获取最低首包延迟。
                      </p>
                    </div>

                    <label className="relative inline-flex cursor-pointer items-center shrink-0">
                      <input
                        type="checkbox"
                        checked={enableRoutePlan}
                        onChange={(e) => handleRoutePlanChange(e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="h-6 w-11 rounded-full bg-gray-200 peer-checked:bg-primary after:absolute after:top-0.5 after:left-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-xs after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-focus:outline-hidden" />
                    </label>
                  </div>
                </div>

                {/* 消息发送快捷键 */}
                <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs space-y-4">
                  <div>
                    <h2 className="text-sm font-bold text-foreground">消息发送快捷键</h2>
                    <p className="mt-1 text-xs text-muted">
                      定制输入框的回车键触发行为。
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-xl">
                    <button
                      type="button"
                      onClick={() => handleShortcutChange("enter")}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all",
                        sendShortcut === "enter"
                          ? "border-primary bg-primary/10 ring-1 ring-primary shadow-xs"
                          : "border-gray-200 bg-white hover:bg-gray-50"
                      )}
                    >
                      <div className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-gray-300">
                        {sendShortcut === "enter" && <div className="h-2 w-2 rounded-full bg-primary" />}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-foreground">Enter 发送</div>
                        <div className="mt-0.5 text-[11px] text-muted">Shift + Enter 换行（推荐日常沟通）</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleShortcutChange("cmd-enter")}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all",
                        sendShortcut === "cmd-enter"
                          ? "border-primary bg-primary/10 ring-1 ring-primary shadow-xs"
                          : "border-gray-200 bg-white hover:bg-gray-50"
                      )}
                    >
                      <div className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-gray-300">
                        {sendShortcut === "cmd-enter" && <div className="h-2 w-2 rounded-full bg-primary" />}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-foreground">Cmd / Ctrl + Enter 发送</div>
                        <div className="mt-0.5 text-[11px] text-muted">Enter 换行（适合编写长篇提示词）</div>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ==================== 数据与存储管理面板 ==================== */}
            {activeTab === "data" && (
              <div className="space-y-6">
                {/* 存储概览卡片 */}
                <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs">
                  <h2 className="text-sm font-bold text-foreground">本地存储概览</h2>
                  <p className="mt-1 text-xs text-muted">
                    系统在浏览器本地存储了您的会话历史草稿、知识库树展开状态及个性化界面偏好。
                  </p>

                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3.5">
                      <div className="text-[11px] text-muted">已占用存储容量</div>
                      <div className="mt-1 text-lg font-bold text-primary-deep">{storageUsage}</div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3.5">
                      <div className="text-[11px] text-muted">本地配置条目数</div>
                      <div className="mt-1 text-lg font-bold text-foreground">{cachedItemsCount}</div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3.5">
                      <div className="text-[11px] text-muted">对象存储引擎</div>
                      <div className="mt-1 text-sm font-bold text-foreground">MinIO (WebP)</div>
                    </div>
                  </div>
                </div>

                {/* 备份与数据导出 */}
                <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-bold text-foreground">导出偏好与本地会话数据</h3>
                    <p className="mt-0.5 text-xs text-muted">
                      将所有本地配置、对话记录草稿与树展开状态打包导出为 JSON 备份文件。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportData}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-4 py-2 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-gray-50 hover:border-gray-300"
                  >
                    <Download className="h-3.5 w-3.5 text-muted" />
                    <span>导出 JSON 备份</span>
                  </button>
                </div>

                {/* 缓存重置与清理 */}
                <div className="rounded-2xl border border-red-200/80 bg-red-50/40 p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xs font-bold text-red-600">重置本地会话与偏好缓存</h3>
                    <p className="mt-0.5 text-xs text-red-500/80">
                      清空本地存储的会话临时数据与树节点展开缓存（不会删除 MySQL 数据库及 MinIO 上的文件）。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearCache}
                    disabled={clearingCache}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-red-700 disabled:opacity-50"
                  >
                    {clearingCache ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    <span>清空本地缓存</span>
                  </button>
                </div>
              </div>
            )}

            {/* ==================== 5. 系统与连通性面板 ==================== */}
            {activeTab === "system" && (
              <div className="space-y-6">
                {/* 连通性状态卡片 */}
                <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-bold text-foreground">服务连通性监控</h2>
                      <p className="mt-1 text-xs text-muted">
                        实时检测与 Agentic Knowledge System 后端、LiteLLM Proxy 网关及数据库的连接状态。
                      </p>
                    </div>
                    <button
                      onClick={checkHealth}
                      className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-gray-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5 text-muted" />
                      <span>重新检测</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted">AKS 后端 API</span>
                        {healthStatus.api === "checking" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
                        {healthStatus.api === "online" && <span className="h-2 w-2 rounded-full bg-primary" />}
                        {healthStatus.api === "offline" && <span className="h-2 w-2 rounded-full bg-red-500" />}
                      </div>
                      <div className="text-sm font-bold text-foreground">
                        {healthStatus.api === "online" ? "正常运行" : healthStatus.api === "checking" ? "检测中..." : "未连接"}
                      </div>
                      <div className="text-[10px] text-muted font-mono">{API_CONFIG.BASE_URL || "http://localhost:8000"}</div>
                    </div>

                    <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted">LiteLLM Proxy</span>
                        {healthStatus.models === "checking" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
                        {healthStatus.models === "online" && <span className="h-2 w-2 rounded-full bg-primary" />}
                        {healthStatus.models === "offline" && <span className="h-2 w-2 rounded-full bg-red-500" />}
                      </div>
                      <div className="text-sm font-bold text-foreground">
                        {healthStatus.models === "online" ? `${chatModels.length} 个模型可用` : healthStatus.models === "checking" ? "检测中..." : "服务异常"}
                      </div>
                      <div className="text-[10px] text-muted">模型动态分发网关</div>
                    </div>

                    <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted">网络往返延迟</span>
                        <Server className="h-3.5 w-3.5 text-muted" />
                      </div>
                      <div className="text-sm font-bold text-foreground">
                        {healthStatus.latency !== null ? `${healthStatus.latency} ms` : "---"}
                      </div>
                      <div className="text-[10px] text-muted">HTTP / REST 探测</div>
                    </div>
                  </div>
                </div>

                {/* 架构与技术栈信息卡片 */}
                <div className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs space-y-4">
                  <h2 className="text-sm font-bold text-foreground">系统与版本信息</h2>

                  <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    <div className="flex justify-between rounded-xl bg-gray-50 p-3">
                      <span className="text-muted">系统架构：</span>
                      <span className="font-mono font-medium text-foreground">Agentic Knowledge System (AKS)</span>
                    </div>
                    <div className="flex justify-between rounded-xl bg-gray-50 p-3">
                      <span className="text-muted">前端版本：</span>
                      <span className="font-mono font-medium text-foreground">v0.1.0 (Next.js 16 App Router)</span>
                    </div>
                    <div className="flex justify-between rounded-xl bg-gray-50 p-3">
                      <span className="text-muted">持久化存储：</span>
                      <span className="font-mono font-medium text-foreground">MySQL 8.0 + Milvus + MinIO</span>
                    </div>
                    <div className="flex justify-between rounded-xl bg-gray-50 p-3">
                      <span className="text-muted">用户画像存储：</span>
                      <span className="font-mono font-medium text-primary-deep">user_profile (MinIO WebP)</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/** 设置页模型选择：白底自定义菜单，避免原生 select 的系统暗色弹层 */
function SettingsModelSelect({
  models,
  value,
  onChange,
  loading,
}: {
  models: ChatModelItem[];
  value: string;
  onChange: (modelId: string) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const current = useMemo(
    () => models.find((m) => m.id === value),
    [models, value],
  );
  const groups = useMemo(() => groupChatModelsByProvider(models), [models]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const triggerTitle = current?.label ?? (value || "选择默认模型");
  const triggerMeta = current
    ? [current.provider, current.supports_thinking ? "支持深度思考" : null]
        .filter(Boolean)
        .join(" · ")
    : loading
      ? "正在加载可用模型…"
      : models.length === 0
        ? "暂无可用模型"
        : "";

  return (
    <div className="relative max-w-md">
      <button
        type="button"
        disabled={loading}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border bg-white px-3.5 py-2.5 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
          open
            ? "border-primary shadow-xs ring-1 ring-primary/15"
            : "border-gray-200 hover:border-primary/40",
          loading && "cursor-wait opacity-70",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {triggerTitle}
          </div>
          {triggerMeta ? (
            <div className="mt-0.5 truncate text-[11px] text-muted">
              {triggerMeta}
            </div>
          ) : null}
        </div>
        {loading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        ) : (
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted transition-transform",
              open && "rotate-180 text-primary-deep",
            )}
          />
        )}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            id={listId}
            role="listbox"
            aria-label="默认推理模型"
            className="absolute left-0 right-0 z-40 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
          >
            {groups.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted">
                {loading ? "正在加载模型…" : "暂无可用模型"}
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.provider} role="presentation">
                  <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
                    {group.provider}
                  </div>
                  {group.items.map((model) => {
                    const selected = model.id === value;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          onChange(model.id);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30",
                          selected
                            ? "bg-primary/10 text-primary-deep"
                            : "text-foreground hover:bg-gray-50",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              "truncate text-sm",
                              selected ? "font-semibold" : "font-medium",
                            )}
                          >
                            {model.label}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-muted">
                            {model.supports_thinking
                              ? `${model.provider} · 支持深度思考`
                              : model.provider}
                          </div>
                        </div>
                        {selected ? (
                          <Check className="h-4 w-4 shrink-0 text-primary" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
