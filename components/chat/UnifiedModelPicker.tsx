"use client";

/**
 * 统一模型与思考强度选择器（Cursor 风格分步展开双卡片）
 *
 * 知识库对话框与首页通用 Agent 共用同一实现，保证两处模型选择的交互与视觉
 * 完全一致。交互逻辑：
 *   1. 触发按钮：点击时仅在正上方弹出当前模型信息主卡片（Effort 档位 + Model 项）。
 *   2. 点击主卡片中的 Model 项后，才展开第二张卡片（展示所有模型，顺序为后端分组排序）。
 *   3. 思考强度记忆：按模型记忆上次使用的档位（localStorage 持久化，知识库与
 *      Agent 共享同一份记忆——同一个模型，同一个偏好）。
 *   4. 自适应方向：第二张卡片默认在右侧显示，若右侧屏幕空间不足则自动切换到左侧显示。
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Search,
  X,
} from "lucide-react";

import {
  THINKING_LEVEL_LABELS,
  THINKING_LEVEL_DESCS,
  isSwitchOnlyThinking,
  isEffortThinking,
  getOnThinkingLevel,
} from "@/lib/chat/thinking-levels";
import { setSettingsDefaultThinkingLevel } from "@/lib/chat/chat-preferences";
import { cn } from "@/lib/utils";

/**
 * 选择器所需的最小模型字段。知识库 `ChatModelItem` 与 Agent `AgentModelItem`
 * 同形（/api/chat/models 与 /api/v1/models 契约对齐），两者均可直接传入。
 */
export interface PickerModelItem {
  id: string;
  label: string;
  provider: string;
  supports_thinking?: boolean;
  thinking_levels?: string[];
  default_thinking_level?: string | null;
  supports_multimodal?: boolean;
}

/** 圆润灯泡图标（光学中心向左微调，与 Lucide 系列线性图标垂直严格对齐） */
export function ThinkingBulbIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* 饱满圆润的球形灯泡主体（中心 x 坐标微调至 11.2，补偿右侧高光带来的视觉右偏） */}
      <path d="M8.2 17h6c.6-1 1.4-1.8 2.3-3.2A7.5 7.5 0 1 0 5.9 13.8c.9 1.4 1.7 2.2 2.3 3.2z" />
      {/* 内部高光反光弧线 */}
      <path d="M12.8 5.8a4.5 4.5 0 0 1 2.7 3" />
      {/* 底部短横底座线 */}
      <path d="M8.7 20.5h5" />
    </svg>
  );
}

/** 模型能力图标：思考 / 多模态（仅在模型选择列表中展示） */
export function ModelCapabilityIcons({ model }: { model: PickerModelItem }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <ThinkingBulbIcon
        className={cn(
          "h-3 w-3",
          model.supports_thinking ? "text-primary" : "text-gray-300",
        )}
        aria-label={model.supports_thinking ? "支持思考" : "不支持思考"}
      />
      <Eye
        className={cn(
          "h-3 w-3",
          model.supports_multimodal ? "text-primary" : "text-gray-300",
        )}
        aria-label={model.supports_multimodal ? "支持多模态" : "不支持多模态"}
      />
    </span>
  );
}

/**
 * 按模型记忆用户上次使用的思考档位（模型列表里展示"上次用的是什么档"）。
 * key 沿用 knowledge-chat 前缀的历史值，知识库与 Agent 的记忆互通。
 */
const MODEL_LEVEL_STORAGE_PREFIX = "knowledge-chat-model-level-v1";

export function getLastModelLevel(modelId: string): string | null {
  if (typeof window === "undefined" || !modelId) return null;
  try {
    return window.localStorage.getItem(`${MODEL_LEVEL_STORAGE_PREFIX}:${modelId}`);
  } catch {
    return null;
  }
}

function setLastModelLevel(modelId: string, level: string): void {
  if (typeof window === "undefined" || !modelId || !level) return;
  try {
    window.localStorage.setItem(
      `${MODEL_LEVEL_STORAGE_PREFIX}:${modelId}`,
      level,
    );
  } catch {
    // ignore
  }
}

const EFFORT_LEVEL_TITLES: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
};

