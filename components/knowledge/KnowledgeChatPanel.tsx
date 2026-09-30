"use client";

import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlignJustify,
  AlertTriangle,
  ArrowUp,
  ArrowUpRight,
  Atom,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  CircleStop,
  Clock,
  Copy,
  Cpu,
  Database,
  Eye,
  ExternalLink,
  FileText,
  Folder,
  Image as ImageIcon,
  Layers,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Plus,
  Search,
  Share2,
  Sparkle,
  Sparkles,
  Table as TableIcon,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useKnowledgeChat } from "@/lib/hooks/useKnowledgeChat";
import { useChatModels, type ChatModelItem } from "@/lib/api/chat-models";
import {
  ConfirmModal,
  type ConfirmAction,
} from "@/components/knowledge/ConfirmModal";
import { MarkdownAnswer } from "@/components/knowledge/MarkdownAnswer";
import { ContextIndicator } from "@/components/knowledge/ContextIndicator";
import { ReportViewer } from "@/components/knowledge/ReportViewer";
import { RecallPathSection } from "@/components/knowledge/RecallFlowChart";
import { QueryParamsSection } from "@/components/knowledge/QueryParamsPanel";
import { CitationPreviewMarkdown } from "@/components/knowledge/CitationPreviewMarkdown";
import { ImagePreviewPopover } from "@/components/knowledge/ImagePreviewPopover";
import { buildChunkImageRawUrl } from "@/lib/api/knowledge";
import {
  normalizeCitationAnnotation,
  stripHtmlToPlain,
} from "@/components/knowledge/citationPreviewUtils";
import type {
  ChatPhase,
  ChatSessionInfo,
  Citation,
  RecallStats,
  RetrievalChunkPreview,
  ToolCallRecord,
  UiChatMessage,
} from "@/lib/chat-types";
import { cn, formatDate } from "@/lib/utils";
import { fetchSkills, type SkillDescriptor } from "@/lib/api/skills";
import { SlashSkillMenu } from "@/components/skills/SlashSkillMenu";
import {
  AtFileMentionMenu,
  type AtMention,
} from "@/components/knowledge/AtFileMentionMenu";
import {
  MentionComposer,
  type MentionComposerHandle,
} from "@/components/knowledge/MentionComposer";
import {
  INTERACTION_MODE_OPTIONS,
  type InteractionMode,
  modeFromInteraction,
} from "@/lib/chat/interaction-modes";
import {
  THINKING_LEVEL_LABELS,
  THINKING_LEVEL_DESCS,
  clampThinkingLevel,
  isSwitchOnlyThinking,
  isEffortThinking,
  getOnThinkingLevel,
} from "@/lib/chat/thinking-levels";
import {
  getSettingsDefaultThinkingLevel,
  pickSettingsDefaultModel,
  setSettingsDefaultThinkingLevel,
} from "@/lib/chat/chat-preferences";
import { isAction } from "@/lib/actions/chat-actions";

interface KnowledgeChatPanelProps {
  knowledgeBaseId: string | null;
  knowledgeBaseName?: string;
  /**
   * 用户通过文件夹行「对话」按钮进入的文件夹 ID（v0.8.0 文件夹问答）。
   * 传入后：
   *   - 「新建会话」按钮会自动用此 folder 创建 folder scope session；
   *   - active session 的 folder_id 会与之比对，决定 banner 文案。
   * 不传 / null → 走 KB scope（与 v0.7.0 行为一致）。点文件夹展开不会写入此值。
   */
  selectedFolderId?: string | null;
  /** 文件夹的可读名称，仅用于 banner / 按钮文案 */
  selectedFolderName?: string | null;
  /** 仍然兼容外层禁用 */
  disabled?: boolean;
  disabledReason?: string;
  /** 提示横幅文案（非阻塞，仅作为状态或进度说明） */
  noticeBanner?: string;
  /** 用户登录态（未登录时不发任何后端请求） */
  enabled?: boolean;
  /**
   * 紧凑模式：用于父容器宽度受限的场景（如文件详情侧栏）。
   * 此模式下会隐藏左侧会话栏，改为顶栏 popover；toolbar 仅保留必要 chip。
   */
  compact?: boolean;
  className?: string;
  /** 移动端打开/收起知识库目录与文件树抽屉 */
  onToggleMobileTree?: () => void;
}

const STARTER_PROMPTS = [
  "总结当前知识库里最值得先看的内容",
  "梳理这个知识库适合怎么提问",
  "从当前资料里提炼重点和潜在风险",
];

const SESSION_DEFAULT_VISIBLE = 5;

/** 对话主内容最大宽度，居中排版（现代流式布局，保持舒适行宽与适度留白） */
const CHAT_CONTENT_CLASS = "mx-auto w-full max-w-[880px]";
// 输入区比对话区左右各宽 24px（居中对称）：对话内容保持 880px 阅读列宽，
// 输入框作为独立悬浮控件适度加宽以示区分。
const COMPOSER_CONTENT_CLASS = "mx-auto w-full max-w-[928px]";

interface ChatSettings {
  interactionMode: InteractionMode;
  /** 思考强度档位（pi 标准 7 档之一）；模型不支持思考时为 "off" */
  thinkingLevel: string;
  enableMultimodal: boolean;
  /**
   * 用户从 `/api/chat/models` 选定的 LiteLLM 模型字符串（如 `openai/gpt-4o-mini`）。
   *
   * - 空字符串 / null：表示用户没有显式选择，让后端走 session 默认（最终落到
   *   `model_preset`，也就是后台 agent 用的那一档）。
   * - 非空：每轮 chat WS 请求会带上 `model` 字段，覆盖 session 已存的偏好。
   *
   * 注意：模型 preset 不再出现在前端，是后端抽取 / 起标题 / 摘要等场景的事。
   */
  model: string;
}

// ============================================================
// 通用展示子组件（与上一版语义一致）
// ============================================================

function PhasePill({ phase }: { phase: ChatPhase }) {
  const map: Record<
    ChatPhase,
    { label: string; tone: "muted" | "running" | "error" | "ok" }
  > = {
    idle: { label: "空闲", tone: "muted" },
    connecting: { label: "连接中…", tone: "running" },
    ready: { label: "就绪", tone: "ok" },
    running: { label: "回答中…", tone: "running" },
    stopped: { label: "已停止", tone: "muted" },
    error: { label: "异常", tone: "error" },
    disconnected: { label: "已断开", tone: "error" },
  };
  const { label, tone } = map[phase];
  return (
    <span
      className={cn(
        // shrink-0 + nowrap：状态胶囊在移动端窄头部里不能被标题挤到换行
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px]",
        tone === "muted" && "bg-gray-100 text-muted",
        tone === "ok" && "bg-emerald-50 text-emerald-700",
        tone === "running" && "bg-primary/10 text-primary",
        tone === "error" && "bg-red-50 text-red-600",
      )}
    >
      {tone === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
      {label}
    </span>
  );
}

// ============================================================
// 推理轨道：思考=脑、检索=书、导航=罗盘、其它工具=扳手、正文旁白=灰点（不折叠）
// ============================================================

type TraceStep =
  | {
      kind: "think";
      key: string;
      thinking: string;
      inflight: boolean;
      thinkingMs?: number;
    }
  | { kind: "note"; key: string; content: string }
  | { kind: "tool"; key: string; tc: ToolCallRecord };

/**
 * 把一组 assistant 轮次里的思考、过程旁白与工具调用按发生顺序摊平成一条轨道。
 *
 * 中间轮的正文（"我先获取关键章节，再做概括"）角色上等同思考，只是走了
 * content 通道，因此一并收进轨道；留在轨道外的只有最后一轮的正文，以及
 * 任意一轮里的 HTML 报告——报告是交付物而非过程，不能被折叠掉。
 */