export function UnifiedModelPicker({
  modelId,
  thinkingLevel,
  models,
  onModelChange,
  onThinkingLevelChange,
  disabled,
}: {
  modelId: string;
  thinkingLevel: string;
  models: PickerModelItem[];
  onModelChange: (modelId: string) => void;
  onThinkingLevelChange: (level: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [showAllModels, setShowAllModels] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [placement, setPlacement] = useState<"right" | "left">("right");
  const containerRef = useRef<HTMLDivElement>(null);
  const firstCardRef = useRef<HTMLDivElement>(null);

  // 按模型记忆当前档位：模型列表里每个模型展示"上次使用"的档（开关模型
  // 显示 On/Off），切回该模型时即可看到并沿用之前的设置
  useEffect(() => {
    if (modelId && thinkingLevel) {
      setLastModelLevel(modelId, thinkingLevel);
    }
  }, [modelId, thinkingLevel]);

  // 关闭主浮层时，同时重置子面板和搜索输入
  useEffect(() => {
    if (!open) {
      setShowAllModels(false);
      setSearchQuery("");
    }
  }, [open]);

  // 点击外部区域或按 Esc 键安全收起
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // 动态测量子卡片位置：默认在右边显示，若右边空间不够则放到左边
  useLayoutEffect(() => {
    if (!open || !showAllModels) return;
    const updatePlacement = () => {
      if (!firstCardRef.current) return;
      const rect = firstCardRef.current.getBoundingClientRect();
      const secondCardWidth = 288; // 子卡片宽度约 288px
      const spaceOnRight = window.innerWidth - rect.right;
      if (spaceOnRight < secondCardWidth + 16) {
        setPlacement("left");
      } else {
        setPlacement("right");
      }
    };

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    return () => window.removeEventListener("resize", updatePlacement);
  }, [open, showAllModels]);

  const currentModel = useMemo(() => {
    return models.find((m) => m.id === modelId) ?? models[0];
  }, [modelId, models]);

  const displayModelLabel = useMemo(() => {
    if (!modelId) return "选择模型";
    if (currentModel) return currentModel.label;
    const slash = modelId.lastIndexOf("/");
    return slash >= 0 ? modelId.slice(slash + 1) : modelId;
  }, [modelId, currentModel]);

  const switchOnlyThinking = isSwitchOnlyThinking(
    currentModel?.thinking_levels,
  );
  const effortThinking = isEffortThinking(currentModel?.thinking_levels);
  const onThinkingLevel = getOnThinkingLevel(currentModel?.thinking_levels);

  const currentEffortLabel = useMemo(() => {
    if (!currentModel?.supports_thinking || thinkingLevel === "off")
      return null;
    if (switchOnlyThinking) return "Thinking";
    return EFFORT_LEVEL_TITLES[thinkingLevel] ?? thinkingLevel;
  }, [currentModel, thinkingLevel, switchOnlyThinking]);

  /**
   * 移动端触发按钮的文案：只表达思考档位。
   * 关闭或模型不支持思考时恒为「关」，模型列表尚未加载时退回「模型」。
   */
  const mobileThinkingLabel = currentEffortLabel ?? (currentModel ? "关" : "模型");

  // 当前模型支持的思考档位
  const availableThinkingLevels = useMemo(() => {
    if (!currentModel?.supports_thinking) return [];
    return currentModel.thinking_levels?.length
      ? currentModel.thinking_levels
      : ["off"];
  }, [currentModel]);

  // 展示顺序完全由后端分组排序（provider 分组、组内按名称）决定；
  // 本地仅保留搜索过滤，不做任何重排。
  const displayedModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      return models.filter(
        (m) =>
          m.label.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q),
      );
    }
    return models;
  }, [models, searchQuery]);

  return (
    // 移动端保持 static：浮层改为相对输入框整宽展开（见下方 bottom-full left-0 right-0），
    // sm 以上才把定位上下文收回按钮自身，维持原来的右对齐浮层。
    <div className="shrink-0 sm:relative" ref={containerRef}>
      {/* 底部触发按钮 */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((v) => !v);
        }}
        className={cn(
          "flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs text-neutral-700 transition-colors hover:bg-neutral-100/80 hover:text-neutral-900",
          open && "bg-neutral-100 text-neutral-900",
          disabled && "cursor-not-allowed opacity-60",
        )}
        title={
          currentModel?.supports_thinking && thinkingLevel !== "off"
            ? switchOnlyThinking
              ? `${displayModelLabel} · Thinking on`
              : `${displayModelLabel} · 思考: ${THINKING_LEVEL_LABELS[thinkingLevel] ?? thinkingLevel}`
            : displayModelLabel
        }
      >
        {/* 移动端：只留思考档位（无档位时显示「关」），模型名只在弹层里出现 */}
        <span
          className={cn(
            "inline-flex items-center gap-1 sm:hidden",
            currentEffortLabel ? "text-primary-deep" : "text-neutral-500",
          )}
        >
          <ThinkingBulbIcon className="h-3 w-3 shrink-0" />
          {mobileThinkingLabel}
        </span>
        <span className="hidden font-normal sm:inline">{displayModelLabel}</span>
        {currentEffortLabel ? (
          <span className="hidden text-neutral-400 font-normal sm:inline">
            {currentEffortLabel}
          </span>
        ) : null}
        <ChevronDown className="h-3 w-3 shrink-0 text-neutral-400 opacity-80" />
      </button>

      {/* 弹出浮层：主卡片弹出在正上方 */}
      {open ? (
        <div
          className={cn(
            "absolute bottom-full z-50 mb-2 select-none max-w-[calc(100vw-1.5rem)]",
            // 移动端：贴着输入框整宽展开，左右都不出屏
            "left-0 right-0",
            // sm 以上：回到触发按钮正上方的右对齐浮层
            "sm:left-auto sm:right-0 sm:w-auto"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 主卡片（正上方）：Effort 思考强度选择 + Model 切换入口。
              移动端展开模型列表时整张让位给列表卡片（见下方），避免两张卡上下叠高。 */}
          <div
            ref={firstCardRef}
            className={cn(
              "w-full sm:w-44 max-w-[calc(100vw-2rem)] shrink-0 rounded-2xl border border-neutral-200/90 bg-white p-1.5 shadow-2xl animate-in fade-in zoom-in-95 duration-100 relative",
              showAllModels && "hidden sm:block",
            )}
          >
            {/* 思考：强度模型显示 Effort；开关模型显示关/开 */}
            <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-neutral-400 uppercase">
              {switchOnlyThinking ? "Thinking" : "Effort"}
            </div>
            {effortThinking ? (
              <div className="space-y-0.5">
                {availableThinkingLevels.map((lvl) => {
                  const isSelected = thinkingLevel === lvl;
                  const label = EFFORT_LEVEL_TITLES[lvl] ?? lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => {
                        setSettingsDefaultThinkingLevel(lvl);
                        onThinkingLevelChange(lvl);
                        setOpen(false);
                      }}
                      title={THINKING_LEVEL_DESCS[lvl]}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-neutral-100",
                        isSelected
                          ? "bg-neutral-100/90 font-medium text-neutral-900"
                          : "text-neutral-700",
                      )}
                    >
                      <span>{label}</span>
                      {isSelected ? (
                        <Check className="h-3.5 w-3.5 text-neutral-900 shrink-0 ml-1" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : switchOnlyThinking ? (
              <div className="space-y-0.5">
                {(
                  [
                    { lvl: "off", label: "关" },
                    { lvl: onThinkingLevel, label: "开" },
                  ] as const
                ).map((it) => {
                  const isSelected =
                    thinkingLevel === it.lvl ||
                    (it.label === "开" && thinkingLevel !== "off");
                  return (
                    <button
                      key={it.lvl}
                      type="button"
                      onClick={() => {
                        setSettingsDefaultThinkingLevel(it.lvl);
                        onThinkingLevelChange(it.lvl);
                        setOpen(false);
                      }}
                      title={it.label === "开" ? "开启思考链" : "关闭思考链"}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-neutral-100",
                        isSelected
                          ? "bg-neutral-100/90 font-medium text-neutral-900"
                          : "text-neutral-700",
                      )}
                    >
                      <span>{it.label}</span>
                      {isSelected ? (
                        <Check className="h-3.5 w-3.5 text-neutral-900 shrink-0 ml-1" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-2.5 py-1.5 text-xs text-neutral-400">
                不支持思考
              </div>
            )}

            <div className="my-1.5 h-px bg-neutral-100" />

            {/* Model 展开按钮：点击后才显示所有模型的卡片 */}
            <div className="px-2 py-1 text-[10px] font-semibold tracking-wider text-neutral-400 uppercase">
              Model
            </div>
            <button
              type="button"
              onClick={() => setShowAllModels((v) => !v)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors hover:bg-neutral-100",
                showAllModels
                  ? "bg-neutral-100 text-neutral-900"
                  : "bg-neutral-50/70 text-neutral-800",
              )}
            >
              <span className="truncate">{displayModelLabel}</span>
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform",
                  showAllModels &&
                    (placement === "left"
                      ? "-translate-x-0.5 text-neutral-700"
                      : "translate-x-0.5 text-neutral-700"),
                )}
              />
            </button>
          </div>

          {/* 第二张卡片：所有模型具体信息（点击 Model 后展开）。
              与主卡片同级：主卡片在移动端 hidden 时才不会连带把它一起 display:none，
              桌面端依旧靠 left-full / right-full 贴在主卡片左右两侧。 */}
          {showAllModels ? (
            <div
              className={cn(
                "w-full max-w-[calc(100vw-2rem)] rounded-2xl border border-neutral-200/90 bg-white shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-100",
                "sm:absolute sm:bottom-0 sm:w-72",
                placement === "right"
                  ? "sm:left-full sm:ml-1.5"
                  : "sm:right-full sm:mr-1.5",
              )}
            >
              {/* 顶部搜索框（移动端带返回，回到思考档位卡片） */}
              <div className="flex items-center gap-2 border-b border-neutral-100 px-3 py-2 bg-neutral-50/50">
                <button
                  type="button"
                  onClick={() => setShowAllModels(false)}
                  className="-ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-400 transition-colors hover:text-neutral-700 sm:hidden"
                  title="返回思考设置"
                  aria-label="返回思考设置"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <Search className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
                <input
                  autoFocus
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search models"
                  className="min-w-0 flex-1 bg-transparent text-xs text-neutral-900 outline-none placeholder:text-neutral-400"
                />
                {searchQuery ? (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="text-neutral-400 hover:text-neutral-600"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>

              {/* 模型列表（移动端按视口高度收敛，避免小屏上顶出屏幕） */}
              <div className="max-h-[45vh] overflow-y-auto p-1.5 space-y-0.5 sm:max-h-72">
                {models.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-xs text-neutral-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>加载模型中…</span>
                  </div>
                ) : displayedModels.length === 0 ? (
                  <div className="py-8 text-center text-xs text-neutral-400">
                    未找到匹配模型
                  </div>
                ) : (
                  displayedModels.map((m) => {
                    const isSelected = m.id === modelId;
                    // 档位角标：选中的模型显示当前档；未选中的显示该模型
                    // 上次使用的档（无记忆时回退模型默认档）。
                    // 开关模型（仅 off/medium 两档）统一显示英文 On/Off——
                    // ``medium`` 是内部的「开」哨兵，不能被误展示为 Medium；
                    // 强度模型显示档位标题，Off 档不展示角标（保持原行为）。
                    const toggleModel = !isEffortThinking(m.thinking_levels);
                    const remembered = isSelected
                      ? null
                      : getLastModelLevel(m.id);
                    // 开关模型无记忆时默认 On（显式回退 medium，不依赖
                    // 后端 default）；强度模型回退模型默认档
                    const activeLevel = isSelected
                      ? thinkingLevel
                      : toggleModel
                        ? (remembered ?? "medium")
                        : (remembered ?? (m.default_thinking_level || "medium"));
                    const effortText = toggleModel
                      ? activeLevel === "off"
                        ? "Off"
                        : "On"
                      : (EFFORT_LEVEL_TITLES[activeLevel] ??
                        (isSelected ? thinkingLevel : "Medium"));

                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onModelChange(m.id);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-neutral-100",
                          isSelected
                            ? "bg-neutral-100/90 font-medium text-neutral-900"
                            : "text-neutral-700",
                        )}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span
                            className={cn(
                              "truncate",
                              isSelected
                                ? "font-medium text-neutral-900"
                                : "text-neutral-700",
                            )}
                          >
                            {m.label}
                          </span>
                          {effortText &&
                          (toggleModel || effortText !== "Off") ? (
                            <span className="shrink-0 text-[11px] text-neutral-400 font-normal">
                              {effortText}
                            </span>
                          ) : null}
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5 ml-1.5">
                          <ModelCapabilityIcons model={m} />
                          {isSelected ? (
                            <Check className="h-3.5 w-3.5 text-neutral-900 shrink-0" />
                          ) : null}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* 底部信息条 */}
              <div className="border-t border-neutral-100 px-3 py-1.5 bg-neutral-50/50 flex items-center justify-between text-[10px] text-neutral-400">
                <span>
                  {searchQuery
                    ? `${displayedModels.length} 个结果`
                    : `共 ${models.length} 个模型`}
                </span>
                <span className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-0.5">
                    <ThinkingBulbIcon className="h-2.5 w-2.5 text-primary" /> 思考
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    <Eye className="h-2.5 w-2.5 text-primary" /> 视觉
                  </span>
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