function buildTraceSteps(messages: UiChatMessage[]): TraceStep[] {
  const steps: TraceStep[] = [];
  const lastIdx = messages.length - 1;
  messages.forEach((m, idx) => {
    if (m.thinking) {
      steps.push({
        kind: "think",
        key: `${m.id}-think`,
        thinking: m.thinking,
        inflight: Boolean(m.inflight) && m.thinking_ms == null,
        thinkingMs: m.thinking_ms,
      });
    }
    // 旁白发生在它将要调用的工具之前，故插在 tool_calls 之前
    if (idx !== lastIdx && m.content && !hasHtmlReportStart(m.content)) {
      steps.push({
        kind: "note",
        key: `${m.id}-note`,
        content: m.content,
      });
    }
    for (const tc of m.tool_calls ?? []) {
      steps.push({ kind: "tool", key: tc.id, tc });
    }
  });
  return steps;
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

const RETRIEVAL_STAGE_LABEL: Record<string, string> = {
  planning: "大模型规划检索路线…",
  searching: "多路召回中…",
  reranking: "精排结果中…",
};

const IMAGE_TOOL_STAGE_LABEL: Record<string, string> = {
  loading_images: "加载图片中…",
  calling_vlm: "调用多模态大模型理解图片…",
};

const KB_SEARCH_TOOLS = new Set(["search_knowledge_base"]);
const IMAGE_TOOL_NAMES = new Set(["read_image_chunks"]);

/** 圆润灯泡图标（光学中心向左微调，与 Lucide 系列线性图标垂直严格对齐） */
function ThinkingBulbIcon({ className }: { className?: string }) {
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

/** 适中比例放大镜图标（镜圈半径微调至 6.8，黄金比例舒展） */
function GrepSearchIcon({ className }: { className?: string }) {
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
      {/* 适中镜圈（半径微调至 6.8，介于默认 8 与极小 5.8 之间） */}
      <circle cx="10.5" cy="10.5" r="6.8" />
      {/* 比例协调的倾斜镜柄 */}
      <path d="m21 21-5.7-5.7" />
    </svg>
  );
}

function formatExecutionModelLabel(model?: string | null): string {
  if (!model) return "";
  return model.replace(/^litellm_proxy\//, "").replace(/^dashscope\//, "");
}

/** 提取思考文本首部摘要（单行预览） */
/** 清洗思考正文：去掉行首 markdown 噪声、压平换行，得到单行文本 */
function cleanThinkText(thinking: string): string {
  return thinking
    .replace(/^[#\s*`>-]+/gm, "")
    .replace(/\n+/g, " ")
    .trim();
}

/** 思考结束后的稳定摘要：取单行文本头部 */
function extractThinkSummary(thinking: string): string {
  const clean = cleanThinkText(thinking);
  if (clean.length <= 90) return clean;
  return clean.slice(0, 90) + "…";
}

/**
 * 流式思考的单行滚动预览：取单行文本**尾部**。
 *
 * 取头部的话，前 90 字之后预览就冻结了，看起来像卡住；取尾部才能随增量
 * 持续变化，形成「一行上不断变化的文字」。
 */
function extractThinkRollingPreview(thinking: string, maxLen = 110): string {
  const clean = cleanThinkText(thinking);
  if (clean.length <= maxLen) return clean;
  return "…" + clean.slice(-maxLen);
}

/** 友好中文工具名称映射（对齐 DeepSeek / Harness 风格） */
function getToolFriendlyName(name: string): string {
  switch (name) {
    case "search_knowledge_base":
      return "检索";
    case "grep_chunks":
      return "Grep";
    case "skeleton":
      return "大纲";
    case "drill_down":
      return "下钻";
    case "roll_up":
      return "向上汇总";
    case "context_window":
      return "上下文窗口";
    case "read_chunks":
      return "读取";
    case "read_image_chunks":
      return "读图";
    case "skills_list":
      return "技能列表";
    case "skill_view":
      return "技能详情";
    default:
      return name;
  }
}

/** 对应工具的线性图标 */
function getToolIcon(name: string): ComponentType<{ className?: string }> {
  switch (name) {
    case "search_knowledge_base":
      return BookOpen;
    case "grep_chunks":
      return GrepSearchIcon;
    case "skeleton":
      return Compass;
    case "drill_down":
    case "roll_up":
    case "context_window":
      return Layers;
    case "read_chunks":
      return FileText;
    case "read_image_chunks":
      return ImageIcon;
    case "skills_list":
    case "skill_view":
      return Wrench;
    default:
      return Wrench;
  }
}

/** 提取工具调用的核心参数作为单行摘要 */
function extractToolSummary(tc: ToolCallRecord): string {
  const args = (tc.arguments || {}) as Record<string, unknown>;
  if (tc.name === "search_knowledge_base" && args.query_text) {
    return String(args.query_text);
  }
  if (tc.name === "grep_chunks" && (args.pattern || args.query)) {
    return String(args.pattern || args.query);
  }
  if (tc.name === "skeleton" && (args.document_id || args.file_name)) {
    return String(args.document_id || args.file_name);
  }
  if (tc.name === "drill_down") {
    const anchor = args.section_id || args.document_id || "";
    const target = args.target ? ` → ${args.target}` : "";
    return `${anchor}${target}`.trim() || "下钻检索";
  }
  if (tc.name === "roll_up") {
    const anchor = args.chunk_id || args.section_id || "";
    const target = args.target ? ` → ${args.target}` : "";
    return `${anchor}${target}`.trim() || "向上回溯";
  }
  if (tc.name === "context_window" && args.chunk_id) {
    return `chunk: ${args.chunk_id}`;
  }
  if (tc.name === "read_chunks" && Array.isArray(args.chunk_ids)) {
    return args.chunk_ids.join(", ") || `${args.chunk_ids.length} 个片段`;
  }
  if (tc.name === "read_image_chunks") {
    if (Array.isArray(args.chunk_ids)) {
      return args.chunk_ids.join(", ") || `${args.chunk_ids.length} 张图片`;
    }
    if (args.prompt) return String(args.prompt);
  }
  if (tc.name === "skills_list") {
    return args.category ? `分类: ${args.category}` : "全部可用技能";
  }
  if (tc.name === "skill_view" && args.skill_name) {
    return String(args.skill_name);
  }

  for (const [key, val] of Object.entries(args)) {
    if (typeof val === "string" && val.trim()) {
      return `${key}: ${val}`;
    }
    if (Array.isArray(val) && val.length > 0) {
      return `${key}: [${val.join(", ")}]`;
    }
  }

  if (tc.argsText) {
    return tc.argsText.slice(0, 80);
  }

  return tc.name || "执行工具";
}

/** 折叠态摘要文案：对齐 DeepSeek Harness 风格 */
function traceSummaryLabel(steps: TraceStep[], inflight: boolean): string {
  if (inflight) {
    const running = [...steps]
      .reverse()
      .find((s) =>
        s.kind === "tool"
          ? s.tc.inflight
          : s.kind === "think" && s.inflight,
      );
    if (running?.kind === "tool") {
      const tc = running.tc;
      const stage =
        (tc.retrieval_progress
          ? RETRIEVAL_STAGE_LABEL[tc.retrieval_progress]
          : null) ??
        (tc.execution_stage
          ? IMAGE_TOOL_STAGE_LABEL[tc.execution_stage]
          : null);
      return stage ?? `正在调用 ${getToolFriendlyName(tc.name)}…`;
    }
    if (running) return "正在思考…";
    return "正在检索与推理…";
  }

  const toolCount = steps.filter((s) => s.kind === "tool").length;
  const thinkCount = steps.filter((s) => s.kind === "think").length;
  const noteCount = steps.filter((s) => s.kind === "note").length;

  const parts: string[] = [];
  if (toolCount > 0) {
    parts.push(`${toolCount} 次工具调用`);
  }
  if (thinkCount > 0) {
    parts.push(`${thinkCount} 次思考`);
  }
  if (noteCount > 0) {
    parts.push(`${noteCount} 条消息`);
  }
  if (parts.length === 0) {
    parts.push(`${steps.length} 个步骤`);
  }

  const totalMs = steps.reduce((sum, s) => {
    if (s.kind === "tool") return sum + (s.tc.time_ms ?? 0);
    if (s.kind === "think") return sum + (s.thinkingMs ?? 0);
    return sum;
  }, 0);

  if (totalMs > 0 && formatSeconds(totalMs) !== "0.0s") {
    parts.push(formatSeconds(totalMs));
  }

  return parts.join(" · ");
}

/**
 * 推理与工具折叠流（DeepSeek Harness 极简扁平风格，无外层卡片包裹）
 */
function TraceTimeline({
  steps,
  inflight,
  onViewSearchResults,
  aliasToChunkId,
  answerStarted = false,
}: {
  steps: TraceStep[];
  inflight: boolean;
  onViewSearchResults?: (
    citations: Citation[],
    params?: Record<string, unknown>,
    recallStats?: RecallStats,
  ) => void;
  aliasToChunkId: Map<string, string>;
  /** 主对话区是否已开始输出正文（最后一条 assistant 消息有 content 增量） */
  answerStarted?: boolean;
}) {
  const [open, setOpen] = useState(inflight);
  // 用户是否手动点击过折叠按钮：一旦点击，本 turn 内不再被自动 effect 覆盖
  const userToggled = useRef(false);
  const prevInflight = useRef(inflight);

  // 推理阶段（思考/工具调用）自动展开；主对话开始输出正文时自动折叠。
  // 必须合并为单个 effect 且依赖 [inflight, answerStarted]：
  // 中间轮旁白 content 会让 answerStarted 提前变 true，最终答案轮若同帧
  // 创建+输出，answerStarted 无跳变；此时靠 inflight 跳变触发本 effect
  // 重算 setOpen(!answerStarted)，折叠才不会丢失。
  //
  // 用户手动点击后设 userToggled=true，本 turn 内 effect 不再覆盖；
  // 新 turn 开始（inflight false→true）时重置 userToggled。
  useEffect(() => {
    if (inflight && !prevInflight.current) {
      userToggled.current = false;
    }
    prevInflight.current = inflight;

    if (!inflight) return;
    if (!userToggled.current) {
      setOpen(!answerStarted);
    }
  }, [inflight, answerStarted]);

  if (steps.length === 0) return null;

  const summary = traceSummaryLabel(steps, inflight);

  return (
    <div className="w-full text-sm">
      {/* 极简折叠头（对齐 DeepSeek Harness：8 次工具调用 · 5 次思考 · 7.4s） */}
      <div
        className="flex w-full items-center py-1.5 text-left text-muted select-none cursor-pointer"
        onClick={() => {
          userToggled.current = true;
          setOpen((v) => !v);
        }}
      >
        <div className="flex min-w-0 items-center gap-1.5 pr-2">
          {inflight ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          ) : null}
          <span className="truncate font-normal text-sm text-muted-foreground transition-colors">
            {summary}
          </span>
        </div>
      </div>

      {/* 展开的平铺步骤列表 */}
      {open ? (
        <div className="mt-2 space-y-1.5 border-b border-hairline/60 pb-3 mb-2.5 pt-1">
          {steps.map((s) => {
            if (s.kind === "think") {
              return <TraceThinkRow key={s.key} step={s} />;
            }
            if (s.kind === "note") {
              return <TraceNoteRow key={s.key} step={s} />;
            }
            return (
              <TraceToolRow
                key={s.key}
                tc={s.tc}
                onViewSearchResults={onViewSearchResults}
                aliasToChunkId={aliasToChunkId}
              />
            );
          })}
        </div>
      ) : (
        <div className="border-b border-hairline/40 pb-1 mb-2" />
      )}
    </div>
  );
}

function TraceThinkRow({
  step,
}: {
  step: Extract<TraceStep, { kind: "think" }>;
}) {
  // 默认收起：思考过程不再自动展开（流式期间也不展开），只有用户点击才展开；
  // 展开后不会被自动收回，完全由用户控制。
  const [open, setOpen] = useState(false);

  const summary = extractThinkSummary(step.thinking);
  // 收起态单行文案：流式中给滚动预览（随增量持续变化），结束后给稳定摘要
  const collapsedText = step.inflight
    ? extractThinkRollingPreview(step.thinking) || "正在深度思考…"
    : summary || "思考过程";

  return (
    <div className="w-full">
      <div
        className="group flex items-center gap-2 px-2 py-1 select-none cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        {/* 默认显示灯泡图标，hover 时替换为展开箭头（同位置覆盖） */}
        {step.inflight ? (
          <ThinkingBulbIcon className="h-4 w-4 shrink-0 text-primary animate-pulse" />
        ) : open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-faint transition-transform duration-150" />
        ) : (
          <>
            <ThinkingBulbIcon className="h-4 w-4 shrink-0 text-muted-faint group-hover:hidden" />
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-faint hidden group-hover:flex transition-transform duration-150" />
          </>
        )}
        <span
          className={cn(
            "shrink-0 text-[13.5px] font-medium leading-normal transition-colors",
            step.inflight
              ? "text-primary-deep font-semibold"
              : "text-foreground/80 group-hover:text-foreground",
          )}
        >
          思考
        </span>

        {/* 收起态显示单行文案（流式中为滚动预览），展开态只保留「思考」标题 */}
        {!open ? (
          <>
            <span className="text-muted-faint select-none">·</span>
            <span className="min-w-0 flex-1 truncate text-muted-subtle text-[13px] font-normal leading-normal transition-colors group-hover:text-muted">
              {collapsedText}
            </span>
          </>
        ) : null}
        {step.thinkingMs != null && !step.inflight && formatSeconds(step.thinkingMs) !== "0.0s" ? (
          <span className="shrink-0 text-xs text-muted-faint tabular-nums leading-normal">
            {formatSeconds(step.thinkingMs)}
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="pl-[32px] pr-2 pt-1 pb-1.5 text-[13.5px] text-muted leading-relaxed">
          <TruncatedMarkdown
            content={step.thinking}
            disableTruncation={step.inflight}
            className="text-[13.5px] leading-relaxed text-muted prose-p:leading-relaxed prose-li:leading-relaxed prose-p:my-1.5 prose-headings:text-xs prose-headings:leading-snug prose-pre:text-xs prose-pre:leading-relaxed"
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * 过程旁白行：中间轮的正文输出（自然语言段落，对齐 Harness 中的中间过程文本）
 */
function TraceNoteRow({
  step,
}: {
  step: Extract<TraceStep, { kind: "note" }>;
}) {
  return (
    <div className="py-2.5 px-2">
      <CitationPreviewMarkdown
        content={step.content}
        className="text-[14px] sm:text-[15px] leading-relaxed text-foreground/90 prose-p:leading-relaxed sm:prose-p:leading-7 prose-li:leading-relaxed prose-p:my-1.5 prose-headings:text-sm prose-headings:leading-snug prose-pre:text-xs prose-pre:leading-relaxed"
      />
    </div>
  );
}

/** session 级短引用号：c1 / c12。与后端 NavAliasMap.ALIAS_RE 对齐。 */
const CHUNK_ALIAS_RE = /^c\d+$/;

function isChunkAlias(id: string): boolean {
  return CHUNK_ALIAS_RE.test(id);
}

function addAliasMapping(
  map: Map<string, string>,
  alias?: string | null,
  chunkId?: string | null,
) {
  if (alias && chunkId && isChunkAlias(alias)) {
    map.set(alias, chunkId);
  }
}

/**
 * 从工具结果文本抽出预览用的 chunk 引用（可能是 alias，也可能是真实 id）。
 *
 * 覆盖两种结果头：
 *   --- chunk_id=c22, page=8 ---
 *   --- vlm_qa (n=6, chunk_ids=c12, c13, ...) ---
 */
function collectToolResultImageRefs(
  text: string,
): Array<{ rawId: string; caption: string }> {
  if (!text) return [];
  const results: Array<{ rawId: string; caption: string }> = [];
  const seen = new Set<string>();

  const headerRe = /---\s*chunk_id=([^\s,]+)(?:[^\n]*?)\s*---/gi;
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(text)) !== null) {
    const rawId = m[1];
    if (!rawId || seen.has(rawId)) continue;
    const rest = text.slice(m.index + m[0].length);
    const captionMatch = rest.match(/^\s*\n?caption:\s*(.+?)(?:\n|$)/);
    seen.add(rawId);
    results.push({
      rawId,
      caption: captionMatch ? captionMatch[1].trim() : "",
    });
  }

  if (results.length > 0) return results;

  const qaMatch = /---\s*vlm_qa\b[\s\S]*?chunk_ids=([^\n-]+)---/i.exec(text);
  if (!qaMatch) return results;
  for (const rawId of qaMatch[1]
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (seen.has(rawId)) continue;
    seen.add(rawId);
    results.push({ rawId, caption: "" });
  }
  return results;
}

/**
 * 把结果文本里的 chunk 引用转成 /raw-image URL。
 *
 * 工具结果对 LLM 只暴露 alias（c12），但 /raw-image 必须用真实 chunk_id。
 * 未解析的 alias 不能拿去请求，否则会 404 成裂图。
 */
function extractToolResultImages(
  text: string,
  aliasToChunkId: Map<string, string>,
): Array<{ url: string; caption: string; chunkId: string }> {
  const results: Array<{ url: string; caption: string; chunkId: string }> = [];
  for (const ref of collectToolResultImageRefs(text)) {
    const chunkId = isChunkAlias(ref.rawId)
      ? (aliasToChunkId.get(ref.rawId) ?? null)
      : ref.rawId;
    if (!chunkId) continue;
    results.push({
      url: buildChunkImageRawUrl(chunkId),
      caption: ref.caption,
      chunkId,
    });
  }
  return results;
}

function ToolResultImageThumb({
  url,
  caption,
  index,
}: {
  url: string;
  caption: string;
  index: number;
}) {
  const [failed, setFailed] = useState(false);
  const alt = caption || `图片 ${index + 1}`;
  if (failed) {
    return (
      <div className="flex items-center gap-1.5 py-3 text-[11px] text-muted-subtle">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {alt}加载失败
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        className="max-h-60 w-auto max-w-full rounded-md border border-gray-200 object-contain"
        loading="lazy"
        onError={() => setFailed(true)}
      />
      {caption ? (
        <span className="text-[10px] text-gray-500">{caption}</span>
      ) : null}
    </div>
  );
}

/** 渲染工具结果中的图片（走后端 /raw-image，不使用 MinIO 预签名 URL） */
function ToolResultImageGallery({
  text,
  aliasToChunkId,
}: {
  text: string;
  aliasToChunkId: Map<string, string>;
}) {
  const refs = useMemo(() => collectToolResultImageRefs(text), [text]);
  const images = useMemo(
    () => extractToolResultImages(text, aliasToChunkId),
    [text, aliasToChunkId],
  );
  if (refs.length === 0) return null;
  if (images.length === 0) {
    return (
      <div className="flex items-center gap-1.5 py-1 text-[11px] text-muted-subtle">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        图片预览暂不可用（引用号未解析）
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {images.map((img, i) => (
        <ToolResultImageThumb
          key={img.chunkId || i}
          url={img.url}
          caption={img.caption}
          index={i}
        />
      ))}
    </div>
  );
}

// ============================================================
// DSH 风格工具结果框：无滚动条、中间行截断、右上角复制按钮
// ============================================================

/**
 * 截断阈值：超过此行数则隐藏中间行。
 * 工具结果用 text-xs(12px) + leading-relaxed(~19.5px/行)，8 行 ≈ 156px，
 * 加头部+内边距+截断标记 ≈ 230px，约占视口 1/4，避免撑满整屏。
 */
const TOOL_RESULT_TRUNCATE_THRESHOLD = 8;

function ToolResultBox({
  label,
  content,
  emptyText,
}: {
  label: string;
  content: string;
  emptyText?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const lines = useMemo(
    () => (content ? content.split("\n") : []),
    [content],
  );
  const needsTruncation = !expanded && lines.length > TOOL_RESULT_TRUNCATE_THRESHOLD;
  const headCount = Math.ceil(TOOL_RESULT_TRUNCATE_THRESHOLD / 2);
  const tailCount = Math.floor(TOOL_RESULT_TRUNCATE_THRESHOLD / 2);
  const hiddenCount = needsTruncation
    ? lines.length - TOOL_RESULT_TRUNCATE_THRESHOLD
    : 0;

  const displayLines = needsTruncation
    ? [
        ...lines.slice(0, headCount),
        "__TRUNCATION_MARKER__" as const,
        ...lines.slice(-tailCount),
      ]
    : lines;

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  // 空结果
  if (!content && emptyText) {
    return (
      <div className="rounded-lg border border-hairline/60 bg-gray-50/80">
        <div className="flex items-center justify-between border-b border-hairline/40 px-3 py-1.5">
          <span className="text-xs font-medium text-muted">{label}</span>
        </div>
        <div className="px-3 py-2 text-xs leading-relaxed text-muted-subtle">
          {emptyText}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-hairline/60 bg-gray-50/80">
      {/* 头部：标签 + 复制按钮 */}
      <div className="flex items-center justify-between border-b border-hairline/40 px-3 py-1.5">
        <span className="text-xs font-medium text-muted">{label}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-muted-faint transition-colors hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-600" />
              <span className="text-emerald-600">已复制</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      {/* 内容：中间行截断，无滚动条 */}
      <div className="px-3 py-2 font-mono text-xs leading-relaxed text-foreground/80 whitespace-pre-wrap break-words">
        {displayLines.map((line, i) =>
          line === "__TRUNCATION_MARKER__" ? (
            <div
              key={`trunc-${i}`}
              onClick={() => setExpanded(true)}
              className="cursor-pointer select-none py-1 text-primary transition-colors hover:text-primary-deep"
            >
              ... 其余 {hiddenCount} 行
            </div>
          ) : (
            <div key={i}>{line || "\u00A0"}</div>
          ),
        )}
        {expanded && lines.length > TOOL_RESULT_TRUNCATE_THRESHOLD ? (
          <div
            onClick={() => setExpanded(false)}
            className="cursor-pointer select-none pt-1 text-primary transition-colors hover:text-primary-deep"
          >
            收起
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 思考内容中间行截断：按 \n 拆行，超过阈值时显示前 N 行 + 截断标记 + 后 N 行，
 * 点击截断标记全量展开，展开后底部显示「收起」。
 * 思考内容是 Markdown，因此按段落拆分后分别交给 CitationPreviewMarkdown 渲染。
 */
function TruncatedMarkdown({
  content,
  maxLines = 8,
  className,
  disableTruncation = false,
}: {
  content: string;
  maxLines?: number;
  className?: string;
  /** 为 true 时跳过截断，全量展示（用于 inflight 期间实时看完整思考流） */
  disableTruncation?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const lines = useMemo(() => content.split("\n"), [content]);
  const needsTruncation = !disableTruncation && lines.length > maxLines;

  if (!needsTruncation || expanded) {
    return (
      <>
        <CitationPreviewMarkdown content={content} className={className} />
        {needsTruncation ? (
          <div
            onClick={() => setExpanded(false)}
            className="cursor-pointer select-none pt-1 text-xs text-primary transition-colors hover:text-primary-deep"
          >
            收起
          </div>
        ) : null}
      </>
    );
  }

  const headCount = Math.ceil(maxLines / 2);
  const tailCount = Math.floor(maxLines / 2);
  const hiddenCount = lines.length - maxLines;
  const headContent = lines.slice(0, headCount).join("\n");
  const tailContent = lines.slice(-tailCount).join("\n");

  return (
    <>
      <CitationPreviewMarkdown content={headContent} className={className} />
      <div
        onClick={() => setExpanded(true)}
        className="cursor-pointer select-none py-1 text-xs text-primary transition-colors hover:text-primary-deep"
      >
        ... 其余 {hiddenCount} 行
      </div>
      <CitationPreviewMarkdown content={tailContent} className={className} />
    </>
  );
}

function TraceToolRow({
  tc,
  onViewSearchResults,
  aliasToChunkId,
}: {
  tc: ToolCallRecord;
  onViewSearchResults?: (
    citations: Citation[],
    params?: Record<string, unknown>,
    recallStats?: RecallStats,
  ) => void;
  aliasToChunkId: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const inflight = Boolean(tc.inflight);
  const isSearchTool = KB_SEARCH_TOOLS.has(tc.name);
  const isImageTool = IMAGE_TOOL_NAMES.has(tc.name);
  const executionModelLabel = formatExecutionModelLabel(tc.execution_model);
  const Icon = getToolIcon(tc.name);
  const friendlyName = getToolFriendlyName(tc.name);
  const toolSummary = extractToolSummary(tc);

  // 历史落库后 arguments.chunk_ids 可能已是真实 id；与结果头里的 alias 按序对齐补一张表
  const resolvedAliasMap = useMemo(() => {
    const map = new Map(aliasToChunkId);
    const argIds = tc.arguments?.chunk_ids;
    if (!Array.isArray(argIds) || !tc.result_brief) return map;
    const refs = collectToolResultImageRefs(tc.result_brief);
    if (refs.length === 0 || refs.length !== argIds.length) return map;
    refs.forEach((ref, i) => {
      const arg = String(argIds[i] ?? "");
      if (isChunkAlias(ref.rawId) && arg && !isChunkAlias(arg)) {
        map.set(ref.rawId, arg);
      }
    });
    return map;
  }, [aliasToChunkId, tc.arguments, tc.result_brief]);

  const hasArgs = tc.arguments && Object.keys(tc.arguments).length > 0;

  const argsPreview = useMemo(() => {
    if (hasArgs) {
      try {
        return JSON.stringify(tc.arguments, null, 2);
      } catch {
        return String(tc.arguments);
      }
    }
    if (tc.argsText) return tc.argsText;
    return "（暂无参数）";
  }, [tc.arguments, tc.argsText, hasArgs]);

  // 进行中的子阶段：检索与图片理解各有一套阶段文案
  const stageLabel = inflight
    ? ((tc.retrieval_progress
        ? RETRIEVAL_STAGE_LABEL[tc.retrieval_progress]
        : null) ??
      (tc.execution_stage
        ? IMAGE_TOOL_STAGE_LABEL[tc.execution_stage]
        : null) ??
      "调用中…")
    : null;

  const isEmpty = !inflight && (tc.items_added ?? 0) === 0;

  // 「查看」只在检索工具确有可展示内容时出现
  const canOpenSources =
    isSearchTool &&
    !inflight &&
    Boolean(onViewSearchResults) &&
    Boolean(
      (tc.retrieval_chunks && tc.retrieval_chunks.length > 0) ||
        (tc.retrieval_params &&
          (tc.retrieval_params as Record<string, unknown>).route_plan) ||
        tc.recall_stats,
    );

  return (
    <div className="w-full">
      <div
        className="group flex items-center gap-2 px-2 py-1.5 select-none cursor-pointer"
        onClick={() => !inflight && setOpen((v) => !v)}
      >
        {/* 默认显示工具图标，hover 时替换为展开箭头（同位置覆盖） */}
        {inflight ? (
          <Icon className="h-4 w-4 shrink-0 text-primary animate-pulse" />
        ) : open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-faint transition-transform duration-150" />
        ) : (
          <>
            <Icon className="h-4 w-4 shrink-0 text-muted-faint group-hover:hidden" />
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-faint hidden group-hover:flex transition-transform duration-150" />
          </>
        )}
        <span
          className={cn(
            "shrink-0 text-[13px] font-medium leading-normal transition-colors",
            inflight
              ? "text-primary-deep"
              : isEmpty
                ? "text-muted-subtle"
                : "text-foreground/85 group-hover:text-foreground",
          )}
        >
          {friendlyName}
        </span>
        <span className="text-muted-faint select-none">·</span>
        <span
          className="truncate text-muted-subtle text-xs font-mono leading-normal transition-colors group-hover:text-muted"
          title={toolSummary}
        >
          {inflight ? stageLabel : toolSummary}
        </span>
        {!inflight && tc.time_ms != null && formatSeconds(tc.time_ms) !== "0.0s" ? (
          <span className="shrink-0 text-xs text-muted-faint tabular-nums leading-normal">
            {formatSeconds(tc.time_ms)}
          </span>
        ) : null}

        {executionModelLabel ? (
          <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-muted-faint leading-tight">
            {executionModelLabel}
          </span>
        ) : null}

        {canOpenSources ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onViewSearchResults?.(
                retrievalChunksToCitations(tc.retrieval_chunks),
                tc.retrieval_params,
                tc.recall_stats,
              );
            }}
            className="shrink-0 px-1.5 py-0.5 text-xs font-medium text-primary hover:text-primary-deep hover:underline leading-normal rounded"
          >
            查看
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="my-1.5 ml-2 mr-1 space-y-2">
          <ToolResultBox
            label={isSearchTool ? "查询参数" : "输入参数"}
            content={argsPreview}
          />

          {isImageTool && tc.result_brief ? (
            <ToolResultImageGallery
              text={tc.result_brief}
              aliasToChunkId={resolvedAliasMap}
            />
          ) : null}

          <ToolResultBox
            label="执行结果"
            content={tc.result_brief ?? ""}
            emptyText="（工具未返回结果）"
          />
        </div>
      ) : null}
    </div>
  );
}

function docGroupKey(c: {
  file_id?: string | null;
  file_name?: string | null;
  document_id?: string | null;
  chunk_id: string;
}): string {
  return c.file_id ?? c.file_name ?? c.document_id ?? c.chunk_id;
}

const CHUNK_TYPE_ICON: Record<string, ComponentType<{ className?: string }>> = {
  table: TableIcon,
  image: ImageIcon,
  text: AlignJustify,
};

function truncateFileName(name: string, maxLen = 16): string {
  if (!name || name.length <= maxLen) return name;
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx > 0 && name.length - dotIdx <= 5) {
    const ext = name.slice(dotIdx);
    const baseLen = maxLen - ext.length - 3;
    if (baseLen > 2) {
      return name.slice(0, baseLen) + "..." + ext;
    }
  }
  return name.slice(0, maxLen - 3) + "...";
}

function getDocTypeIcon(
  fileName?: string | null,
  chunkType?: string | null,
): ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }> {
  if (chunkType === "table") return TableIcon;
  if (chunkType === "image") return ImageIcon;
  const ext = fileName?.split(".").pop()?.toLowerCase();
  if (ext === "xlsx" || ext === "xls" || ext === "csv") return TableIcon;
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp") return ImageIcon;
  return FileText;
}

/** 来源芯片：最多 2 篇截断微标，其余收进「+N 篇」，点击打开右侧面板 */
function ReferencedDocumentsBlock({
  citations,
  onOpenAllSources,
  className,
}: {
  citations: UiChatMessage["citations"];
  onOpenAllSources?: (citations: Citation[]) => void;
  className?: string;
}) {
  if (!citations || citations.length === 0) return null;

  // 按文档（file_id / file_name / document_id）去重
  const uniqueDocMap = new Map<
    string,
    { name: string; type?: string | null; page?: number | null }
  >();
  for (const c of citations) {
    const key = docGroupKey(c);
    if (!uniqueDocMap.has(key)) {
      uniqueDocMap.set(key, {
        name: c.file_name ?? c.document_id ?? c.chunk_id,
        type: c.chunk_type,
        page: c.page_index,
      });
    }
  }
  const uniqueDocs = Array.from(uniqueDocMap.values());
  const visibleDocs = uniqueDocs.slice(0, 2);
  const overflowCount = uniqueDocs.length - 2;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="text-[11px] text-muted-subtle flex-shrink-0 select-none">
        来源：
      </span>

      {visibleDocs.map((doc, i) => {
        const Icon = getDocTypeIcon(doc.name, doc.type);
        return (
          <button
            key={`${doc.name}-${i}`}
            type="button"
            onClick={() => onOpenAllSources?.(citations)}
            className="group inline-flex max-w-[170px] items-center gap-1 truncate rounded-md border border-hairline bg-gray-50/80 px-2 py-0.5 text-[11px] text-muted transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-primary-deep"
            title={`${doc.name}${typeof doc.page === "number" ? ` (P.${doc.page + 1})` : ""} · 点击查看全部来源`}
          >
            <Icon
              className="h-3 w-3 shrink-0 text-muted-subtle group-hover:text-primary-deep"
              aria-hidden="true"
            />
            <span className="truncate">{truncateFileName(doc.name, 15)}</span>
            {typeof doc.page === "number" ? (
              <span className="shrink-0 text-[10px] text-muted-faint group-hover:text-primary-deep">
                P.{doc.page + 1}
              </span>
            ) : null}
          </button>
        );
      })}

      {overflowCount > 0 ? (
        <button
          type="button"
          onClick={() => onOpenAllSources?.(citations)}
          className="group inline-flex items-center gap-0.5 rounded-md border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[11px] font-medium text-primary-deep transition-all hover:border-primary/40 hover:bg-primary/10 hover:shadow-xs"
          title={`共 ${uniqueDocs.length} 篇文档，${citations.length} 处引用 · 点击查看全部`}
        >
          <span>+{overflowCount} 篇</span>
          <ArrowUpRight
            className="h-3 w-3 opacity-70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            aria-hidden="true"
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onOpenAllSources?.(citations)}
          className="inline-flex items-center text-primary-deep hover:text-primary transition-colors p-0.5"
          title="查看引用的所有文档片段"
          aria-label="查看引用的所有文档片段"
        >
          <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** 将 retrieval chunks 转为 Citation 格式（字段几乎一致，补 score 默认值） */
function retrievalChunksToCitations(
  chunks: RetrievalChunkPreview[] | undefined,
): Citation[] {
  if (!chunks || chunks.length === 0) return [];
  return chunks.map((c) => ({
    chunk_id: c.chunk_id,
    document_id: c.document_id ?? null,
    knowledge_base_id: c.knowledge_base_id ?? null,
    score: c.score ?? 0,
    chunk_type: c.chunk_type ?? null,
    page_index: c.page_index ?? null,
    section_title: c.section_title ?? null,
    file_id: c.file_id ?? null,
    file_name: c.file_name ?? null,
    preview: c.preview ?? null,
    alias: c.alias ?? null,
    image_file_path: c.image_file_path ?? null,
    bucket_name: c.bucket_name ?? null,
  }));
}

function RetrievalChip({
  retrieval,
  onViewChunks,
}: {
  retrieval: UiChatMessage["retrieval"];
  onViewChunks?: (citations: Citation[]) => void;
}) {
  if (!retrieval) return null;
  const base =
    "mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]";
  if (retrieval.state === "started") {
    const stageLabel: Record<string, string> = {
      planning: "大模型规划检索路线…",
      searching: "多路召回中…",
      reranking: "精排结果中…",
    };
    const label = stageLabel[retrieval.stage ?? ""] ?? "正在检索知识库…";
    return (
      <span className={cn(base, "bg-primary/10 text-primary")}>
        <Loader2 className="h-3 w-3 animate-spin" />
        {label}
      </span>
    );
  }
  if (retrieval.state === "failed") {
    return (
      <span className={cn(base, "bg-red-50 text-red-600")}>
        <AlertTriangle className="h-3 w-3" />
        检索失败：{retrieval.error ?? "已按空命中继续"}
      </span>
    );
  }

  const hasChunks =
    retrieval.chunks && retrieval.chunks.length > 0 && onViewChunks;

  return (
    <button
      type="button"
      disabled={!hasChunks}
      onClick={() => {
        if (hasChunks) {
          onViewChunks(retrievalChunksToCitations(retrieval.chunks));
        }
      }}
      className={cn(
        base,
        "bg-emerald-50 text-emerald-700 transition-colors",
        hasChunks ? "cursor-pointer hover:bg-emerald-100" : "cursor-default",
      )}
      title={hasChunks ? "点击查看检索结果" : undefined}
    >
      <Database className="h-3 w-3" />
      命中 {retrieval.hit_count ?? 0} 段 ·{" "}
      {((retrieval.time_ms ?? 0) / 1000).toFixed(1)}s
      {hasChunks ? (
        <span className="ml-0.5 text-emerald-600">· 查看</span>
      ) : null}
    </button>
  );
}

/** 置顶问答：展示 qa_dense 高置信命中的 atomic_qa（不短路其它路） */
function DirectAnswerBlock({ direct }: { direct: Record<string, unknown> }) {
  const qaId = typeof direct.qa_id === "string" ? direct.qa_id : null;
  const score = typeof direct.score === "number" ? direct.score : null;
  const question =
    typeof direct.question === "string" ? direct.question.trim() : "";
  const answer = typeof direct.answer === "string" ? direct.answer.trim() : "";
  const sourceChunkIds = Array.isArray(direct.source_chunk_ids)
    ? (direct.source_chunk_ids as unknown[]).filter(
        (id): id is string => typeof id === "string",
      )
    : [];
  if (
    !qaId &&
    score === null &&
    sourceChunkIds.length === 0 &&
    !question &&
    !answer
  ) {
    return null;
  }
  return (
    <div className="bg-emerald-50/50 px-4 py-3 text-[12px]">
      <div className="mb-1.5 flex items-center gap-1.5 text-emerald-800">
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">置顶问答</span>
        <span className="text-[11px] text-emerald-700/80">
          qa_dense 高置信命中，对齐 / 融合 / rerank 仍已执行
        </span>
      </div>
      {question ? (
        <div className="text-muted">
          Q: <span className="text-foreground">{question}</span>
        </div>
      ) : null}
      {answer ? (
        <div className="mt-0.5 text-muted">
          A: <span className="text-foreground">{answer}</span>
        </div>
      ) : null}
      {qaId ? (
        <div className="mt-1 text-muted">
          atomic_qa: <span className="font-mono text-foreground">{qaId}</span>
        </div>
      ) : null}
      {score !== null ? (
        <div className="text-muted">
          置信度:{" "}
          <span className="font-mono text-foreground">{score.toFixed(4)}</span>
        </div>
      ) : null}
      {sourceChunkIds.length > 0 ? (
        <div className="mt-1 text-muted">
          依据 chunk:
          <div className="mt-1 flex flex-wrap gap-1">
            {sourceChunkIds.map((id) => (
              <span
                key={id}
                className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-gray-600 ring-1 ring-emerald-200"
                title={id}
              >
                {id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 从 citation alias（如 "c7"）提取序号，用于与 MarkdownAnswer 中的内联引用序号保持一致 */
function getAliasIndex(c: Citation): number {
  if (c.alias) {
    const m = /^c(\d+)$/i.exec(c.alias);
    if (m) return Number(m[1]);
  }
  return 0;
}

function ReferencesSidePanel({
  citations,
  showScore,
  params,
  recallStats,
  onClose,
}: {
  citations: Citation[];
  /** true=检索结果（按 score 降序，显示分数）；false=全部来源（按页码，不显示分数） */
  showScore: boolean;
  /** 查询参数 JSON（仅检索结果视图有，不含召回统计） */
  params?: Record<string, unknown>;
  /** 召回链路统计（独立于查询参数） */
  recallStats?: RecallStats;
  onClose: () => void;
}) {
  // 按 score 或页码排列，再按文档分组
  const docGroups = useMemo(() => {
    const sorted = [...citations].sort(
      showScore
        ? (a, b) => (b.score ?? 0) - (a.score ?? 0)
        : (a, b) => (a.page_index ?? Infinity) - (b.page_index ?? Infinity),
    );
    const order: string[] = [];
    const groups = new Map<
      string,
      {
        fileName: string;
        fileId: string | null | undefined;
        citations: Array<Citation & { globalIndex: number }>;
      }
    >();

    sorted.forEach((c, i) => {
      const key = docGroupKey(c);
      if (!groups.has(key)) {
        order.push(key);
        groups.set(key, {
          fileName: c.file_name || c.file_id || "未知文档",
          fileId: c.file_id,
          citations: [],
        });
      }
      // 搜索结果：按排序后的顺序编号（1,2,3…）；全部来源：使用 alias 编号与文本引用一致
      const globalIndex = showScore ? i + 1 : getAliasIndex(c);
      groups.get(key)!.citations.push({ ...c, globalIndex });
    });

    return order.map((key) => ({ key, ...groups.get(key)! }));
  }, [citations, showScore]);

  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-hairline/80 bg-white shadow-2xl sm:relative sm:z-auto sm:w-[min(340px,36vw)] sm:bg-gray-50/50 sm:shadow-xs"
      aria-label="全部来源"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-hairline/60 bg-white/80 px-4 py-2.5 backdrop-blur-xs">
        <span className="text-sm font-semibold text-foreground">
          {showScore
            ? docGroups.length > 0
              ? `检索结果 · ${docGroups.length} 篇文档`
              : "检索详情与参数"
            : `全部来源 · ${docGroups.length} 篇文档`}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground"
          aria-label="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div
        tabIndex={-1}
        onMouseEnter={(e) => e.currentTarget.focus({ preventScroll: true })}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none"
      >
        {showScore &&
        params &&
        (params as Record<string, unknown>).direct_answer ? (
          <DirectAnswerBlock
            direct={
              (params as Record<string, unknown>).direct_answer as Record<
                string,
                unknown
              >
            }
          />
        ) : null}
        {showScore && params && Object.keys(params).length > 0 ? (
          <QueryParamsSection params={params} />
        ) : null}
        {showScore && recallStats ? (
          <RecallPathSection stats={recallStats} />
        ) : null}
        {docGroups.map((doc) => (
          <DocGroup key={doc.key} doc={doc} showScore={showScore} />
        ))}
      </div>
    </aside>
  );
}

/** 将 preview 原文转为纯文本摘要（约 2 行，~80 字） */
function previewSnippet(preview: string | null | undefined): string {
  if (!preview) return "";
  const plain = stripHtmlToPlain(preview.trim());
  if (plain.length <= 80) return plain;
  return `${plain.slice(0, 80)}…`;
}

/**
 * 从 preview 文本中提取图片标题（支持中英文格式）
 */
function extractImageCaption(
  preview: string | null | undefined,
): string | null {
  if (!preview) return null;
  // 英文格式: image_caption: xxx
  const en = preview.match(/image_caption\s*:\s*(.+?)(?:\n|image_|$)/i);
  if (en) {
    const v = normalizeCitationAnnotation(en[1]);
    if (v) return v;
  }
  // 中文格式: 标题：xxx
  const cn = preview.match(/标题[：:]\s*(.+?)(?:\n|$)/);
  if (cn) {
    const v = normalizeCitationAnnotation(cn[1]);
    if (v) return v;
  }
  return null;
}

/**
 * 从 preview 文本中提取图片脚注（支持中英文格式）
 */
function extractImageFootnote(
  preview: string | null | undefined,
): string | null {
  if (!preview) return null;
  // 英文格式: image_footnote: xxx
  const en = preview.match(/image_footnote\s*:\s*(.+?)(?:\n|image_|$)/i);
  if (en) {
    const v = normalizeCitationAnnotation(en[1]);
    if (v) return v;
  }
  // 中文格式: 脚注：xxx
  const cn = preview.match(/脚注[：:]\s*(.+?)(?:\n|$)/);
  if (cn) {
    const v = normalizeCitationAnnotation(cn[1]);
    if (v) return v;
  }
  return null;
}

/**
 * 图片型引用的预览：显示标题文字 + 预览按钮
 * 点击预览按钮弹出图片预览弹窗（按需加载图片 URL）
 */
function ImageChunkPreview({
  chunkId,
  preview,
  fileName,
  pageIndex,
  sectionTitle,
}: {
  chunkId: string;
  preview?: string | null;
  fileName?: string | null;
  pageIndex?: number | null;
  sectionTitle?: string | null;
}) {
  const caption = extractImageCaption(preview);
  const footnote = extractImageFootnote(preview);

  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
      <ImageIcon className="h-3 w-3 shrink-0 text-blue-600" />
      <span className="line-clamp-1 flex-1">{caption || "（图片引用）"}</span>
      <ImagePreviewPopover
        chunkId={chunkId}
        caption={caption}
        footnote={footnote}
        fileName={fileName}
        pageIndex={pageIndex}
        sectionTitle={sectionTitle}
        triggerClassName="shrink-0"
      />
    </div>
  );
}

/** 单个文档分组（默认折叠） */
function DocGroup({
  doc,
  showScore,
}: {
  doc: {
    key: string;
    fileName: string;
    fileId: string | null | undefined;
    citations: Array<Citation & { globalIndex: number }>;
  };
  showScore: boolean;
}) {
  const [open, setOpen] = useState(true);

  const openFile = () => {
    if (!doc.fileId) return;
    window.open(
      `/knowledge/file/${encodeURIComponent(doc.fileId)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      {/* 文档标题行（可折叠） */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 bg-gray-50/70 px-3 py-2.5 text-left transition-colors hover:bg-gray-100/70"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
        )}
        <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-medium leading-snug text-foreground">
            {doc.fileName}
          </span>
          <span className="ml-1.5 text-[11px] text-muted">
            · {doc.citations.length} 段引用
          </span>
        </div>
        {doc.fileId ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              openFile();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                openFile();
              }
            }}
            className="shrink-0 rounded-md px-2 py-0.5 text-[11px] text-primary transition-colors hover:bg-primary/10"
          >
            打开文档
          </span>
        ) : null}
      </button>

      {/* 引用片段列表（折叠内容） */}
      {open ? (
        <div className="divide-y divide-gray-50">
          {doc.citations.map((c) => {
            const Icon =
              (c.chunk_type && CHUNK_TYPE_ICON[c.chunk_type]) || FileText;
            const pageText =
              typeof c.page_index === "number" ? `p.${c.page_index + 1}` : null;
            const isImage = c.chunk_type === "image";

            // 全部来源模式（非搜索结果）：点击跳转到文件中的位置
            const canNavigate = !showScore && c.file_id;

            const handleCitationClick = () => {
              if (!canNavigate || !c.file_id) return;
              const params = new URLSearchParams();
              params.set("chunkId", c.chunk_id);
              if (c.chunk_type) params.set("type", c.chunk_type);
              window.open(
                `/knowledge/file/${encodeURIComponent(c.file_id)}?${params.toString()}`,
                "_blank",
                "noopener,noreferrer",
              );
            };

            return (
              <div
                key={`${c.chunk_id}-${c.globalIndex}`}
                className="px-4 py-2.5"
              >
                {/* 头部：点击后在原文中定位（预览区不触发跳转） */}
                {canNavigate ? (
                  <button
                    type="button"
                    onClick={handleCitationClick}
                    className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[11px] text-muted transition-colors hover:bg-gray-50"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      {c.globalIndex}
                    </span>
                    <Icon className="h-3 w-3 shrink-0 text-blue-700" />
                    {c.section_title ? (
                      <span className="truncate font-medium text-foreground">
                        {c.section_title}
                      </span>
                    ) : null}
                    {pageText ? <span>{pageText}</span> : null}
                    <span className="ml-auto text-[10px] text-primary/60">
                      定位
                    </span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 text-[11px] text-muted">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      {c.globalIndex}
                    </span>
                    <Icon className="h-3 w-3 shrink-0 text-blue-700" />
                    {c.section_title ? (
                      <span className="truncate font-medium text-foreground">
                        {c.section_title}
                      </span>
                    ) : null}
                    {pageText ? <span>{pageText}</span> : null}
                    {showScore && typeof c.score === "number" ? (
                      <span className="ml-auto rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                        {(c.score * 100).toFixed(1)}%
                      </span>
                    ) : null}
                  </div>
                )}

                {/* 预览区：仅展示，不触发原文跳转 */}
                <div
                  className="mt-1"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  {isImage ? (
                    <ImageChunkPreview
                      chunkId={c.chunk_id}
                      preview={c.preview}
                      fileName={c.file_name}
                      pageIndex={c.page_index}
                      sectionTitle={c.section_title}
                    />
                  ) : (
                    (() => {
                      const snippet = previewSnippet(c.preview);
                      return snippet ? (
                        <div className="line-clamp-2 text-[11px] leading-relaxed text-muted">
                          {snippet}
                        </div>
                      ) : (
                        <div className="text-[11px] text-muted-subtle">
                          （无预览文本）
                        </div>
                      );
                    })()
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// ============================================================
// 操作按钮栏（复制、点赞、反对、分享）
// ============================================================

function AssistantActionBar({
  messages,
  className,
}: {
  messages: UiChatMessage[];
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState<"up" | "down" | null>(null);

  const handleCopy = useCallback(() => {
    const text = messages
      .map((m) => m.content)
      .filter(Boolean)
      .join("\n\n");
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [messages]);

  const handleShare = useCallback(() => {
    const text = messages
      .map((m) => m.content)
      .filter(Boolean)
      .join("\n\n");
    if (navigator.share) {
      void navigator.share({ text });
    } else {
      void navigator.clipboard.writeText(text);
    }
  }, [messages]);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          "flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] transition-colors",
          copied
            ? "bg-emerald-50 text-emerald-600"
            : "text-muted hover:bg-gray-100 hover:text-foreground",
        )}
        title="复制回答"
        aria-label="复制回答"
      >
        {copied ? (
          <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
        ) : (
          <Copy className="h-3 w-3" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        onClick={() => setLiked((v) => (v === "up" ? null : "up"))}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
          liked === "up"
            ? "bg-emerald-50 text-emerald-600"
            : "text-muted hover:bg-gray-100 hover:text-foreground",
        )}
        title="赞"
        aria-label="赞"
      >
        <ThumbsUp className="h-3 w-3" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setLiked((v) => (v === "down" ? null : "down"))}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-lg transition-colors",
          liked === "down"
            ? "bg-red-50 text-red-500"
            : "text-muted hover:bg-gray-100 hover:text-foreground",
        )}
        title="踩"
        aria-label="踩"
      >
        <ThumbsDown className="h-3 w-3" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={handleShare}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-gray-100 hover:text-foreground"
        title="分享"
        aria-label="分享"
      >
        <Share2 className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}

// ============================================================
// 轮次分组
// ============================================================

interface ChatTurn {
  id: string;
  userMessage?: UiChatMessage;
  assistantMessages: UiChatMessage[];
  accumulatedCitations: Citation[];
  summaryMessage?: UiChatMessage;
}

/** 把 messages 切分为按轮次聚合的 ChatTurn 结构 */
function groupMessagesIntoTurns(messages: UiChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  const accumulated = new Map<string, Citation>();

  let currentTurn: ChatTurn | null = null;

  const flushTurn = () => {
    if (currentTurn) {
      currentTurn.accumulatedCitations = Array.from(accumulated.values());
      turns.push(currentTurn);
      currentTurn = null;
    }
  };

  for (const m of messages) {
    if (m.role === "summary") {
      flushTurn();
      turns.push({
        id: `summary-${m.id}`,
        summaryMessage: m,
        assistantMessages: [],
        accumulatedCitations: Array.from(accumulated.values()),
      });
    } else if (m.role === "user") {
      flushTurn();
      currentTurn = {
        id: `turn-user-${m.id}`,
        userMessage: m,
        assistantMessages: [],
        accumulatedCitations: [],
      };
    } else if (m.role === "assistant") {
      for (const c of m.citations ?? []) {
        if (c.chunk_id) accumulated.set(c.chunk_id, c);
      }
      if (!currentTurn) {
        currentTurn = {
          id: `turn-asst-${m.id}`,
          assistantMessages: [m],
          accumulatedCitations: [],
        };
      } else {
        currentTurn.assistantMessages.push(m);
      }
    }
  }
  flushTurn();
  return turns;
}

/**
 * 从消息正文中提取 HTML 报告片段，返回 null 表示不是 HTML 报告。
 *
 * 兼容三种情况：
 *   1. 纯 HTML（以 `<!DOCTYPE html>` 或 `<html>` 开头）
 *   2. HTML 前带说明文字（如"现在所有证据已收齐，让我生成完整的 HTML 报告。"）
 *   3. HTML 被 ```html 代码块包裹
 *
 * 通过定位 `<!DOCTYPE html>` / `<html>` 起点并截到 `</html>` 终点，
 * 自动剥离前导说明、代码块围栏与尾部多余内容。
 */
function extractHtmlReport(content: string): string | null {
  if (!content) return null;

  const extractFromHtmlSource = (source: string): string | null => {
    const startMatch = /<!DOCTYPE html|<html[\s>]/i.exec(source);
    if (!startMatch) return null;
    let html = source.slice(startMatch.index);
    const endMatch = /<\/html\s*>/i.exec(html);
    if (!endMatch) return null;
    html = html.slice(0, endMatch.index + endMatch[0].length);
    return html.trim();
  };

  const fencedMatch = /```html\s*\n([\s\S]*?)```/i.exec(content);
  if (fencedMatch) {
    const fromFence = extractFromHtmlSource(fencedMatch[1]);
    if (fromFence) return fromFence;
  }

  return extractFromHtmlSource(content);
}

function hasHtmlReportStart(content: string): boolean {
  return /<!DOCTYPE html|<html[\s>]/i.test(content);
}

/**
 * 单个 assistant 轮次的答案区。
 *
 * 思考、工具调用与中间轮旁白都已收进组级的 TraceTimeline，这里只渲染真正的
 * 交付内容：最后一轮的正文，以及任意一轮里的 HTML 报告卡片。没有可渲染内容
 * 的中间轮返回 null，避免留下只带间距的空容器。
 */
function AssistantRoundBlock({
  message,
  isLast,
  allCitations,
  onViewReport,
  className,
}: {
  message: UiChatMessage;
  /** 是否是组内最后一条（最终总结） */
  isLast: boolean;
  /** 整组合并后的 citations（跨 round 去重），供 MarkdownAnswer 渲染引用 */
  allCitations: Citation[];
  onViewReport?: (html: string, citations: Citation[]) => void;
  className?: string;
}) {
  const m = message;
  // 模型可能在 HTML 报告前后附带说明文字（如"现在所有证据已收齐，让我生成…"），
  // 或用 ```html 代码块包裹，这里从正文任意位置抽取出纯 HTML 片段。
  const reportHtml = useMemo(() => extractHtmlReport(m.content), [m.content]);
  const isHtmlReport = Boolean(reportHtml);
  const isReportGenerating = Boolean(
    m.inflight && hasHtmlReportStart(m.content) && !isHtmlReport,
  );
  // 中间轮的纯文本正文是过程旁白，已由 TraceTimeline 接管
  const showAnswer = isLast && Boolean(m.content);

  if (!isHtmlReport && !isReportGenerating && !showAnswer && !m.cancelled) {
    return null;
  }

  return (
    <div className={className}>
      {isReportGenerating ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-primary-deep">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            正在生成调研报告…
          </div>
        </div>
      ) : isHtmlReport ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary-deep">
                调研报告已生成
              </span>
            </div>
            <button
              type="button"
              onClick={() =>
                onViewReport?.(reportHtml ?? m.content, allCitations)
              }
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-deep"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              查看报告
            </button>
          </div>
        </div>
      ) : showAnswer ? (
        <div className="text-[14px] sm:text-[15px] leading-relaxed sm:leading-7 text-foreground">
          <div className="markdown-body prose prose-sm max-w-none text-foreground text-[14px] sm:text-[15px] leading-relaxed sm:leading-7 prose-p:leading-relaxed sm:prose-p:leading-7 prose-li:leading-relaxed sm:prose-li:leading-7 prose-p:my-2 prose-li:my-0.5 prose-headings:font-semibold prose-headings:leading-snug prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:leading-relaxed prose-blockquote:leading-relaxed">
            <MarkdownAnswer
              content={m.content}
              citations={allCitations}
              inflight={m.inflight}
            />
          </div>
        </div>
      ) : null}

      {/* 已停止 */}
      {m.cancelled ? (
        <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-muted">
          <CircleStop className="h-3 w-3" />
          已停止生成
        </div>
      ) : null}
    </div>
  );
}

const STARTER_PROMPTS_CARDS: {
  title: string;
  desc: string;
  prompt: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
}[] = [
  {
    title: "总结核心全貌",
    desc: "提炼当前知识库的结构脉络与最值得先读的重点资料",
    prompt: "总结当前知识库里最值得先看的内容",
    icon: BookOpen,
  },
  {
    title: "探索提问切入点",
    desc: "分析知识库覆盖范围，梳理高价值的提问视角与建议",
    prompt: "梳理这个知识库适合怎么提问",
    icon: Sparkles,
  },
  {
    title: "提炼重点与风险",
    desc: "深度挖掘资料中的关键结论、潜在风险与注意事项",
    prompt: "从当前资料里提炼重点和潜在风险",
    icon: Search,
  },
];

/**
 * 空状态欢迎引导卡片（Hero Welcome Guide）
 * 沉浸式微渐变微标 + 3 组针对性建议提问微卡片，带 hover/active 微交互
 */
function ChatEmptyWelcomeGuide({
  knowledgeBaseName,
  selectedFolderName,
  onSelectPrompt,
}: {
  knowledgeBaseName?: string;
  selectedFolderName?: string | null;
  onSelectPrompt: (prompt: string) => void;
}) {
  const targetName = selectedFolderName || knowledgeBaseName || "当前知识库";

  return (
    <div className="mx-auto my-auto flex w-full max-w-2xl flex-col items-center py-6 text-center animate-fadeIn">
      {/* 沉浸式微渐变徽标 */}
      <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 border border-primary/20 text-primary-deep shadow-xs">
        <Sparkles className="h-7 w-7 text-primary" aria-hidden="true" />
      </div>

      <h2 className="text-base sm:text-lg font-semibold text-foreground tracking-tight">
        围绕「{targetName}」展开探索
      </h2>
      <p className="mt-1.5 max-w-md text-xs sm:text-[13px] leading-relaxed text-muted-subtle">
        基于已挂载的文档切片与深度向量检索，支持多轮深度推理、事实溯源与结构化总结。
      </p>

      {/* 3 张精美 Prompt 卡片 */}
      <div className="mt-6 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        {STARTER_PROMPTS_CARDS.map((item, idx) => {
          const Icon = item.icon;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectPrompt(item.prompt)}
              className="group relative flex flex-col justify-between rounded-xl border border-hairline/90 bg-white/90 p-3.5 text-left shadow-[0_1px_3px_rgba(0,0,0,0.03)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-white hover:shadow-md active:scale-[0.98]"
            >
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary-deep transition-colors group-hover:bg-primary/15">
                    <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  </div>
                  <ArrowUpRight
                    className="h-3.5 w-3.5 text-muted-faint opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100 group-hover:text-primary-deep"
                    aria-hidden="true"
                  />
                </div>
                <div className="text-xs font-semibold text-foreground transition-colors group-hover:text-primary-deep">
                  {item.title}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted-subtle line-clamp-2">
                  {item.desc}
                </p>
              </div>

              <div className="mt-3 flex items-center gap-1 text-[10.5px] font-medium text-primary-deep opacity-80 group-hover:opacity-100">
                <span>立即提问</span>
                <ChevronRight className="h-2.5 w-2.5" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 一轮问答：用户右对齐轻气泡 + 助手通栏正文（无外框卡片）。
 */
function ChatTurnBlock({
  turn,
  isLastTurn,
  isStreaming,
  turnAnchorRef,
  onOpenSourcesPanel,
  onViewSearchResults,
  onViewRetrievalChunks,
  onViewReport,
}: {
  turn: ChatTurn;
  isLastTurn: boolean;
  isStreaming: boolean;
  turnAnchorRef?: React.RefObject<HTMLDivElement | null>;
  onOpenSourcesPanel?: (citations: Citation[]) => void;
  onViewSearchResults?: (
    citations: Citation[],
    params?: Record<string, unknown>,
    recallStats?: RecallStats,
  ) => void;
  onViewRetrievalChunks?: (citations: Citation[]) => void;
  onViewReport?: (html: string, citations: Citation[]) => void;
}) {
  const { userMessage, assistantMessages, accumulatedCitations } = turn;

  const [userCopied, setUserCopied] = useState(false);

  const handleCopyUserPrompt = useCallback(() => {
    if (!userMessage?.content) return;
    void navigator.clipboard.writeText(userMessage.content).then(() => {
      setUserCopied(true);
      setTimeout(() => setUserCopied(false), 2000);
    });
  }, [userMessage?.content]);

  // 本 turn 自身的 citations（全量）
  const ownCitations = useMemo(() => {
    const map = new Map<string, Citation>();
    for (const m of assistantMessages) {
      for (const c of m.citations ?? []) {
        map.set(c.chunk_id, c);
      }
    }
    return Array.from(map.values());
  }, [assistantMessages]);

  // 本轮 LLM 实际引用的 citations（用于"引用来源"展示）
  const citedCitations = useMemo(() => {
    const cited = new Set<string>();
    const re = /\[c(\d+)\]/g;
    for (const m of assistantMessages) {
      if (!m.content) continue;
      let match;
      while ((match = re.exec(m.content)) !== null) {
        cited.add(`c${match[1]}`);
      }
    }
    if (cited.size === 0) return [];
    return ownCitations.filter((c) => c.alias && cited.has(c.alias));
  }, [assistantMessages, ownCitations]);

  // 跨 turn 合并 citations（用于 MarkdownAnswer 渲染 [cN] 引用）
  const allCitationsForRender = useMemo(() => {
    const map = new Map<string, Citation>();
    for (const c of accumulatedCitations) {
      if (c.chunk_id) map.set(c.chunk_id, c);
    }
    for (const c of ownCitations) {
      map.set(c.chunk_id, c);
    }
    return Array.from(map.values());
  }, [accumulatedCitations, ownCitations]);

  // read_image_chunks 结果头是 alias（c12），/raw-image 要真实 chunk_id
  const previewAliasToChunkId = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of allCitationsForRender) {
      addAliasMapping(map, c.alias, c.chunk_id);
    }
    if (userMessage?.retrieval?.chunks) {
      for (const c of userMessage.retrieval.chunks) {
        addAliasMapping(map, c.alias, c.chunk_id);
      }
    }
    for (const m of assistantMessages) {
      for (const tc of m.tool_calls ?? []) {
        for (const c of tc.retrieval_chunks ?? []) {
          addAliasMapping(map, c.alias, c.chunk_id);
        }
      }
      if (m.retrieval?.chunks) {
        for (const c of m.retrieval.chunks) {
          addAliasMapping(map, c.alias, c.chunk_id);
        }
      }
    }
    return map;
  }, [allCitationsForRender, assistantMessages, userMessage]);

  const isTurnInflight = assistantMessages.some((m) => m.inflight);
  const lastMsg = assistantMessages[assistantMessages.length - 1];
  const hasContent = assistantMessages.some((m) => m.content);
  // 主对话区是否已开始输出正文：最后一条 assistant 消息（最终回答轮）已有 content
  // 主对话区是否已开始输出正文：最后一条 assistant 消息已有 content 且没有 tool_calls
  // （有 tool_calls 说明是中间轮旁白，不是最终答案；旁白不应触发折叠）
  const answerStarted =
    Boolean(lastMsg?.content) && (lastMsg?.tool_calls?.length ?? 0) === 0;

  // 整组的思考、旁白与工具调用合并成一条轨道
  const traceSteps = useMemo(
    () => buildTraceSteps(assistantMessages),
    [assistantMessages],
  );

  // 当前轮是否处于"正在规划 / 等待"状态：
  const showTurnPlanning = useMemo(() => {
    if (!isStreaming || !isLastTurn) return false;
    if (traceSteps.length > 0) return false;
    return !hasContent;
  }, [isStreaming, isLastTurn, traceSteps.length, hasContent]);

  return (
    <div
      ref={isLastTurn && userMessage ? turnAnchorRef : undefined}
      className="space-y-4 animate-fadeIn"
    >
      {/* 用户提问：右对齐轻气泡，hover 显示复制与时间 */}
      {userMessage ? (
        <div className="group relative flex flex-col items-end gap-1 pt-1">
          <div className="relative max-w-[85%] rounded-[20px_20px_4px_20px] bg-primary/5 px-4 py-2.5 text-[14px] sm:text-[15px] leading-relaxed sm:leading-7 text-foreground sm:px-5 sm:py-3 transition-colors hover:bg-primary/10 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <div className="whitespace-pre-wrap break-words leading-relaxed sm:leading-7">{userMessage.content}</div>
            {userMessage.retrieval ? (
              <div className="mt-2">
                <RetrievalChip
                  retrieval={userMessage.retrieval}
                  onViewChunks={onViewRetrievalChunks}
                />
              </div>
            ) : null}
          </div>

          <div className="flex h-5 items-center gap-1.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={handleCopyUserPrompt}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-subtle hover:bg-gray-100 hover:text-foreground transition-colors"
              title="复制问题"
              aria-label="复制问题"
            >
              {userCopied ? (
                <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
              ) : (
                <Copy className="h-3 w-3" aria-hidden="true" />
              )}
            </button>
            {userMessage.created_at ? (
              <span className="text-[10px] text-muted-faint whitespace-nowrap select-none">
                {formatDate(userMessage.created_at)}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 助手回答：通栏、无外框 */}
      <div className="min-w-0 space-y-3 pt-1">
        {/* 头部助手身份标记 */}
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary-deep text-xs font-semibold select-none">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          </div>
          <span className="text-xs font-medium text-foreground select-none">
            知识库助手
          </span>
          {isTurnInflight ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-primary-deep font-medium">
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              正在生成…
            </span>
          ) : null}
        </div>

        {/* 推理轨道：整组思考 + 旁白 + 工具调用（DeepSeek Harness 扁平无边框风格） */}
        {traceSteps.length > 0 ? (
          <div className="w-full">
            <TraceTimeline
              steps={traceSteps}
              inflight={isTurnInflight}
              onViewSearchResults={onViewSearchResults}
              aliasToChunkId={previewAliasToChunkId}
              answerStarted={answerStarted}
            />
          </div>
        ) : null}

        {/* 规划中 / 等待中指示器 */}
        {showTurnPlanning ? (
          <div className="flex items-center gap-2 py-1.5 text-sm text-muted-subtle">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-shimmer font-medium">正在检索与推理…</span>
          </div>
        ) : null}

        {/* 答案输出与 HTML 报告 */}
        {assistantMessages.map((m, idx) => (
          <AssistantRoundBlock
            key={m.id}
            message={m}
            isLast={idx === assistantMessages.length - 1}
            allCitations={allCitationsForRender}
            onViewReport={onViewReport}
            className={idx > 0 ? "mt-3" : undefined}
          />
        ))}

        {/* 底部：来源芯片 + 操作栏 */}
        {!isTurnInflight && (hasContent || citedCitations.length > 0) ? (
          <div className="mt-4 pt-2.5 border-t border-hairline/60 flex flex-wrap items-center justify-between gap-2">
            {/* 左侧：微型芯片与 token 计数 */}
            <div className="flex items-center gap-2.5 min-w-0">
              {citedCitations.length > 0 ? (
                <ReferencedDocumentsBlock
                  citations={citedCitations}
                  onOpenAllSources={onOpenSourcesPanel}
                />
              ) : null}
              {lastMsg?.usage ? (
                <span className="text-[10.5px] text-muted-faint hidden sm:inline select-none">
                  tokens: {lastMsg.usage.total_tokens}
                </span>
              ) : null}
            </div>

            {/* 右侧：操作按钮组 */}
            <AssistantActionBar messages={assistantMessages} />
          </div>
        ) : null}
      </div>

      {/* 轮次间微弱分隔线（仅非最后一轮） */}
      {!isLastTurn ? (
        <div className="h-px bg-hairline/60 my-6" aria-hidden="true" />
      ) : null}
    </div>
  );
}

// ============================================================
// 会话列表（左侧栏 / 紧凑模式 popover）
// ============================================================

interface SessionListProps {
  sessions: ChatSessionInfo[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onRename: (session: ChatSessionInfo) => void;
  onDelete: (session: ChatSessionInfo) => void;
}

function SessionRow({
  session,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  session: ChatSessionInfo;
  active: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors",
        active ? "bg-primary/10" : "hover:bg-gray-100",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 flex-col text-left"
      >
        <span
          className={cn(
            "flex items-center gap-1 truncate text-[12.5px] leading-5",
            active ? "text-primary" : "text-foreground",
          )}
          title={
            session.folder_id
              ? `${session.title || "新会话"} · folder scope`
              : session.title || "新会话"
          }
        >
          {session.folder_id ? (
            <Folder
              className="h-3 w-3 shrink-0 text-emerald-500"
              aria-label="folder scope"
            />
          ) : null}
          <span className="truncate">{session.title || "新会话"}</span>
        </span>
        <span className="mt-0.5 truncate text-[10.5px] leading-4 text-muted">
          {session.message_count} 条
          {session.last_message_at
            ? ` · ${formatDate(session.last_message_at)}`
            : " · 新建"}
        </span>
      </button>

      {/* hover 时直接出现编辑 / 删除两个图标，不再走 popup 菜单 */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-gray-200 hover:text-foreground"
          title="重命名"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-red-50 hover:text-red-600"
          title="删除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onRename,
  onDelete,
}: SessionListProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded
    ? sessions
    : sessions.slice(0, SESSION_DEFAULT_VISIBLE);
  const hidden = sessions.length - visible.length;

  if (sessions.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted">
        暂无历史会话
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 px-2">
      {visible.map((s) => (
        <SessionRow
          key={s.session_id}
          session={s}
          active={s.session_id === activeSessionId}
          onSelect={() => onSelect(s.session_id)}
          onRename={() => onRename(s)}
          onDelete={() => onDelete(s)}
        />
      ))}
      {sessions.length > SESSION_DEFAULT_VISIBLE ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-primary hover:bg-primary/5"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" />
              收起
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" />
              展开全部（还有 {hidden}）
            </>
          )}
        </button>
      ) : null}
    </div>
  );
}

function SessionPopover(props: SessionListProps & { onNew: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 text-foreground transition-colors hover:border-primary",
          open && "border-primary bg-primary/5 text-primary",
        )}
        title="历史会话"
        aria-label="历史会话"
      >
        <Clock className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <span className="text-xs font-medium text-foreground">会话</span>
              <button
                type="button"
                onClick={() => {
                  props.onNew();
                  setOpen(false);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 text-foreground hover:border-primary"
                title="新建会话"
                aria-label="新建会话"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto py-2">
              <SessionList
                sessions={props.sessions}
                activeSessionId={props.activeSessionId}
                onSelect={(id) => {
                  props.onSelect(id);
                  setOpen(false);
                }}
                onRename={props.onRename}
                onDelete={props.onDelete}
              />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ============================================================
// 会话图标栏 + 可折叠历史面板（默认隐藏）
// ============================================================

function SessionIconRail({
  historyOpen,
  onToggleHistory,
  onNew,
}: {
  historyOpen: boolean;
  onToggleHistory: () => void;
  onNew: () => void;
}) {
  return (
    <div className="hidden w-11 shrink-0 flex-col items-center gap-2 bg-gray-50/60 py-3 lg:flex">
      <button
        type="button"
        onClick={onNew}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white hover:text-primary"
        title="新建会话"
        aria-label="新建会话"
      >
        <MessageSquarePlus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onToggleHistory}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
          historyOpen
            ? "bg-primary/10 text-primary"
            : "text-muted hover:bg-white hover:text-primary",
        )}
        title="历史会话"
        aria-label="历史会话"
      >
        <Clock className="h-4 w-4" />
      </button>
    </div>
  );
}

function SessionDrawer({
  scopeLabel,
  sessions,
  activeSessionId,
  onClose,
  onSelect,
  onRename,
  onDelete,
}: SessionListProps & {
  scopeLabel?: string;
  onClose: () => void;
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-gray-50/60 lg:flex">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs font-medium text-foreground">
          {scopeLabel ?? "历史会话"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-gray-100 hover:text-foreground"
          title="关闭"
          aria-label="关闭历史会话"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto pb-3">
        <SessionList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
        />
      </div>
    </aside>
  );
}

/**
 * 模型能力图标：思考 / 多模态（仅在模型选择列表中展示）
 */
function ModelCapabilityIcons({ model }: { model: ChatModelItem }) {
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

/** 按模型记忆用户上次使用的思考档位（模型列表里展示"上次用的是什么档"） */
const MODEL_LEVEL_STORAGE_PREFIX = "knowledge-chat-model-level-v1";

function getLastModelLevel(modelId: string): string | null {
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

function applyModelSelection(
  settings: ChatSettings,
  model: ChatModelItem,
): ChatSettings {
  // 按模型记忆优先：用过该模型则直接沿用上次的档位（含开关模型的 Off）
  const remembered = getLastModelLevel(model.id);
  if (
    model.supports_thinking === true &&
    remembered &&
    model.thinking_levels?.includes(remembered)
  ) {
    return {
      ...settings,
      model: model.id,
      thinkingLevel: remembered,
      enableMultimodal: model.supports_multimodal === true,
    };
  }

  // 无记忆时的默认推导（开关模型最终落到 medium，即默认 On）
  const lastLevel = getSettingsDefaultThinkingLevel();
  let nextThinkingLevel = "off";
  if (model.supports_thinking === true) {
    const candidate =
      (settings.thinkingLevel &&
      settings.thinkingLevel !== "off" &&
      model.thinking_levels?.includes(settings.thinkingLevel)
        ? settings.thinkingLevel
        : null) ??
      (lastLevel &&
      lastLevel !== "off" &&
      model.thinking_levels?.includes(lastLevel)
        ? lastLevel
        : null) ??
      (settings.thinkingLevel && settings.thinkingLevel !== "off"
        ? clampThinkingLevel(model.thinking_levels, settings.thinkingLevel)
        : null) ??
      (lastLevel && lastLevel !== "off"
        ? clampThinkingLevel(model.thinking_levels, lastLevel)
        : null) ??
      model.default_thinking_level ??
      (model.thinking_levels?.find((l) => l !== "off") || "off");
    nextThinkingLevel = candidate || "off";
  }

  return {
    ...settings,
    model: model.id,
    thinkingLevel: nextThinkingLevel,
    enableMultimodal: model.supports_multimodal === true,
  };
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

/**
 * 统一模型与思考强度选择器（Cursor 风格分步展开双卡片）
 * 交互逻辑：
 *   1. 触发按钮：点击时仅在正上方弹出当前模型信息主卡片（Effort 档位 + Model 项）。
 *   2. 点击主卡片中的 Model 项后，才展开第二张卡片（展示所有模型，顺序为后端分组排序）。
 *   3. 思考强度记忆：默认思考强度根据用户上次选择的强度来定义（并在 localStorage 中持久化）。
 *   4. 自适应方向：第二张卡片默认在右侧显示，若右侧屏幕空间不足则自动切换到左侧显示。
 */
function UnifiedModelPicker({
  modelId,
  thinkingLevel,
  models,
  onModelChange,
  onThinkingLevelChange,
  disabled,
}: {
  modelId: string;
  thinkingLevel: string;
  models: ChatModelItem[];
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

/**
 * Plan 模式选中后在输入栏展示的黄色 pill（与 Cursor 一致；Agent 默认不展示）
 */
function InteractionModeChip({
  mode,
  disabled,
  onRemove,
}: {
  mode: InteractionMode;
  disabled?: boolean;
  onRemove: () => void;
}) {
  if (mode !== "plan") return null;

  const plan = INTERACTION_MODE_OPTIONS.find((o) => o.key === "plan");
  if (!plan) return null;
  const Icon = plan.icon;

  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] leading-none whitespace-nowrap box-border",
        "border-amber-200 bg-amber-50 text-amber-700",
      )}
    >
      <Icon className="h-3 w-3 shrink-0 text-amber-600" strokeWidth={1.75} />
      <span>{plan.label}</span>
      {!disabled ? (
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-amber-600 transition-colors hover:bg-amber-200/70 hover:text-amber-800"
          aria-label="退出 Plan 模式"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}

/**
 * ➕ 号浮层配置菜单（Cursor 风格）
 *
 * 结构：顶部搜索框 + 上段模式选择（Agent / Plan）+ 分隔线
 *      + 下段带 > 子菜单（模型 / 技能 / 工具轮）。
 * - 搜索框过滤所有条目文字；
 * - 上段点击选中模式（非 toggle），已选中项显示勾选；
 * - 下段 hover 时在右侧展开子菜单，与 Cursor 一致。
 */
function PlusConfigMenu({
  settings,
  onChange,
  models,
  skills,
  selectedSkills,
  onToggleSkill,
  isStreaming,
  onClose,
}: {
  settings: ChatSettings;
  onChange: (next: ChatSettings) => void;
  models: ChatModelItem[];
  skills: SkillDescriptor[];
  selectedSkills: string[];
  onToggleSkill: (name: string) => void;
  isStreaming?: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hoveredSub, setHoveredSub] = useState<
    null | "models" | "skills" | "tools" | "thinking"
  >(null);

  const q = query.trim().toLowerCase();
  const match = (text: string) => !q || text.toLowerCase().includes(q);

  const modeDisabled = isStreaming === true;

  // 模式选择：Agent / Plan（点击选中，非 toggle）
  const modeItems = INTERACTION_MODE_OPTIONS.filter(
    (it) => match(it.label) || match(it.desc),
  );

  const currentModelLabel = useMemo(() => {
    if (!settings.model) return "选择模型";
    return models.find((m) => m.id === settings.model)?.label ?? settings.model;
  }, [settings.model, models]);

  const filteredMenuSkills = useMemo(() => {
    return skills.filter(
      (s) => match(s.name) || match(s.description) || match("技能"),
    );
  }, [skills, q]);

  const skillsValue =
    selectedSkills.length > 0
      ? `${selectedSkills.length} 已选`
      : `${skills.length} 可用`;

  // 当前选中模型的思考选项：强度模型显示档位，开关模型显示开/关
  const resolvedMenuModel =
    models.find((m) => m.id === settings.model) ?? models[0];
  const thinkingLevels = resolvedMenuModel?.thinking_levels?.length
    ? resolvedMenuModel.thinking_levels
    : ["off"];
  const thinkingAvailable =
    (resolvedMenuModel?.supports_thinking ?? false) &&
    thinkingLevels.length > 1;
  const switchOnlyThinking = isSwitchOnlyThinking(thinkingLevels);
  const onThinkingLevel = getOnThinkingLevel(thinkingLevels);
  const thinkingValue = !thinkingAvailable
    ? "不支持"
    : switchOnlyThinking
      ? settings.thinkingLevel === "off"
        ? "关"
        : "开"
      : (THINKING_LEVEL_LABELS[settings.thinkingLevel] ??
        settings.thinkingLevel);

  const subItems = [
    {
      key: "models" as const,
      icon: Cpu,
      label: "模型",
      value: currentModelLabel,
    },
    thinkingAvailable
      ? {
          key: "thinking" as const,
          icon: ThinkingBulbIcon,
          label: switchOnlyThinking ? "Thinking" : "思考强度",
          value: thinkingValue,
        }
      : null,
    {
      key: "skills" as const,
      icon: Sparkle,
      label: "技能",
      value: skillsValue,
    },
  ].filter((it): it is NonNullable<typeof it> => {
    if (it === null) return false;
    if (it.key === "skills") {
      return (
        match(it.label) || match(it.value) || filteredMenuSkills.length > 0
      );
    }
    return match(it.label) || match(it.value);
  });

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full left-0 z-50 mb-2 w-60 overflow-visible rounded-xl border border-gray-200 bg-white shadow-xl">
        {/* 顶部搜索框 */}
        <div className="flex items-center gap-1.5 border-b border-gray-100 px-2.5 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索配置项…"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted"
          />
        </div>

        <div className="relative">
          {/* 上段：模式选择（Agent / Plan） */}
          {modeItems.length > 0 ? (
            <div className="p-1.5">
              {modeItems.map((it) => {
                const Icon = it.icon;
                const selected = settings.interactionMode === it.key;
                return (
                  <button
                    key={it.key}
                    type="button"
                    disabled={modeDisabled}
                    onClick={() => {
                      if (modeDisabled) return;
                      if (!selected) {
                        onChange({ ...settings, interactionMode: it.key });
                      }
                      onClose();
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
                      modeDisabled
                        ? "cursor-not-allowed opacity-50"
                        : "hover:bg-gray-50",
                      selected && it.key === "plan" && "bg-amber-50",
                      selected && it.key === "agent" && "bg-gray-50",
                    )}
                    title={it.desc}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 shrink-0",
                        selected && it.key === "plan"
                          ? "text-amber-600"
                          : selected
                            ? "text-primary"
                            : "text-muted",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "truncate text-xs font-medium",
                          selected && it.key === "plan"
                            ? "text-amber-700"
                            : "text-foreground",
                        )}
                      >
                        {it.label}
                      </div>
                      <div className="truncate text-[10px] text-muted">
                        {it.desc}
                      </div>
                    </div>
                    {selected ? (
                      <Check
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          it.key === "plan" ? "text-amber-600" : "text-primary",
                        )}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* 分隔线 */}
          {modeItems.length > 0 && subItems.length > 0 ? (
            <div className="mx-3 h-px bg-gray-100" />
          ) : null}

          {/* 下段：hover 时在右侧展开子菜单（Cursor 风格） */}
          {subItems.length > 0 ? (
            <div className="p-1.5">
              {subItems.map((it) => {
                const Icon = it.icon;
                const isHovered = hoveredSub === it.key;
                return (
                  <div
                    key={it.key}
                    className="relative"
                    onMouseEnter={() => setHoveredSub(it.key)}
                    onMouseLeave={() => setHoveredSub(null)}
                  >
                    <div
                      className={cn(
                        "flex w-full cursor-default items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
                        isHovered && "bg-gray-50",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-foreground">
                          {it.label}
                        </div>
                      </div>
                      <span className="max-w-[88px] truncate text-[10px] text-muted">
                        {it.value}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
                    </div>

                    {isHovered && it.key === "models" ? (
                      <div className="absolute bottom-0 left-full z-10 -ml-1 pl-2">
                        <div className="w-48 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
                          <div className="max-h-56 overflow-y-auto p-1">
                            {models.length === 0 ? (
                              <div className="flex items-center gap-1 px-2.5 py-2 text-[11px] text-muted">
                                <Loader2 className="h-3 w-3 animate-spin" />{" "}
                                加载模型中…
                              </div>
                            ) : (
                              models.map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  onClick={() =>
                                    onChange(applyModelSelection(settings, m))
                                  }
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-gray-50",
                                    m.id === settings.model && "bg-primary/5",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "min-w-0 flex-1 truncate text-xs",
                                      m.id === settings.model
                                        ? "text-primary"
                                        : "text-foreground",
                                    )}
                                  >
                                    {m.label}
                                  </span>
                                  <ModelCapabilityIcons model={m} />
                                  {m.id === settings.model ? (
                                    <Check className="h-3 w-3 shrink-0 text-primary" />
                                  ) : null}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {isHovered && it.key === "thinking" ? (
                      <div className="absolute bottom-0 left-full z-10 -ml-1 pl-2">
                        <div className="w-44 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
                          <div className="max-h-56 overflow-y-auto p-1">
                            {(switchOnlyThinking
                              ? [
                                  {
                                    lvl: "off",
                                    label: "关",
                                    desc: "关闭思考链",
                                  },
                                  {
                                    lvl: onThinkingLevel,
                                    label: "开",
                                    desc: "开启思考链",
                                  },
                                ]
                              : thinkingLevels.map((lvl) => ({
                                  lvl,
                                  label: THINKING_LEVEL_LABELS[lvl] ?? lvl,
                                  desc: THINKING_LEVEL_DESCS[lvl],
                                }))
                            ).map((it) => {
                              const selected = switchOnlyThinking
                                ? it.label === "关"
                                  ? settings.thinkingLevel === "off"
                                  : settings.thinkingLevel !== "off"
                                : settings.thinkingLevel === it.lvl;
                              return (
                                <button
                                  key={it.lvl}
                                  type="button"
                                  onClick={() => {
                                    onChange({
                                      ...settings,
                                      thinkingLevel: it.lvl,
                                    });
                                  }}
                                  title={it.desc}
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-gray-50",
                                    selected && "bg-primary/5",
                                  )}
                                >
                                  <ThinkingBulbIcon
                                    className={cn(
                                      "h-3.5 w-3.5 shrink-0",
                                      it.lvl === "off"
                                        ? "text-gray-300"
                                        : "text-primary",
                                    )}
                                  />
                                  <span
                                    className={cn(
                                      "min-w-0 flex-1 truncate text-xs",
                                      selected
                                        ? "text-primary"
                                        : "text-foreground",
                                    )}
                                  >
                                    {it.label}
                                  </span>
                                  {selected ? (
                                    <Check className="h-3 w-3 shrink-0 text-primary" />
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {isHovered && it.key === "skills" ? (
                      <div className="absolute bottom-0 left-full z-10 -ml-1 pl-2">
                        <div className="w-48 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
                          <div className="max-h-56 overflow-y-auto p-1">
                            {filteredMenuSkills.length === 0 ? (
                              <div className="px-2.5 py-2 text-[11px] text-muted">
                                暂无可用技能
                              </div>
                            ) : (
                              filteredMenuSkills.map((skill) => {
                                const selected = selectedSkills.includes(
                                  skill.name,
                                );
                                return (
                                  <button
                                    key={skill.name}
                                    type="button"
                                    onClick={() => onToggleSkill(skill.name)}
                                    className={cn(
                                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-gray-50",
                                      selected && "bg-primary/5",
                                    )}
                                    title={skill.description}
                                  >
                                    <Sparkle className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                                    <span
                                      className={cn(
                                        "min-w-0 flex-1 truncate text-xs",
                                        selected
                                          ? "text-primary"
                                          : "text-foreground",
                                      )}
                                    >
                                      {skill.name}
                                    </span>
                                    {selected ? (
                                      <Check className="h-3 w-3 shrink-0 text-primary" />
                                    ) : null}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {modeItems.length === 0 && subItems.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-muted">
              无匹配配置项
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ============================================================
// 主面板
// ============================================================

export const KnowledgeChatPanel = ({
  knowledgeBaseId,
  knowledgeBaseName,
  selectedFolderId = null,
  selectedFolderName,
  disabled = false,
  disabledReason,
  noticeBanner,
  enabled = true,
  compact = false,
  className,
  onToggleMobileTree,
}: KnowledgeChatPanelProps) => {
  const chat = useKnowledgeChat({
    knowledgeBaseId,
    enabled: enabled && Boolean(knowledgeBaseId),
    folderId: selectedFolderId,
    folderName: selectedFolderName ?? null,
  });

  const {
    sessions,
    activeSession,
    activeSessionId,
    messages,
    phase,
    lastError,
    isStreaming,
    isLoading,
    selectSession,
    newSession,
    renameActive,
    deleteActive,
    clearMessages,
    summarizeContext,
    stopSummarize,
    summarizing,
    contextStatus,
    send,
    stop,
    clearError,
  } = chat;

  // input 是编辑器纯文本镜像（用于发送禁用判断 / slash 触发 / 布局），
  // 真正的富文本与 pill 由 MentionComposer 维护。
  const [input, setInput] = useState("");
  const [selectedSkillNames, setSelectedSkillNames] = useState<string[]>([]);
  // 当前编辑器里内联 @ 引用（Cursor 式，可多个，文件/目录混选）
  const [mentions, setMentions] = useState<AtMention[]>([]);
  // 由编辑器算出的 @ 触发词（null=未触发；""=浏览；非空=搜索）
  const [atQuery, setAtQuery] = useState<string | null>(null);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const composerRef = useRef<MentionComposerHandle>(null);
  const [availableSkills, setAvailableSkills] = useState<SkillDescriptor[]>([]);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [reportCitations, setReportCitations] = useState<Citation[]>([]);

  // 加载可用技能列表（首次挂载）
  useEffect(() => {
    fetchSkills({ enabledOnly: true })
      .then(setAvailableSkills)
      .catch(() => {});
  }, []);
  const [settings, setSettings] = useState<ChatSettings>({
    interactionMode: "agent",
    thinkingLevel: "off",
    enableMultimodal: false,
    model: "",
  });
  // ➕ 号浮层配置菜单开关（临时态，无需持久化）
  const [plusMenuOpen, setPlusMenuOpen] = useState<boolean>(false);

  // 模型清单（页面级单例，多个 chip 共享，不会重复请求）
  const { models } = useChatModels();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const rafScrollRef = useRef<number | null>(null);
  // Cursor 式滚动：新用户消息发出后置顶，底部保留一段"呼吸区"空白
  const turnAnchorRef = useRef<HTMLDivElement>(null);
  const bottomSpacerRef = useRef<HTMLDivElement>(null);
  const pendingPinRef = useRef(false);
  const [bottomSpacer, setBottomSpacer] = useState(0);
  // 单/多行布局：仅当内容真实折行（lineCount>1）或含换行符时切多行；
  // @ pill / 空格 / 短文本 均不应触发变高。
  const [inputMultiline, setInputMultiline] = useState(false);
  const inputMultilineRef = useRef(false);
  // 单行布局下缓存编辑器可用宽度，用于从多行退回时探测是否仍是一行
  const singleLineWidthRef = useRef(0);
  const lineProbeRef = useRef<HTMLDivElement>(null);

  const fitsSingleLineAtNarrowWidth = useCallback((html: string) => {
    const probe = lineProbeRef.current;
    const width = singleLineWidthRef.current;
    if (!probe || width <= 0 || !html) return false;
    probe.style.width = `${width}px`;
    probe.innerHTML = html;
    const style = window.getComputedStyle(probe);
    const lineHeight = parseFloat(style.lineHeight) || 20;
    return probe.scrollHeight <= lineHeight + 2;
  }, []);

  // 布局只信「几何测量」：lineCount 由编辑器实际渲染高度算出（空内容 / 纯空格 /
  // 浏览器 <br> 残渣均为 1 行），不再用序列化文本里的 \n，避免误判换行。
  const updateInputLayout = useCallback(
    (
      _text: string,
      lineCount: number,
      editorHtml: string,
      editorWidth: number,
    ) => {
      // 记录单行布局下的可用宽度（多行布局编辑器独占整行，宽度更大，不能用作探测基准）
      if (!inputMultilineRef.current && editorWidth > 0) {
        singleLineWidthRef.current = editorWidth;
      }

      let shouldMultiline = inputMultilineRef.current;
      if (lineCount > 1) {
        shouldMultiline = true;
      } else if (inputMultilineRef.current) {
        // 当前多行但几何已回到 1 行：多行布局宽度更大，需回到「单行窄宽度」探测，
        // 确认收窄后仍是一行才退回，避免宽窄切换来回抖动。
        if (!editorHtml || fitsSingleLineAtNarrowWidth(editorHtml)) {
          shouldMultiline = false;
        }
      }

      if (inputMultilineRef.current !== shouldMultiline) {
        inputMultilineRef.current = shouldMultiline;
        setInputMultiline(shouldMultiline);
      }
    },
    [fitsSingleLineAtNarrowWidth],
  );

  const showMultilineLayout = inputMultiline;

  // 单/多行布局切换后编辑器宽度变化，需重新测量行数（避免窄宽度下误折行）
  useEffect(() => {
    const id = requestAnimationFrame(() => composerRef.current?.remeasure());
    return () => cancelAnimationFrame(id);
  }, [showMultilineLayout]);

  const [sourcesSidePanel, setSourcesSidePanel] = useState<{
    citations: Citation[];
    showScore: boolean;
    params?: Record<string, unknown>;
    recallStats?: RecallStats;
  } | null>(null);
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);

  // 切换 session / 模型清单到位时，同步 chip 默认值。
  //
  // 新会话（尚无消息）：设置页默认模型 → 列表第一项。
  // 已有会话切走再回来：
  //   本知识库/目录上次选过的模型 → 该会话后端记下的 model → 列表第一项。
  // 同一会话内（含刷新）：chip 当前值 → 目录上次选择 → 会话 model → 列表第一项。
  const prevSessionIdRef = useRef<string | null>(null);

  // 切换会话时重置为 Agent（后端尚无 plan 持久化）
  useEffect(() => {
    if (!activeSession?.session_id) return;
    setSettings((prev) => ({ ...prev, interactionMode: "agent" }));
    inputMultilineRef.current = false;
    setInputMultiline(false);
  }, [activeSession?.session_id]);

  useEffect(() => {
    if (!activeSession) return;
    if (models.length === 0) {
      // 模型清单还没回包，先把其它字段同步好，model 留空待后续 settle，
      // 避免拿 fallback 的第一项当默认锁死，让 chip 先显示"选择模型"占位。
      const switchedNow = prevSessionIdRef.current !== activeSession.session_id;
      prevSessionIdRef.current = activeSession.session_id;
      setSettings((prev) => ({
        ...prev,
        thinkingLevel: activeSession.thinking_level ?? "off",
        enableMultimodal: false,
        model: switchedNow ? "" : prev.model,
      }));
      return;
    }

    const inList = (id: string) => models.some((m) => m.id === id);
    const sessionModel = activeSession.model || "";
    const settingsModel = pickSettingsDefaultModel(models);
    const firstAvailable = models[0].id;
    const isFreshSession =
      (activeSession.message_count ?? 0) === 0 && !activeSession.last_message_at;
    const switchedSession =
      prevSessionIdRef.current !== activeSession.session_id;
    prevSessionIdRef.current = activeSession.session_id;

    setSettings((prev) => {
      let nextModel: string;
      if (isFreshSession) {
        // 新开会话：设置页默认模型；同会话内已用手改过 chip 则保留。
        if (!switchedSession && prev.model && inList(prev.model)) {
          nextModel = prev.model;
        } else {
          nextModel = settingsModel || firstAvailable;
        }
      } else if (switchedSession) {
        // 切换 session：延续该会话上次使用的模型（利于上游缓存命中）；
        // 会话无显式模型（走 preset 的旧会话）或已下线时回落列表首个
        nextModel = inList(sessionModel) ? sessionModel : firstAvailable;
      } else {
        // 同一 session 内（含刷新恢复）：优先级 prev.model → sessionModel →
        // firstAvailable
        if (prev.model && inList(prev.model)) {
          nextModel = prev.model;
        } else if (inList(sessionModel)) {
          nextModel = sessionModel;
        } else {
          nextModel = firstAvailable;
        }
      }
      // 思考档位跟随模型：切换 session 时优先使用 activeSession.thinking_level；切换模型时根据模型支持情况决定
      const resolvedModel = models.find((m) => m.id === nextModel);
      const modelSupportsMultimodal =
        resolvedModel?.supports_multimodal === true;
      const sessionThinkingLevel = activeSession.thinking_level ?? "off";
      const lastLevel = getSettingsDefaultThinkingLevel();
      const targetThinkingLevel = switchedSession
        ? sessionThinkingLevel !== "off"
          ? sessionThinkingLevel
          : (lastLevel ?? "off")
        : prev.thinkingLevel !== "off"
          ? prev.thinkingLevel
          : (lastLevel ?? "off");
      const prevStillValid =
        resolvedModel?.thinking_levels?.includes(targetThinkingLevel) ?? false;
      const nextThinkingLevel = prevStillValid
        ? targetThinkingLevel
        : resolvedModel?.supports_thinking
          ? clampThinkingLevel(
              resolvedModel.thinking_levels,
              targetThinkingLevel,
            )
          : "off";
      return {
        ...prev,
        thinkingLevel: nextThinkingLevel,
        enableMultimodal: modelSupportsMultimodal,
        model: nextModel,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession?.session_id, knowledgeBaseId, selectedFolderId, models]);

  // 检测用户是否在底部（阈值 60px）
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 60;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  // 底部"呼吸区"高度：让当前轮（最后一条用户消息 + 助手回复）能被滚动到视口顶部，
  // 同时在滚到最底部时，最后一行文字大致落在视口中部（Cursor 视觉）。
  const recomputeSpacer = useCallback(() => {
    const container = scrollRef.current;
    const anchor = turnAnchorRef.current;
    const spacerEl = bottomSpacerRef.current;
    if (!container || !anchor || !spacerEl) {
      setBottomSpacer(0);
      return;
    }
    const cTop = container.getBoundingClientRect().top;
    const scroll = container.scrollTop;
    const anchorTop = anchor.getBoundingClientRect().top - cTop + scroll;
    const spacerTop = spacerEl.getBoundingClientRect().top - cTop + scroll;
    // 当前轮高度（不含 spacer 自身）
    const turnHeight = spacerTop - anchorTop;
    const desired = Math.max(0, container.clientHeight - turnHeight);
    setBottomSpacer((prev) => (Math.abs(prev - desired) > 1 ? desired : prev));
  }, []);

  // 把当前轮（最后一条用户消息）平滑滚动到视口顶部
  const scrollTurnToTop = useCallback((smooth: boolean) => {
    const container = scrollRef.current;
    const anchor = turnAnchorRef.current;
    if (!container || !anchor) return;
    const cTop = container.getBoundingClientRect().top;
    const anchorTop =
      anchor.getBoundingClientRect().top - cTop + container.scrollTop;
    const target = Math.max(0, anchorTop - 12);
    container.scrollTo({ top: target, behavior: smooth ? "smooth" : "auto" });
    isAtBottomRef.current = false;
  }, []);

  // 布局副作用：先算呼吸区高度，再决定滚动行为
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    recomputeSpacer();
    if (pendingPinRef.current) {
      pendingPinRef.current = false;
      // 等呼吸区高度应用后再滚，保证有足够空间置顶
      requestAnimationFrame(() => scrollTurnToTop(true));
      return;
    }
    // 未处于置顶状态时：仅当用户本就在底部且内容溢出，才平滑平稳跟随到底（通过 RAF 批处理）
    const overflows = container.scrollHeight > container.clientHeight + 4;
    if (isAtBottomRef.current && overflows) {
      if (rafScrollRef.current) cancelAnimationFrame(rafScrollRef.current);
      rafScrollRef.current = requestAnimationFrame(() => {
        if (isAtBottomRef.current && scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [messages, isStreaming, recomputeSpacer, scrollTurnToTop]);

  // 视口尺寸变化时重算呼吸区
  useEffect(() => {
    const onResize = () => recomputeSpacer();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [recomputeSpacer]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      // 模型/档位的 session 级恢复由下方 activeSession 同步 effect 统一处理
      // （session 记忆优先于 kb 级记忆），这里只重置交互模式
      setSettings((prev) => ({ ...prev, interactionMode: "agent" }));
      inputMultilineRef.current = false;
      setInputMultiline(false);
      await selectSession(sessionId);
    },
    [selectSession],
  );

  const effectiveDisabled = disabled || !knowledgeBaseId || !enabled;

  // 处理动作选择
  const handleAction = useCallback(
    async (name: string) => {
      if (name === "clear") {
        // 清空当前会话的消息（保留会话本身）
        setSelectedSkillNames([]);
        composerRef.current?.clear();
        setMentions([]);
        try {
          await clearMessages();
        } catch (error) {
          console.error("清空上下文失败:", error);
        }
      } else if (name === "summary") {
        // 总结对话上下文（后端生成摘要并标记旧消息）
        setSelectedSkillNames([]);
        composerRef.current?.clear();
        setMentions([]);
        try {
          await summarizeContext();
        } catch (error) {
          console.error("总结上下文失败:", error);
        }
      }
    },
    [clearMessages, summarizeContext],
  );

  const slashMenu = SlashSkillMenu({
    skills: availableSkills,
    query: slashQuery,
    onSelectMode: (mode) => {
      setSettings((prev) => ({ ...prev, interactionMode: mode }));
      composerRef.current?.removeSlashTrigger();
    },
    onSelect: (name, kind) => {
      if (kind === "action") {
        // 动作：直接执行，不入编辑器
        void handleAction(name);
        composerRef.current?.removeSlashTrigger();
      } else {
        // 技能：作为内联 pill 插入编辑器（同时清掉行首 `/` 触发词）
        composerRef.current?.insertSkill(name);
      }
    },
    disabled: effectiveDisabled || isStreaming,
  });

  const atMenu = AtFileMentionMenu({
    knowledgeBaseId,
    query: atQuery,
    onSelect: (mention) => {
      // 在编辑器光标处插入原子 pill（Cursor 式：留在文本之间，可多个）
      composerRef.current?.insertMention(mention);
    },
    disabled: effectiveDisabled || isStreaming,
  });

  // 切换知识库时清空编辑器（@ 引用仅在当前知识库内有效）
  useEffect(() => {
    composerRef.current?.clear();
    setMentions([]);
    setSelectedSkillNames([]);
    setAtQuery(null);
    setSlashQuery(null);
    inputMultilineRef.current = false;
    setInputMultiline(false);
  }, [knowledgeBaseId]);

  const handleSend = async (preset?: string) => {
    if (effectiveDisabled || isStreaming) return;
    // preset（starter prompt）无内联引用；否则取编辑器实时内容
    const content = (preset ?? composerRef.current?.getText() ?? input).trim();
    const turnMentions: AtMention[] = preset
      ? []
      : (composerRef.current?.getMentions() ?? mentions);
    const skillNames = (
      preset ? [] : (composerRef.current?.getSkills() ?? selectedSkillNames)
    ).filter((name) => !isAction(name));
    // 允许仅含 @ / skill pill、无额外文字时发送
    if (
      !preset &&
      !content &&
      turnMentions.length === 0 &&
      skillNames.length === 0
    ) {
      return;
    }
    // 清空输入
    composerRef.current?.clear();
    setInput("");
    setMentions([]);
    setAtQuery(null);
    setSlashQuery(null);
    // 新一轮：发出后把这条用户消息滚动到视口顶部，而不是贴底
    isAtBottomRef.current = false;
    pendingPinRef.current = true;
    // 思考档位：按模型支持列表归位（medium → DeepSeek 的 high），
    // 不要因为 includes 没命中就硬降成 off，否则 Model Lake 下开关/强度会失效。
    const resolvedModel =
      models.find((m) => m.id === settings.model) ?? models[0];
    const clampedThinkingLevel = clampThinkingLevel(
      resolvedModel?.thinking_levels,
      settings.thinkingLevel,
    );
    const effectiveThinkingLevel =
      clampedThinkingLevel === "off" && settings.thinkingLevel !== "off"
        ? settings.thinkingLevel
        : clampedThinkingLevel;
    const effectiveMultimodal = resolvedModel?.supports_multimodal === true;
    await send(content, {
      mode: modeFromInteraction(settings.interactionMode),
      thinkingLevel: effectiveThinkingLevel,
      enableMultimodal: effectiveMultimodal,
      // 用户选了具体 model 才透传；空字符串 → 沿用 session 当前偏好。
      // 注意：这里不再传 modelPreset——preset 是后端事项，前端只表达"我要这个具体模型"。
      ...(settings.model ? { model: settings.model } : {}),
      forcedSkillNames: skillNames.length > 0 ? skillNames : undefined,
      // @ 内联引用（软引用，可多个）：透传给后端解析为引用块 + seeding
      mentions:
        turnMentions.length > 0
          ? turnMentions.map((m) => ({ kind: m.kind, id: m.id }))
          : undefined,
    });
    setSelectedSkillNames([]);
  };

  const handleRename = async () => {
    if (!renameValue.trim()) {
      setRenaming(false);
      return;
    }
    try {
      await renameActive(renameValue.trim());
    } catch (err) {
      console.error(err);
    } finally {
      setRenaming(false);
      setRenameValue("");
    }
  };

  // 新建会话：模型用设置页默认项（不在清单则回落列表第一项）。
  // 思考强度仍沿用当前 chip（该模型不支持则 off）。
  //
  // v0.8.0：scope 选择策略（不接收参数版本）：
  //   - 若用户当前在 FolderTree 选中了某 folder（selectedFolderId 非空）→
  //     默认锁在该 folder（folder scope）；用户可点 banner 上的「新建文件夹会话」
  //     按钮显式触发同样动作；
  //   - 若没选 folder → 走 KB scope（原 v0.7.0 行为）。
  // 这样侧边栏的「新建」按钮与 banner 「新建文件夹会话」按钮共享同一行为，
  // 由"用户当前是否站在某 folder 上"自然区分，不再需要一个隐藏开关。
  const handleNewSession = useCallback(async () => {
    // 新会话固定默认 Agent 模式
    setSettings((prev) => ({ ...prev, interactionMode: "agent" }));
    const nextModelId = pickSettingsDefaultModel(models);
    const resolvedModel =
      models.find((m) => m.id === nextModelId) ?? models[0];
    const effectiveThinkingLevel = resolvedModel?.thinking_levels?.includes(
      settings.thinkingLevel,
    )
      ? settings.thinkingLevel
      : "off";
    const effectiveMultimodal = resolvedModel?.supports_multimodal === true;
    await newSession({
      mode: "agent",
      thinkingLevel: effectiveThinkingLevel,
      enableMultimodal: effectiveMultimodal,
      model: nextModelId || null,
      // 显式按"用户当前是否选中 folder"决定 scope；hook 内部也会兜底，
      // 但这里写明意图便于后续如果想引入"忽略 folder"的入口（例如紧凑模式
      // 顶栏「新建（KB）」按钮）只需调 newSession({ folderId: null }) 即可。
      folderId: selectedFolderId ?? null,
    });
  }, [newSession, settings.thinkingLevel, models, selectedFolderId]);

  const handleSessionRename = (s: ChatSessionInfo) => {
    if (s.session_id !== activeSessionId) {
      void handleSelectSession(s.session_id).then(() => {
        setRenaming(true);
        setRenameValue(s.title || "");
      });
    } else {
      setRenaming(true);
      setRenameValue(s.title || "");
    }
  };

  const handleSessionDelete = (s: ChatSessionInfo) => {
    const title = s.title || "新会话";
    setConfirmAction({
      kind: "danger",
      title: `删除会话「${title}」`,
      description: "会话及其全部消息记录会被永久删除，无法恢复。",
      confirmLabel: "删除会话",
      onConfirm: async () => {
        setConfirmBusy(true);
        try {
          if (s.session_id !== activeSessionId) {
            await handleSelectSession(s.session_id);
          }
          await deleteActive();
          setConfirmAction(null);
        } catch (err) {
          console.error(err);
        } finally {
          setConfirmBusy(false);
        }
      },
    });
  };

  const placeholder = effectiveDisabled
    ? "当前上下文不可问答"
    : "描述你想要查询的内容，/调用指令和技能，@知识库中的文件";

  const sessionScopeLabel = selectedFolderName
    ? `文件夹「${selectedFolderName}」`
    : knowledgeBaseName
      ? `知识库「${knowledgeBaseName}」`
      : "历史会话";

  // 转换消息列表为轮次结构（Turn-based）并累积跨轮 citations
  const chatTurns = useMemo(() => {
    return groupMessagesIntoTurns(messages);
  }, [messages]);

  // 最后一条用户轮次的索引，供 turnAnchorRef 置顶使用
  const lastUserTurnIndex = useMemo(() => {
    let idx = -1;
    chatTurns.forEach((t, i) => {
      if (t.userMessage) idx = i;
    });
    return idx;
  }, [chatTurns]);

  return (
    <section
      className={cn(
        "relative flex h-full min-h-0 overflow-hidden bg-white",
        className,
      )}
    >
      {/* 左侧图标栏 + 可折叠历史面板（默认隐藏） */}
      {!compact ? (
        <>
          <SessionIconRail
            historyOpen={sessionPanelOpen}
            onToggleHistory={() => setSessionPanelOpen((v) => !v)}
            onNew={() => void handleNewSession()}
          />
          {sessionPanelOpen ? (
            <SessionDrawer
              scopeLabel={sessionScopeLabel}
              sessions={sessions}
              activeSessionId={activeSessionId}
              onClose={() => setSessionPanelOpen(false)}
              onSelect={(id) => {
                void handleSelectSession(id);
                setSessionPanelOpen(false);
              }}
              onRename={handleSessionRename}
              onDelete={handleSessionDelete}
            />
          ) : null}
        </>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* 顶部全宽状态栏。
            relative 是 ContextIndicator 移动端浮层（占满头部宽度）的定位上下文，
            移除前请先确认 ContextIndicator 的 static sm:relative 定位链。 */}
        <div className="relative shrink-0 border-b border-hairline/70 bg-white/95 px-4 py-2.5 backdrop-blur-xs sm:px-6">
          <div className="flex items-center justify-between gap-3">
            {/* 左侧：标题 + 状态胶囊 + 范围面包屑 */}
            <div className="flex items-center gap-2 min-w-0">
              {onToggleMobileTree ? (
                <button
                  type="button"
                  onClick={onToggleMobileTree}
                  className="flex xl:hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline bg-gray-50/80 text-muted transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary-deep cursor-pointer"
                  title="打开知识库目录与文件管理"
                  aria-label="打开知识库目录"
                >
                  <Folder className="h-4 w-4 text-primary" />
                </button>
              ) : null}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {renaming ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={handleRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleRename();
                        if (e.key === "Escape") {
                          setRenaming(false);
                          setRenameValue("");
                        }
                      }}
                      className="min-w-0 rounded-md border border-primary/40 bg-white px-2 py-0.5 text-sm font-medium outline-none focus:ring-1 focus:ring-primary"
                    />
                  ) : (
                    <span
                      className="truncate text-sm font-semibold text-foreground hover:text-primary-deep transition-colors cursor-pointer select-none"
                      title={activeSession?.title ? `${activeSession.title}（双击可重命名）` : (knowledgeBaseName || "知识库问答")}
                      onDoubleClick={() => {
                        if (activeSession) {
                          setRenameValue(activeSession.title || "");
                          setRenaming(true);
                        }
                      }}
                    >
                      {activeSession?.title || knowledgeBaseName || "知识库问答"}
                    </span>
                  )}
                  <PhasePill phase={phase} />
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-muted-subtle truncate">
                  <span className="truncate">
                    {selectedFolderName
                      ? `${knowledgeBaseName ? `${knowledgeBaseName} / ` : ""}${selectedFolderName}`
                      : knowledgeBaseName
                        ? knowledgeBaseName
                        : "选择一个知识库以开始问答"}
                  </span>
                  {activeSession ? (
                    <span className="text-muted-faint shrink-0">
                      · {activeSession.message_count} 条消息
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {/* 右侧：上下文指示器 + 会话控制 */}
            <div className="flex items-center gap-2 shrink-0">
              <ContextIndicator report={contextStatus} />
              {compact ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void handleNewSession()}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-hairline bg-white text-muted transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary cursor-pointer"
                    title="新建会话"
                    aria-label="新建会话"
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                  </button>
                  <SessionPopover
                    sessions={sessions}
                    activeSessionId={activeSessionId}
                    onSelect={(id) => void handleSelectSession(id)}
                    onNew={() => void handleNewSession()}
                    onRename={handleSessionRename}
                    onDelete={handleSessionDelete}
                  />
                </div>
              ) : (
                <div className="flex items-center gap-1 lg:hidden">
                  <button
                    type="button"
                    onClick={() => void handleNewSession()}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-hairline bg-white text-muted transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary cursor-pointer"
                    title="新建会话"
                    aria-label="新建会话"
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                  </button>
                  <SessionPopover
                    sessions={sessions}
                    activeSessionId={activeSessionId}
                    onSelect={(id) => void handleSelectSession(id)}
                    onNew={() => void handleNewSession()}
                    onRename={handleSessionRename}
                    onDelete={handleSessionDelete}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 中间核心工作区：左侧消息主体列 + 右侧引用源面板 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
          {/* 聊天主体列（通知 + 消息流 + 输入区） */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {/* 错误提示 banner */}
            {phase === "disconnected" ? (
              <div className={cn(CHAT_CONTENT_CLASS, "mt-3 px-4 sm:px-5")}>
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                  <span className="flex-1">
                    连接已断开。直接发送下一条消息即可自动重连。
                  </span>
                </div>
              </div>
            ) : null}

            {lastError ? (
              <div className={cn(CHAT_CONTENT_CLASS, "mt-3 px-4 sm:px-5")}>
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                  <span className="flex-1">{lastError}</span>
                  <button
                    type="button"
                    onClick={clearError}
                    className="text-red-500 hover:text-red-700"
                  >
                    关闭
                  </button>
                </div>
              </div>
            ) : null}

            {/* 消息列表 + 输入区：消息在剩余视口内垂直居中，输入固定底部 */}
            <div className="relative flex min-h-0 flex-1 flex-col">
              {/* 顶部渐变羽化遮罩 */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute top-0 left-0 right-0 h-6 z-10 bg-gradient-to-b from-white via-white/80 to-transparent"
              />

              <div
                ref={scrollRef}
                tabIndex={-1}
                onScroll={handleScroll}
                onMouseEnter={(e) =>
                  e.currentTarget.focus({ preventScroll: true })
                }
                style={{ scrollbarGutter: "stable both-edges" }}
                className="flex-1 min-h-0 overflow-y-auto overscroll-contain outline-none"
              >
                <div
                  className={cn(
                    "flex min-h-full flex-col",
                    messages.length === 0 && "justify-center",
                  )}
                >
                  <div
                    className={cn(
                      CHAT_CONTENT_CLASS,
                      "space-y-4 px-4 pt-4 pb-2 sm:px-5",
                    )}
                  >
                    {isLoading && messages.length === 0 ? (
                      <div className="flex items-center justify-center py-10 text-xs text-muted">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        加载历史消息…
                      </div>
                    ) : null}

                    {messages.length === 0 && !isLoading && !effectiveDisabled ? (
                      <ChatEmptyWelcomeGuide
                        knowledgeBaseName={knowledgeBaseName}
                        selectedFolderName={selectedFolderName}
                        onSelectPrompt={(p) => void handleSend(p)}
                      />
                    ) : null}

                    {chatTurns.map((turn, ti) => {
                      if (turn.summaryMessage) {
                        return (
                          <div
                            key={turn.id}
                            className="my-5 flex items-center justify-center gap-3"
                          >
                            <div className="h-px flex-1 bg-hairline" />
                            <span className="rounded-full border border-hairline bg-gray-50/80 px-3 py-0.5 text-xs text-muted-subtle shadow-xs">
                              对话上下文已总结压缩
                            </span>
                            <div className="h-px flex-1 bg-hairline" />
                          </div>
                        );
                      }

                      const isLastUserTurn = ti === lastUserTurnIndex;

                      return (
                        <ChatTurnBlock
                          key={turn.id}
                          turn={turn}
                          isLastTurn={isLastUserTurn}
                          isStreaming={isStreaming}
                          turnAnchorRef={turnAnchorRef}
                          onOpenSourcesPanel={(c) =>
                            setSourcesSidePanel({
                              citations: c,
                              showScore: false,
                            })
                          }
                          onViewSearchResults={(c, params, recallStats) =>
                            setSourcesSidePanel({
                              citations: c,
                              showScore: true,
                              params,
                              recallStats,
                            })
                          }
                          onViewRetrievalChunks={(c) =>
                            setSourcesSidePanel({
                              citations: c,
                              showScore: true,
                              params: turn.userMessage?.retrieval?.params,
                            })
                          }
                          onViewReport={(html, citations) => {
                            setReportHtml(html);
                            setReportCitations(citations);
                          }}
                        />
                      );
                    })}

                    {summarizing ? (
                      <div className="flex">
                        <span className="text-shimmer text-[13px] font-medium">
                          正在总结对话上下文…
                        </span>
                      </div>
                    ) : null}

                    <div
                      ref={bottomSpacerRef}
                      aria-hidden
                      style={{ height: bottomSpacer }}
                    />
                  </div>
                </div>
              </div>

              {/* 底部渐变羽化遮罩（输入框上方） */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 left-0 right-0 h-5 z-10 bg-gradient-to-t from-white via-white/80 to-transparent"
              />

              {/* 智能置底悬浮胶囊 */}
              {!isAtBottom && messages.length > 0 && (
                <div className="absolute bottom-3 right-6 z-20 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <button
                    type="button"
                    onClick={() => scrollToBottom(true)}
                    className="group inline-flex items-center gap-1.5 rounded-full border border-hairline bg-white/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-md backdrop-blur-sm transition-all hover:border-primary/40 hover:bg-white hover:text-primary-deep"
                    title="滚动到底部"
                    aria-label="滚动到底部"
                  >
                    {isStreaming ? (
                      <>
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                        </span>
                        <span className="text-primary-deep font-medium">生成中</span>
                        <ChevronDown
                          className="h-3.5 w-3.5 text-primary-deep transition-transform group-hover:translate-y-0.5"
                          aria-hidden="true"
                        />
                      </>
                    ) : (
                      <>
                        <ChevronDown
                          className="h-3.5 w-3.5 text-muted-subtle transition-transform group-hover:translate-y-0.5 group-hover:text-primary"
                          aria-hidden="true"
                        />
                        <span>回到底部</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* 输入区：参数扁平化 toolbar + textarea + 发送/停止 */}
            <div className="shrink-0">
              <div className={cn(COMPOSER_CONTENT_CLASS, "px-4 pb-4 pt-2 sm:px-5")}>
                {disabledReason ? (
                  <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
                    {disabledReason}
                  </div>
                ) : noticeBanner ? (
                  <div className="mb-3 flex items-center gap-2 rounded-xl bg-blue-50/70 px-3 py-2 text-xs leading-5 text-blue-700">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-blue-500" />
                    <span>{noticeBanner}</span>
                  </div>
                ) : null}

                <div className="transition-colors">
                  <div
                    className={cn(
                      "relative border border-hairline bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all hover:border-gray-300/80 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 focus-within:shadow-[0_4px_12px_rgba(0,0,0,0.06)]",
                      showMultilineLayout ? "rounded-2xl" : "rounded-full py-2",
                    )}
                  >
                    {slashMenu.renderMenu()}
                    {atMenu.renderMenu()}
                    {/* 隐藏探测：克隆编辑器 HTML，在单行窄宽度下预测是否仍是一行 */}
                    <div
                      ref={lineProbeRef}
                      aria-hidden
                      className="pointer-events-none absolute -z-50 invisible block whitespace-pre-wrap break-words text-sm leading-5"
                      style={{ width: 0, left: -9999, top: -9999 }}
                    />
                    <div
                      className={cn(
                        showMultilineLayout
                          ? "flex flex-col gap-1.5 px-3 py-2"
                          : "flex items-center gap-1.5 px-3",
                      )}
                    >
                      {!showMultilineLayout ? (
                        <div className="relative flex shrink-0 items-center gap-1.5">
                          <div className="relative shrink-0">
                            <button
                              type="button"
                              onClick={() => setPlusMenuOpen((v) => !v)}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-muted transition-colors hover:border-primary hover:text-primary"
                              title="配置（模式 / 模型 / 技能 / 工具轮）"
                              aria-label="配置"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                            {plusMenuOpen ? (
                              <PlusConfigMenu
                                settings={settings}
                                onChange={setSettings}
                                models={models}
                                skills={availableSkills}
                                selectedSkills={selectedSkillNames.filter(
                                  (name) => !isAction(name),
                                )}
                                onToggleSkill={(name) => {
                                  if (selectedSkillNames.includes(name)) {
                                    composerRef.current?.removeSkill(name);
                                  } else {
                                    composerRef.current?.insertSkill(name);
                                  }
                                }}
                                isStreaming={isStreaming}
                                onClose={() => setPlusMenuOpen(false)}
                              />
                            ) : null}
                          </div>
                          <InteractionModeChip
                            mode={settings.interactionMode}
                            disabled={isStreaming}
                            onRemove={() =>
                              setSettings((prev) => ({
                                ...prev,
                                interactionMode: "agent",
                              }))
                            }
                          />
                        </div>
                      ) : null}
                      <MentionComposer
                        ref={composerRef}
                        disabled={
                          effectiveDisabled || isStreaming || summarizing
                        }
                        placeholder={
                          summarizing ? "正在总结上下文…" : placeholder
                        }
                        compact={!showMultilineLayout}
                        className={cn(
                          showMultilineLayout ? "w-full" : "min-w-0 flex-1",
                        )}
                        onChange={({
                          text,
                          mentions: ms,
                          skills,
                          atQuery: q,
                          slashQuery: sq,
                          lineCount,
                          editorHtml,
                          editorWidth,
                        }) => {
                          setInput(text);
                          setMentions(ms);
                          setSelectedSkillNames(skills);
                          setAtQuery(q);
                          setSlashQuery(sq);
                          updateInputLayout(
                            text,
                            lineCount,
                            editorHtml,
                            editorWidth,
                          );
                        }}
                        onMenuKeyDown={(e) => {
                          if (atMenu.handleKeyDown(e)) return;
                          if (slashMenu.handleKeyDown(e)) return;
                        }}
                        onSubmit={() => void handleSend()}
                      />
                      {showMultilineLayout ? (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                            <div className="relative shrink-0">
                              <button
                                type="button"
                                onClick={() => setPlusMenuOpen((v) => !v)}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-muted transition-colors hover:border-primary hover:text-primary"
                                title="配置（模式 / 模型 / 技能 / 工具轮）"
                                aria-label="配置"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                              {plusMenuOpen ? (
                                <PlusConfigMenu
                                  settings={settings}
                                  onChange={setSettings}
                                  models={models}
                                  skills={availableSkills}
                                  selectedSkills={selectedSkillNames.filter(
                                    (name) => !isAction(name),
                                  )}
                                  onToggleSkill={(name) => {
                                    if (selectedSkillNames.includes(name)) {
                                      composerRef.current?.removeSkill(name);
                                    } else {
                                      composerRef.current?.insertSkill(name);
                                    }
                                  }}
                                  isStreaming={isStreaming}
                                  onClose={() => setPlusMenuOpen(false)}
                                />
                              ) : null}
                            </div>
                            <InteractionModeChip
                              mode={settings.interactionMode}
                              disabled={isStreaming}
                              onRemove={() =>
                                setSettings((prev) => ({
                                  ...prev,
                                  interactionMode: "agent",
                                }))
                              }
                            />
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <UnifiedModelPicker
                              modelId={settings.model}
                              thinkingLevel={settings.thinkingLevel}
                              models={models}
                              disabled={
                                effectiveDisabled || isStreaming || summarizing
                              }
                              onModelChange={(model) => {
                                const resolved = models.find(
                                  (m) => m.id === model,
                                );
                                if (resolved) {
                                  setSettings(
                                    applyModelSelection(settings, resolved),
                                  );
                                } else {
                                  setSettings({ ...settings, model });
                                }
                              }}
                              onThinkingLevelChange={(lvl) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  thinkingLevel: lvl,
                                }))
                              }
                            />
                            {isStreaming ? (
                              <button
                                type="button"
                                onClick={stop}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow-xs transition-all hover:bg-red-600 active:scale-95 animate-pulse"
                                title="停止生成"
                              >
                                <CircleStop className="h-3.5 w-3.5" />
                              </button>
                            ) : summarizing ? (
                              <button
                                type="button"
                                onClick={stopSummarize}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow-xs transition-all hover:bg-red-600 active:scale-95 animate-pulse"
                                title="中断总结"
                              >
                                <CircleStop className="h-3.5 w-3.5" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleSend()}
                                disabled={effectiveDisabled || !input.trim()}
                                className={cn(
                                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all",
                                  effectiveDisabled || !input.trim()
                                    ? "cursor-not-allowed bg-gray-100 text-muted-subtle"
                                    : "bg-primary text-white shadow-xs hover:bg-primary-deep active:scale-95",
                                )}
                                title="发送（Enter）"
                              >
                                <ArrowUp
                                  className="h-3.5 w-3.5"
                                  strokeWidth={2.5}
                                />
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="shrink-0 flex items-center gap-1.5">
                            <UnifiedModelPicker
                              modelId={settings.model}
                              thinkingLevel={settings.thinkingLevel}
                              models={models}
                              disabled={
                                effectiveDisabled || isStreaming || summarizing
                              }
                              onModelChange={(model) => {
                                const resolved = models.find(
                                  (m) => m.id === model,
                                );
                                if (resolved) {
                                  setSettings(
                                    applyModelSelection(settings, resolved),
                                  );
                                } else {
                                  setSettings({ ...settings, model });
                                }
                              }}
                              onThinkingLevelChange={(lvl) =>
                                setSettings((prev) => ({
                                  ...prev,
                                  thinkingLevel: lvl,
                                }))
                              }
                            />
                          </div>
                          {isStreaming ? (
                            <button
                              type="button"
                              onClick={stop}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow-xs transition-all hover:bg-red-600 active:scale-95 animate-pulse"
                              title="停止生成"
                            >
                              <CircleStop className="h-3.5 w-3.5" />
                            </button>
                          ) : summarizing ? (
                            <button
                              type="button"
                              onClick={stopSummarize}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow-xs transition-all hover:bg-red-400"
                              title="中断总结"
                            >
                              <CircleStop className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleSend()}
                              disabled={effectiveDisabled || !input.trim()}
                              className={cn(
                                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all",
                                effectiveDisabled || !input.trim()
                                  ? "cursor-not-allowed bg-gray-100 text-muted-subtle"
                                  : "bg-primary text-white shadow-xs hover:bg-primary-deep active:scale-95",
                              )}
                              title="发送（Enter）"
                            >
                              <ArrowUp
                                className="h-3.5 w-3.5"
                                strokeWidth={2.5}
                              />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 右侧引用源 / 检索详情侧边栏 */}
          {sourcesSidePanel &&
          (sourcesSidePanel.citations.length > 0 ||
            sourcesSidePanel.params ||
            sourcesSidePanel.recallStats) ? (
            <ReferencesSidePanel
              citations={sourcesSidePanel.citations}
              showScore={sourcesSidePanel.showScore}
              params={sourcesSidePanel.params}
              recallStats={sourcesSidePanel.recallStats}
              onClose={() => setSourcesSidePanel(null)}
            />
          ) : null}
        </div>
      </div>

      {/* 调研报告模态框 */}
      {reportHtml && (
        <ReportViewer
          htmlContent={reportHtml}
          citations={reportCitations}
          onClose={() => {
            setReportHtml(null);
            setReportCitations([]);
          }}
        />
      )}

      <ConfirmModal
        action={confirmAction}
        busy={confirmBusy}
        onCancel={() => setConfirmAction(null)}
      />
    </section>
  );
};
