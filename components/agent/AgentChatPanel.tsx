"use client";

/**
 * 通用 Agent 对话面板（首页）
 *
 * 呈现逻辑与视觉对齐 KnowledgeChatPanel 的对话区：
 * - 布局：图标栏(lg+) + 可折叠历史面板（默认隐藏）+ 顶栏（标题双击重命名 +
 *   状态胶囊 + 消息计数）
 * - 轮次：用户右对齐浅色气泡（hover 复制）+ 助手通栏（身份头 → 推理轨道 →
 *   正文 → 底部操作栏），轮次间细分隔线
 * - 推理轨道（AgentTraceTimeline）：思考与工具调用按发生顺序交错成一条 DSH
 *   折叠流（多轮 loop 的每段思考跟在触发它的工具之后），
 *   推理阶段自动展开、正文开始自动折叠，用户手动操作后本 turn 内尊重用户
 * - 模型选择：UnifiedModelPicker（与知识库共用同一组件与档位记忆）
 * - 移动端：≤lg 走移动抽屉；composer 下沿保留「会话」入口
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  History,
  ImageIcon,
  List,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  RotateCw,
  Share2,
  SquareTerminal,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";

import {
  getLastModelLevel,
  ThinkingBulbIcon,
  UnifiedModelPicker,
} from "@/components/chat/UnifiedModelPicker";
import {
  SessionDrawer,
  SessionIconRail,
  SessionMobileDrawer,
} from "@/components/agent/AgentSessionSidebar";
import { AgentMarkdown } from "@/components/agent/AgentMarkdown";
import { PdfPages } from "@/components/agent/PdfPages";
import { CitationPreviewMarkdown } from "@/components/knowledge/CitationPreviewMarkdown";
import {
  deleteAgentAttachment,
  fetchAgentAssetUrls,
  fetchAgentFile,
  fetchAgentFileBlobUrl,
  fetchAgentFileMarkdown,
  fetchAgentFileText,
  listAgentSessionFiles,
  uploadAgentAttachment,
  useAgentModels,
  type AgentWorkspaceFile,
} from "@/lib/api/agent-chat";
import { useAgentChat } from "@/lib/hooks/useAgentChat";
import type {
  AgentAttachmentMeta,
  AgentToolCall,
  UiAgentMessage,
} from "@/lib/agent-chat-types";
import { BrandAvatar } from "@/components/ui/BrandAvatar";
import { ContextRing } from "@/components/ui/ContextRing";
import { cn } from "@/lib/utils";

/** 对话主内容最大宽度，居中排版（与 KnowledgeChatPanel 一致的阅读列宽） */
const CHAT_CONTENT_CLASS = "mx-auto w-full max-w-[880px]";
/** 输入区比对话区左右各宽 24px（居中对称），作为独立悬浮控件适度加宽 */
const COMPOSER_CONTENT_CLASS = "mx-auto w-full max-w-[928px]";

// ---------------------------------------------------------------------------
// 状态胶囊（对齐知识库 PhasePill）
// ---------------------------------------------------------------------------

function AgentPhasePill({
  busy,
  connection,
}: {
  busy: boolean;
  connection: "connecting" | "open" | "closed";
}) {
  const { label, tone } = busy
    ? { label: "回答中…", tone: "running" as const }
    : connection === "connecting"
      ? { label: "连接中…", tone: "running" as const }
      : connection === "open"
        ? { label: "就绪", tone: "ok" as const }
        : { label: "已断开，重连中…", tone: "error" as const };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px]",
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

// ---------------------------------------------------------------------------
// 思考流（对齐知识库 TraceThinkRow）
// ---------------------------------------------------------------------------

function cleanThinkText(thinking: string): string {
  return thinking
    .replace(/^[#\s*`>-]+/gm, "")
    .replace(/\n+/g, " ")
    .trim();
}

function extractThinkSummary(thinking: string): string {
  const clean = cleanThinkText(thinking);
  if (clean.length <= 90) return clean;
  return clean.slice(0, 90) + "…";
}

function extractThinkRollingPreview(thinking: string, maxLen = 110): string {
  const clean = cleanThinkText(thinking);
  if (clean.length <= maxLen) return clean;
  return "…" + clean.slice(-maxLen);
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function TraceThinkRow({
  text,
  inflight,
  thinkingMs,
}: {
  text: string;
  inflight: boolean;
  thinkingMs?: number;
}) {
  const [open, setOpen] = useState(false);
  if (!text && !inflight) return null;

  const collapsedText = inflight
    ? extractThinkRollingPreview(text) || "正在深度思考…"
    : extractThinkSummary(text) || "思考过程";

  return (
    <div className="w-full select-none">
      <div
        className="group flex w-full items-center gap-2 py-1 pr-2 cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        {inflight ? (
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
            inflight
              ? "text-primary-deep font-semibold"
              : "text-foreground/80 group-hover:text-foreground",
          )}
        >
          思考
        </span>
        {!open ? (
          <>
            <span className="text-muted-faint select-none">·</span>
            <span className="min-w-0 flex-1 truncate text-muted-subtle text-[13px] font-normal leading-normal transition-colors group-hover:text-muted">
              {collapsedText}
            </span>
          </>
        ) : null}
        {!inflight && thinkingMs != null && formatSeconds(thinkingMs) !== "0.0s" ? (
          <span className="shrink-0 text-xs text-muted-faint tabular-nums leading-normal">
            {formatSeconds(thinkingMs)}
          </span>
        ) : null}
      </div>

      {open ? (
        <div className="pb-1 pl-6 pr-2 pt-1">
          <div className="max-h-72 overflow-y-auto">
            <CitationPreviewMarkdown
              content={text}
              className="text-[13.5px] leading-relaxed text-muted prose-p:leading-relaxed prose-li:leading-relaxed prose-p:my-1.5 prose-headings:text-xs prose-headings:leading-snug prose-pre:text-xs prose-pre:leading-relaxed"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 工具轨迹（对齐知识库 TraceToolRow / ToolResultBox）
// ---------------------------------------------------------------------------

function getToolFriendlyName(name: string): string {
  switch (name) {
    case "web_search":
      return "联网搜索";
    case "kb_retrieval":
      return "知识库检索";
    case "code_execute":
      return "运行代码";
    case "list_workspace_files":
      return "附件清单";
    case "read_workspace_file":
      return "读取附件";
    case "understand_image":
      return "理解图片";
    default:
      return name;
  }
}

function getToolIcon(name: string) {
  switch (name) {
    case "web_search":
      return Globe;
    case "kb_retrieval":
      return BookOpen;
    case "code_execute":
      // 带框的命令行图标（终端窗口样式），与"运行代码"语义对应
      return SquareTerminal;
    case "list_workspace_files":
      return Paperclip;
    case "read_workspace_file":
      return FileText;
    case "understand_image":
      return ImageIcon;
    default:
      return SquareTerminal;
  }
}

function extractToolSummary(tc: AgentToolCall): string {
  if (tc.argsText) {
    try {
      const parsed = JSON.parse(tc.argsText) as Record<string, unknown>;
      // 工作空间工具：按语义给中文摘要，避免露出 file_id 十六进制串
      if (tc.name === "list_workspace_files") return "列出附件与产物";
      if (tc.name === "read_workspace_file") {
        const section = typeof parsed.section === "string" ? parsed.section.trim() : "";
        return section ? `读取「${section.slice(0, 40)}」小节` : "读取全文";
      }
      if (tc.name === "understand_image") {
        const q = typeof parsed.question === "string" ? parsed.question.trim() : "";
        return (q && q.length > 40 ? `${q.slice(0, 40)}…` : q) || "整体描述图片";
      }
      for (const key of ["query", "q", "code", "knowledge_base", "language"]) {
        const val = parsed[key];
        if (typeof val === "string" && val.trim()) {
          const oneLine = val.replace(/\n+/g, " ").trim();
          return oneLine.length > 70 ? `${oneLine.slice(0, 70)}…` : oneLine;
        }
      }
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === "string" && val.trim()) {
          return `${key}: ${val.slice(0, 60)}`;
        }
      }
    } catch {
      // 落到 argsText 截断
    }
    return tc.argsText.length > 80 ? `${tc.argsText.slice(0, 80)}…` : tc.argsText;
  }
  return tc.name || "执行工具";
}

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

  const lines = content ? content.split("\n") : [];

  const handleCopy = () => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!content && emptyText) {
    return (
      <div className="rounded-lg border border-hairline/60 bg-gray-50/80">
        <div className="border-b border-hairline/40 px-3 py-1.5 text-xs font-medium text-muted">
          {label}
        </div>
        <div className="px-3 py-2 text-xs leading-relaxed text-muted-subtle">
          {emptyText}
        </div>
      </div>
    );
  }

  const needsTruncation =
    !expanded && lines.length > TOOL_RESULT_TRUNCATE_THRESHOLD;
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

  return (
    <div className="rounded-lg border border-hairline/60 bg-gray-50/80">
      <div className="flex items-center justify-between border-b border-hairline/40 px-3 py-1.5">
        <span className="text-xs font-medium text-muted">{label}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-muted-faint transition-colors hover:text-foreground cursor-pointer"
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

function TraceToolRow({ tc }: { tc: AgentToolCall }) {
  const [open, setOpen] = useState(false);
  const running = tc.status === "running";
  const Icon = getToolIcon(tc.name);
  const friendlyName = getToolFriendlyName(tc.name);
  const toolSummary = extractToolSummary(tc);

  let argsPreview = "";
  // code_execute 的参数主体就是代码:整包 JSON 展示时字符串值内换行会被转义成
  // \n 字面量(JSON 规范不允许串内裸换行),特判直接渲染 code 原文(真实换行);
  // stdin 非空时单独一框。其余工具维持美化 JSON 展示。
  let codeArgs: { code: string; stdin?: string } | null = null;
  if (tc.argsText) {
    try {
      const parsed = JSON.parse(tc.argsText) as unknown;
      const rec =
        parsed && typeof parsed === "object"
          ? (parsed as Record<string, unknown>)
          : null;
      if (tc.name === "code_execute" && typeof rec?.code === "string" && rec.code.trim()) {
        codeArgs = {
          code: rec.code,
          stdin: typeof rec.stdin === "string" && rec.stdin.trim() ? rec.stdin : undefined,
        };
      } else {
        argsPreview = JSON.stringify(parsed, null, 2);
      }
    } catch {
      argsPreview = tc.argsText;
    }
  }

  return (
    <div className="w-full">
      <div
        className="group flex w-full items-center gap-2 py-1.5 pr-2 select-none cursor-pointer"
        onClick={() => !running && setOpen((v) => !v)}
      >
        {running ? (
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
            running
              ? "text-primary-deep"
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
          {running ? "调用中…" : toolSummary}
        </span>
        {!running && tc.timeMs != null && formatSeconds(tc.timeMs) !== "0.0s" ? (
          <span className="shrink-0 text-xs text-muted-faint tabular-nums leading-normal">
            {formatSeconds(tc.timeMs)}
          </span>
        ) : null}
      </div>

      {open && (argsPreview || codeArgs || tc.resultBrief) ? (
        <div className="my-1.5 ml-2 mr-1 space-y-2">
          {codeArgs ? (
            <>
              <ToolResultBox label="运行代码" content={codeArgs.code} />
              {codeArgs.stdin ? (
                <ToolResultBox label="标准输入 stdin" content={codeArgs.stdin} />
              ) : null}
            </>
          ) : argsPreview ? (
            <ToolResultBox label="输入参数" content={argsPreview} />
          ) : null}
          <ToolResultBox
            label="执行结果"
            content={tc.resultBrief ?? ""}
            emptyText="（工具未返回结果）"
          />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 推理轨道：整轮思考 + 工具调用合并成一条 DSH 折叠流（对齐知识库 TraceTimeline）
// ---------------------------------------------------------------------------

function traceSummaryLabel(
  thinkingMs: number,
  toolMs: number,
  thinkCount: number,
  toolCount: number,
  inflight: boolean,
  runningTool: AgentToolCall | undefined,
): string {
  if (inflight) {
    if (runningTool) return `正在调用 ${getToolFriendlyName(runningTool.name)}…`;
    return "正在推理与生成…";
  }
  const parts: string[] = [];
  if (toolCount > 0) parts.push(`${toolCount} 次工具调用`);
  if (thinkCount > 0) parts.push(`${thinkCount} 次思考`);
  if (parts.length === 0) parts.push("推理过程");
  const totalMs = thinkingMs + toolMs;
  if (totalMs > 0 && formatSeconds(totalMs) !== "0.0s") {
    parts.push(formatSeconds(totalMs));
  }
  return parts.join(" · ");
}

function AgentTraceTimeline({
  message,
  inflight,
}: {
  message: UiAgentMessage;
  inflight: boolean;
}) {
  const [open, setOpen] = useState(inflight);
  // 用户是否手动点击过折叠按钮：一旦点击，本 turn 内不再被自动 effect 覆盖
  const userToggled = useRef(false);
  const prevInflight = useRef(inflight);

  // 推理阶段（思考/工具调用）自动展开；正文开始输出后自动折叠。
  // 用户手动点击后设 userToggled=true，本 turn 内 effect 不再覆盖；
  // 新 turn 开始（inflight false→true）时重置。
  const answerStarted = Boolean(message.text);
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

  // 有序段是唯一渲染来源（流式按帧序拼装 / 回放后端从 items 派生）
  const segments = message.segments;
  const thinkCount = segments.filter((s) => s.kind === "thinking").length;
  const hasThink =
    segments.some((s) => s.kind === "thinking" && s.text) ||
    (inflight && !message.text && message.toolCalls.length === 0);
  const hasSteps = hasThink || message.toolCalls.length > 0;
  if (!hasSteps) return null;

  const runningTool = [...message.toolCalls]
    .reverse()
    .find((tc) => tc.status === "running");
  const toolMs = message.toolCalls.reduce((sum, tc) => sum + (tc.timeMs ?? 0), 0);
  const summary = traceSummaryLabel(
    message.thinkingMs ?? 0,
    toolMs,
    thinkCount,
    message.toolCalls.length,
    inflight,
    runningTool,
  );

  return (
    <div className="w-full text-sm">
      {/* 极简折叠头 */}
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

      {/* 展开的平铺步骤列表（按段顺序：思考→工具→再思考→工具…交错） */}
      {open ? (
        <div className="mt-2 space-y-1.5 border-b border-hairline/60 pb-3 mb-2.5 pt-1">
          {segments.map((seg, i) => {
            if (seg.kind === "thinking") {
              return (
                <TraceThinkRow
                  key={`think-${i}`}
                  text={seg.text}
                  inflight={
                    inflight && i === segments.length - 1 && message.thinkingMs == null && !message.text
                  }
                  thinkingMs={thinkCount === 1 ? message.thinkingMs : undefined}
                />
              );
            }
            const tc = message.toolCalls.find((t) => t.id === seg.id);
            return tc ? <TraceToolRow key={seg.id} tc={tc} /> : null;
          })}
        </div>
      ) : (
        <div className="border-b border-hairline/40 pb-1 mb-2" />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 助手底部操作栏（对齐知识库 AssistantActionBar：复制/赞/踩/分享 + tokens）
// ---------------------------------------------------------------------------

function AssistantActionBar({ message }: { message: UiAgentMessage }) {
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState<"up" | "down" | null>(null);

  const handleCopy = () => {
    void navigator.clipboard.writeText(message.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleShare = () => {
    if (navigator.share) {
      void navigator.share({ text: message.text });
    } else {
      void navigator.clipboard.writeText(message.text);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "flex h-7 items-center gap-1 rounded-lg px-2 text-[11px] transition-colors cursor-pointer",
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
            "flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer",
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
            "flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer",
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
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-gray-100 hover:text-foreground cursor-pointer"
          title="分享"
          aria-label="分享"
        >
          <Share2 className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 会话工作区面板（D20 统一视图：用户上传与 agent 产物同列，origin 仅是行内徽标）
// ---------------------------------------------------------------------------

const WORKSPACE_ORIGIN_LABEL: Record<string, string> = {
  upload: "上传",
  agent: "产物",
};

function workspaceStatusBadge(f: AgentWorkspaceFile): { text: string; cls: string } | null {
  if (f.parse_status === "parsing" || f.parse_status === "pending")
    return { text: "解析中", cls: "bg-primary/10 text-primary-deep" };
  if (f.parse_status === "failed")
    return { text: "解析失败", cls: "bg-red-50 text-red-600" };
  return null;
}

// ---------------------------------------------------------------------------
// 文件预览（Cursor 式：工作区点击文件 → 中栏以标签页打开，对话与文件平级切换）
// ---------------------------------------------------------------------------

/** 可按纯文本预览的扩展名（与后端工具面 _TEXTY_EXTS 口径对齐，前端展示用） */
const PREVIEW_TEXT_EXTS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml",
  "ini", "cfg", "conf", "log", "xml", "html", "js", "jsx", "ts", "tsx", "py",
  "rb", "go", "rs", "java", "c", "h", "cpp", "hpp", "cs", "php", "sh", "bash",
  "zsh", "sql", "env", "properties", "gradle", "cmake", "make", "lock",
]);

function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/**
 * 文件类型徽标：不同类型不同色块图标（PDF/DOC/PPT/XLS/MD/CSV/JSON/IMG/ZIP/AUD/VID…），
 * 未收录的带扩展名文件用扩展名本身当徽标（灰），无扩展名回退通用文件图标。
 */
const WORKSPACE_TYPE_BADGES: Record<string, { label: string; cls: string }> = {
  pdf: { label: "PDF", cls: "bg-red-500" },
  doc: { label: "DOC", cls: "bg-blue-600" },
  docx: { label: "DOC", cls: "bg-blue-600" },
  docm: { label: "DOC", cls: "bg-blue-600" },
  rtf: { label: "DOC", cls: "bg-blue-600" },
  odt: { label: "DOC", cls: "bg-blue-600" },
  ppt: { label: "PPT", cls: "bg-orange-500" },
  pptx: { label: "PPT", cls: "bg-orange-500" },
  pps: { label: "PPT", cls: "bg-orange-500" },
  odp: { label: "PPT", cls: "bg-orange-500" },
  xls: { label: "XLS", cls: "bg-emerald-600" },
  xlsx: { label: "XLS", cls: "bg-emerald-600" },
  xlsm: { label: "XLS", cls: "bg-emerald-600" },
  ods: { label: "XLS", cls: "bg-emerald-600" },
  md: { label: "MD", cls: "bg-violet-500" },
  markdown: { label: "MD", cls: "bg-violet-500" },
  csv: { label: "CSV", cls: "bg-teal-500" },
  tsv: { label: "CSV", cls: "bg-teal-500" },
  json: { label: "JSON", cls: "bg-sky-500" },
  jsonl: { label: "JSON", cls: "bg-sky-500" },
  zip: { label: "ZIP", cls: "bg-amber-500" },
  rar: { label: "ZIP", cls: "bg-amber-500" },
  "7z": { label: "ZIP", cls: "bg-amber-500" },
  tar: { label: "ZIP", cls: "bg-amber-500" },
  gz: { label: "ZIP", cls: "bg-amber-500" },
  mp3: { label: "AUD", cls: "bg-fuchsia-600" },
  wav: { label: "AUD", cls: "bg-fuchsia-600" },
  flac: { label: "AUD", cls: "bg-fuchsia-600" },
  mp4: { label: "VID", cls: "bg-rose-600" },
  mov: { label: "VID", cls: "bg-rose-600" },
  mkv: { label: "VID", cls: "bg-rose-600" },
  webm: { label: "VID", cls: "bg-rose-600" },
};

function fileTypeBadge(
  name: string,
  kind: "file" | "image",
  mime?: string | null,
): { label: string; cls: string } | null {
  if (kind === "image" || (mime ?? "").startsWith("image/")) {
    return { label: "IMG", cls: "bg-pink-500" };
  }
  const ext = fileExt(name);
  if (!ext) return null;
  return WORKSPACE_TYPE_BADGES[ext] ?? { label: ext.toUpperCase().slice(0, 4), cls: "bg-slate-400" };
}

/** 文件树/标签页通用的类型徽标图标（无类型信息时回退通用文件图标） */
function FileTypeBadge({
  name,
  kind,
  mime,
}: {
  name: string;
  kind: "file" | "image";
  mime?: string | null;
}) {
  const badge = fileTypeBadge(name, kind, mime);
  if (!badge) {
    return <FileText className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />;
  }
  return (
    <span
      className={cn(
        "flex h-4 min-w-6 shrink-0 items-center justify-center rounded-[3px] px-1 text-[8px] font-bold leading-none tracking-wider text-white",
        badge.cls,
      )}
      aria-hidden="true"
    >
      {badge.label}
    </span>
  );
}

function isPreviewImage(f: AgentWorkspaceFile): boolean {
  if (f.kind === "image") return true;
  return (f.mime ?? "").startsWith("image/");
}

function isPreviewPdf(f: AgentWorkspaceFile): boolean {
  return f.mime === "application/pdf" || fileExt(f.name) === "pdf";
}

function isPreviewText(f: AgentWorkspaceFile): boolean {
  const mime = f.mime ?? "";
  if (mime.startsWith("text/")) return true;
  if (
    ["application/json", "application/xml", "application/javascript", "application/x-sh", "application/sql"].includes(mime)
  ) {
    return true;
  }
  return PREVIEW_TEXT_EXTS.has(fileExt(f.name));
}

type PreviewMode = "md" | "original" | "parsing" | "failed" | "unsupported";

/** 默认预览形态：有解析产物看产物，解析中/失败给状态卡，其余按原文类型分流 */
function defaultPreviewMode(f: AgentWorkspaceFile): PreviewMode {
  if (f.parse_status === "ready" && (f.md_chars ?? 0) > 0) return "md";
  if (f.parse_status === "pending" || f.parse_status === "parsing") return "parsing";
  if (f.parse_status === "failed") return "failed";
  if (isPreviewImage(f) || isPreviewPdf(f) || isPreviewText(f)) return "original";
  return "unsupported";
}

/** 下载原始文件（行内按钮与预览工具栏共用） */
function downloadWorkspaceFile(file: AgentWorkspaceFile): Promise<void> {
  return fetchAgentFileBlobUrl(file.file_id).then((url) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
}

/** 代码/文本视图：行号列 + 等宽正文（横向滚动时行号吸顶列） */
function CodeView({ text }: { text: string }) {
  const MAX_CHARS = 300_000;
  const truncated = text.length > MAX_CHARS;
  const lines = (truncated ? text.slice(0, MAX_CHARS) : text).split("\n");
  return (
    <div className="h-full overflow-auto bg-[#fbfbfd]">
      {truncated ? (
        <p className="sticky top-0 z-10 border-b border-hairline/60 bg-amber-50/90 px-4 py-1.5 text-[11px] text-amber-700 backdrop-blur-xs">
          文件较大，仅显示前 {MAX_CHARS / 1000}K 字符，下载可查看完整内容。
        </p>
      ) : null}
      <div className="min-w-max py-2 font-mono text-[12.5px] leading-[1.6]">
        {lines.map((ln, i) => (
          <div key={i} className="flex hover:bg-gray-100/70">
            <span className="sticky left-0 w-11 shrink-0 select-none bg-[#fbfbfd] pr-3 text-right text-muted-faint/80">
              {i + 1}
            </span>
            <pre className="whitespace-pre pr-8 text-foreground/90">{ln || " "}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewStateCard({
  icon,
  title,
  detail,
  actions,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-muted-subtle">{icon}</div>
      <p className="text-sm font-medium text-foreground/80">{title}</p>
      {detail ? <p className="max-w-md text-xs leading-5 text-muted">{detail}</p> : null}
      {actions ? <div className="mt-1 flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const TOOLBAR_ICON_BTN =
  "flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-gray-200/70 hover:text-foreground cursor-pointer";

/**
 * 文件预览器（桌面标签页内容 / 移动全屏共用）：
 * 解析文本（md+资产 presigned）/ 原文（图片、PDF、代码文本）分流，
 * 解析中自动轮询元数据、完成后自动切到解析文本。
 */
function FilePreview({
  file,
  onMetaUpdate,
}: {
  file: AgentWorkspaceFile;
  onMetaUpdate: (fileId: string, meta: AgentWorkspaceFile) => void;
}) {
  const [forced, setForced] = useState<"md" | "original" | null>(null);
  const mode: PreviewMode = forced ?? defaultPreviewMode(file);

  const [md, setMd] = useState<string | null>(null);
  const [mdError, setMdError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const hasMd = file.parse_status === "ready" && (file.md_chars ?? 0) > 0;
  const canOriginal = isPreviewImage(file) || isPreviewPdf(file) || isPreviewText(file);

  // 解析中：轮询元数据，ready 后 file prop 更新、默认模式自动切到解析文本
  useEffect(() => {
    if (mode === "parsing") {
      const timer = window.setInterval(() => {
        fetchAgentFile(file.file_id)
          .then((meta) => onMetaUpdate(file.file_id, meta))
          .catch(() => {});
      }, 3000);
      return () => window.clearInterval(timer);
    }
  }, [mode, file.file_id, onMetaUpdate]);

  // 解析文本：md + 资产图换 presigned（D14 同款替换逻辑）
  useEffect(() => {
    if (mode !== "md") return;
    let cancelled = false;
    setMd(null);
    setMdError(null);
    Promise.all([fetchAgentFileMarkdown(file.file_id), fetchAgentAssetUrls(file.file_id)])
      .then(([markdown, urls]) => {
        let resolved = markdown;
        for (const [name, url] of Object.entries(urls)) {
          resolved = resolved.split(`assets/${name}`).join(url);
        }
        if (!cancelled) setMd(resolved);
      })
      .catch((e: unknown) => {
        if (!cancelled) setMdError(e instanceof Error ? e.message : "解析产物加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [mode, file.file_id]);

  // 原文：文本直读 / 图片·PDF 走 blob URL（卸载时回收）
  useEffect(() => {
    if (mode !== "original") return;
    let cancelled = false;
    let revoke: string | null = null;
    setLoadError(null);
    setText(null);
    setBlobUrl(null);
    if (isPreviewText(file)) {
      fetchAgentFileText(file.file_id)
        .then((t) => {
          if (!cancelled) setText(t);
        })
        .catch((e: unknown) => {
          if (!cancelled) setLoadError(e instanceof Error ? e.message : "文件加载失败");
        });
    } else {
      fetchAgentFileBlobUrl(file.file_id)
        .then((url) => {
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          revoke = url;
          setBlobUrl(url);
        })
        .catch((e: unknown) => {
          if (!cancelled) setLoadError(e instanceof Error ? e.message : "文件加载失败");
        });
    }
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, file.file_id]);

  const handleDownload = () => {
    if (downloading) return;
    setDownloading(true);
    downloadWorkspaceFile(file).finally(() => setDownloading(false));
  };

  const body = (() => {
    if (mode === "md") {
      if (mdError) {
        return <PreviewStateCard icon={<AlertCircle className="h-6 w-6" />} title="解析文本加载失败" detail={mdError} />;
      }
      if (md == null) {
        return (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            解析文本加载中…
          </div>
        );
      }
      return (
        <div className="mx-auto w-full max-w-[880px] px-5 py-6 sm:px-8">
          <AgentMarkdown content={md} />
        </div>
      );
    }
    if (mode === "original") {
      if (loadError) {
        return <PreviewStateCard icon={<AlertCircle className="h-6 w-6" />} title="文件加载失败" detail={loadError} />;
      }
      if (isPreviewText(file)) {
        return text == null ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            文件加载中…
          </div>
        ) : (
          <CodeView text={text} />
        );
      }
      if (isPreviewPdf(file)) {
        // PDF.js 连续页渲染（页宽撑满），不用浏览器原生 iframe 视图
        return blobUrl ? <PdfPages url={blobUrl} /> : (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            文档加载中…
          </div>
        );
      }
      if (isPreviewImage(file)) {
        return blobUrl ? (
          <div className="flex h-full items-center justify-center overflow-auto bg-gray-100/70 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={blobUrl}
              alt={file.name}
              onClick={() => window.open(blobUrl, "_blank")}
              className="max-h-full max-w-full cursor-zoom-in object-contain shadow-sm"
            />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            图片加载中…
          </div>
        );
      }
      return (
        <PreviewStateCard
          icon={<FileText className="h-6 w-6" />}
          title="该格式暂不支持预览"
          detail={`${file.name} · ${humanSize(file.size)}`}
          actions={
            <button
              type="button"
              onClick={handleDownload}
              className="flex h-7 items-center gap-1.5 rounded-full border border-hairline bg-white px-3 text-xs text-muted transition-colors hover:border-primary/40 hover:text-primary cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              下载文件
            </button>
          }
        />
      );
    }
    if (mode === "parsing") {
      return (
        <PreviewStateCard
          icon={<Loader2 className="h-6 w-6 animate-spin" />}
          title="文档解析中…"
          detail="MinerU 正在提取文本与图片，完成后自动展示解析结果。"
          actions={canOriginal ? (
            <button
              type="button"
              onClick={() => setForced("original")}
              className="flex h-7 items-center gap-1.5 rounded-full border border-hairline bg-white px-3 text-xs text-muted transition-colors hover:border-primary/40 hover:text-primary cursor-pointer"
            >
              先看原文
            </button>
          ) : undefined}
        />
      );
    }
    if (mode === "failed") {
      return (
        <PreviewStateCard
          icon={<AlertCircle className="h-6 w-6 text-red-400" />}
          title="解析失败"
          detail={file.parse_error || "文档解析未成功，可查看原文或重新上传。"}
          actions={
            <>
              {canOriginal ? (
                <button
                  type="button"
                  onClick={() => setForced("original")}
                  className="flex h-7 items-center gap-1.5 rounded-full border border-hairline bg-white px-3 text-xs text-muted transition-colors hover:border-primary/40 hover:text-primary cursor-pointer"
                >
                  查看原文
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleDownload}
                className="flex h-7 items-center gap-1.5 rounded-full border border-hairline bg-white px-3 text-xs text-muted transition-colors hover:border-primary/40 hover:text-primary cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                下载文件
              </button>
            </>
          }
        />
      );
    }
    return (
      <PreviewStateCard
        icon={<FileText className="h-6 w-6" />}
        title="该格式暂不支持预览"
        detail={`${file.name} · ${humanSize(file.size)}`}
        actions={
          <button
            type="button"
            onClick={handleDownload}
            className="flex h-7 items-center gap-1.5 rounded-full border border-hairline bg-white px-3 text-xs text-muted transition-colors hover:border-primary/40 hover:text-primary cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            下载文件
          </button>
        }
      />
    );
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      {/* 工具栏：视图切换（解析产物 ↔ 原文）+ 外链/下载 */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-hairline/60 bg-gray-50/70 px-2 sm:px-3">
        <div className="flex min-w-0 items-center">
          {hasMd && canOriginal ? (
            <div className="flex rounded-md border border-hairline bg-white p-0.5 text-[11px]">
              {(["md", "original"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForced(m)}
                  className={cn(
                    "rounded px-2 py-0.5 transition-colors cursor-pointer",
                    mode === m
                      ? "bg-primary/10 font-medium text-primary-deep"
                      : "text-muted hover:text-foreground",
                  )}
                >
                  {m === "md" ? "解析文本" : "原文"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {blobUrl && isPreviewPdf(file) ? (
            <a
              href={blobUrl}
              target="_blank"
              rel="noreferrer"
              className={TOOLBAR_ICON_BTN}
              title="新窗口打开"
              aria-label="新窗口打开"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className={cn(TOOLBAR_ICON_BTN, "disabled:opacity-40")}
            title="下载原始文件"
            aria-label="下载原始文件"
          >
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </div>
  );
}

/** 工作区文件标签条（面板头部，纯文件页签；文件列表走独立按钮弹出的小侧栏） */
function WorkspaceTabStrip({
  tabs,
  activeId,
  onSelect,
  onCloseTab,
}: {
  tabs: AgentWorkspaceFile[];
  activeId: string;
  onSelect: (id: string) => void;
  onCloseTab: (fileId: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-stretch self-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map((t) => {
        const active = activeId === t.file_id;
        return (
          <div
            key={t.file_id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(t.file_id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelect(t.file_id);
            }}
            className={cn(
              // 弹性压缩：标签少时撑到 max-w-40，变多均分变窄（文字截断），
              // 全部压到 min-w 后容器横向滚动兜底
              "group/tab relative flex h-11 min-w-[72px] max-w-40 flex-1 basis-0 cursor-pointer select-none items-center gap-1.5 border-r border-hairline/60 px-2.5 text-xs transition-colors",
              active
                ? "bg-white font-medium text-foreground"
                : "text-muted hover:bg-gray-200/40 hover:text-foreground",
            )}
            title={t.name}
          >
            {active ? (
              <span className="absolute inset-x-0 top-0 h-[2px] bg-primary" aria-hidden="true" />
            ) : null}
            <FileTypeBadge name={t.name} kind={t.kind} mime={t.mime} />
            <span className="min-w-0 flex-1 truncate">{t.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(t.file_id);
              }}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-faint transition-colors hover:bg-gray-300/60 hover:text-foreground cursor-pointer"
              title="关闭"
              aria-label={`关闭 ${t.name}`}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** 工作区单个文件行（Cursor Explorer 风格）：点击整行打开预览，hover 出下载/删除 */
function WorkspaceFileRow({
  file,
  active,
  onOpen,
  onDeleted,
}: {
  file: AgentWorkspaceFile;
  active: boolean;
  onOpen: (file: AgentWorkspaceFile) => void;
  onDeleted: (fileId: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const originLabel = WORKSPACE_ORIGIN_LABEL[file.origin] ?? file.origin;
  const status = workspaceStatusBadge(file);

  const handleDownload = () => {
    if (busy) return;
    setBusy(true);
    downloadWorkspaceFile(file).finally(() => setBusy(false));
  };

  const handleDelete = () => {
    if (busy) return;
    setBusy(true);
    deleteAgentAttachment(file.file_id)
      .then(() => onDeleted(file.file_id))
      .catch(() => setBusy(false));
  };

  return (
    <div
      className={cn(
        "group/row rounded-md hover:bg-gray-200/40",
        active && "bg-primary/10",
      )}
    >
      <div className="flex items-center gap-1 px-1.5 py-1">
        <button
          type="button"
          onClick={() => onOpen(file)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded text-left"
          title={`预览 ${file.name}`}
        >
          <FileTypeBadge name={file.name} kind={file.kind} mime={file.mime} />
          <span
            className={cn(
              "truncate text-xs text-foreground/85",
              active && "font-medium text-primary-deep",
            )}
          >
            {file.name}
          </span>
          {file.origin === "agent" ? (
            <span className="shrink-0 rounded bg-emerald-50 px-1 py-px text-[10px] leading-tight text-emerald-700">
              {originLabel}
            </span>
          ) : null}
          {status ? (
            <span className={cn("shrink-0 rounded px-1 py-px text-[10px] leading-tight", status.cls)}>
              {status.text}
            </span>
          ) : null}
          <span className="shrink-0 text-[10px] text-muted-faint">{humanSize(file.size)}</span>
        </button>
        {/* Cursor Explorer 风格：操作按钮 hover 才可见，但宽度常驻（opacity 切换
            而非 display），避免出现/消失时挤压文件名造成行抖动 */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 pointer-events-none transition-opacity group-hover/row:opacity-100 group-hover/row:pointer-events-auto">
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-subtle transition-colors hover:bg-gray-300/50 hover:text-foreground disabled:opacity-40 cursor-pointer"
            title="下载原始文件"
            aria-label={`下载 ${file.name}`}
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : (
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-subtle transition-colors hover:bg-red-100 hover:text-red-600 disabled:opacity-40 cursor-pointer"
            title="从工作区删除"
            aria-label={`删除 ${file.name}`}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 工作区文件分组（Cursor Explorer 文件夹语义）：按来源折叠分组。
 * 「目标产出物」等更细分类待二期 files_out 语义（deliverable 标记）落地后
 * 作为新分组接入——分组渲染按数据驱动，届时零 UI 改动。
 */
function WorkspaceFolder({
  label,
  files,
  rowProps,
}: {
  label: string;
  files: AgentWorkspaceFile[];
  rowProps: {
    onOpen: (file: AgentWorkspaceFile) => void;
    activeFileId?: string | null;
    onFileDeleted: (fileId: string) => void;
    onRefresh: () => void;
  };
}) {
  const [open, setOpen] = useState(true);
  if (files.length === 0) return null;
  const { onOpen, activeFileId, onFileDeleted, onRefresh } = rowProps;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer select-none items-center gap-1 rounded-md px-1.5 py-1 text-xs text-foreground/80 transition-colors hover:bg-gray-200/40"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-faint" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-faint" aria-hidden="true" />
        )}
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
        <span className="truncate font-medium">{label}</span>
        <span className="shrink-0 text-[10px] text-muted-faint">{files.length}</span>
      </button>
      {open ? (
        <div className="mt-0.5 space-y-0.5 pl-6">
          {files.map((f) => (
            <WorkspaceFileRow
              key={f.file_id}
              file={f}
              active={activeFileId === f.file_id}
              onOpen={onOpen}
              onDeleted={(fid) => {
                onFileDeleted(fid);
                onRefresh();
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 工作区文件列表（桌面侧板与移动抽屉共用）：上传与 agent 产物分文件夹 */
function WorkspaceFileList({
  files,
  onRefresh,
  onOpen,
  activeFileId,
  onFileDeleted,
}: {
  files: AgentWorkspaceFile[] | null;
  onRefresh: () => void;
  onOpen: (file: AgentWorkspaceFile) => void;
  activeFileId?: string | null;
  onFileDeleted?: (fileId: string) => void;
}) {
  const rowProps = { onOpen, activeFileId, onRefresh, onFileDeleted: onFileDeleted ?? (() => {}) };
  if (files == null) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        加载工作区…
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-xs leading-5 text-muted-subtle">
        工作区为空——用输入框的「附件」按钮上传文件，上传与执行产物都会汇集在这里。
      </p>
    );
  }
  return (
    <div className="space-y-1 px-2 pb-4">
      <WorkspaceFolder label="上传文件" files={files.filter((f) => f.origin !== "agent")} rowProps={rowProps} />
      <WorkspaceFolder label="agent 执行产物" files={files.filter((f) => f.origin === "agent")} rowProps={rowProps} />
    </div>
  );
}

/**
 * 会话工作区侧板（lg+）：上传与 agent 产物统一列表 + 文件预览，均在面板内完成
 * （Cursor 分区语义：对话区不承载文件查看）。
 * - 面板恒定 46vw（400-640px）：点开工作区即大面板，无"窄条再展开"两段式
 * - 头部：[文件树按钮] + 文件标签条（无标签时显示标题）+ 刷新/关闭
 * - 文件树是小浮层：从左缘盖在预览上方（不压缩预览区宽度，遮住部分预览属
 *   预期）；工作区无文件时不渲染、主区显示空态；点文件开预览标签页，树不
 *   自动收起，☰ 手动切换
 */
function WorkspacePanel({
  sessionId,
  onClose,
  onCountChange,
  refreshSignal = 0,
}: {
  sessionId: string;
  onClose: () => void;
  onCountChange: (count: number) => void;
  /** 附件上传完成/解析结束时自增，驱动本面板主动刷新文件树 */
  refreshSignal?: number;
}) {
  const [files, setFiles] = useState<AgentWorkspaceFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 预览标签页（面板私有）
  const [tabs, setTabs] = useState<AgentWorkspaceFile[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // 文件列表小侧栏（右缘左滑弹出）
  const [listOpen, setListOpen] = useState(false);

  const refresh = () => {
    listAgentSessionFiles(sessionId)
      .then((items) => {
        setFiles(items);
        setError(null);
        onCountChange(items.length);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "工作区加载失败"));
  };

  useEffect(() => {
    setFiles(null);
    setError(null);
    setTabs([]);
    setActiveTabId(null);
    setListOpen(true); // 进面板文件树默认展开（有文件才渲染树列）
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 外部刷新信号（新附件上传完成/解析结束）：主动刷新文件树
  useEffect(() => {
    if (refreshSignal > 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const activeFile = tabs.find((t) => t.file_id === activeTabId) ?? null;

  const openFile = (file: AgentWorkspaceFile) => {
    setTabs((prev) =>
      prev.some((t) => t.file_id === file.file_id)
        ? prev.map((t) => (t.file_id === file.file_id ? file : t))
        : [...prev, file],
    );
    setActiveTabId(file.file_id);
    // 文件树不自动收起：左侧树与右侧预览常驻并排，☰ 手动切换
  };

  const closeTab = (fileId: string) => {
    const idx = tabs.findIndex((t) => t.file_id === fileId);
    const next = tabs.filter((t) => t.file_id !== fileId);
    setTabs(next);
    if (activeTabId === fileId) {
      setActiveTabId(next[Math.min(idx, next.length - 1)]?.file_id ?? null);
    }
  };

  /** 解析轮询回填：更新标签持有的元数据（ready 后预览自动切解析文本） */
  const updateTabMeta = useCallback((fileId: string, meta: AgentWorkspaceFile) => {
    setTabs((prev) => prev.map((t) => (t.file_id === fileId ? meta : t)));
  }, []);

  /** 删除文件：关掉对应标签并刷新列表 */
  const handleFileDeleted = (fileId: string) => {
    setTabs((prev) => prev.filter((t) => t.file_id !== fileId));
    setActiveTabId((cur) => (cur === fileId ? null : cur));
    refresh();
  };

  const totalBytes = (files ?? []).reduce((acc, f) => acc + (f.size || 0), 0);
  const statsLine = files
    ? `${files.length} 个文件 · 已用 ${humanSize(totalBytes)} / 500MB`
    : "…";
  // 文件树常驻左侧小侧栏：仅在有文件时占据（空工作区不出树，主区给空态）
  const treeVisible = listOpen && (files?.length ?? 0) > 0;

  return (
    <aside
      className={cn(
        // 不加 width transition：该 webview 对 width 过渡（尤其 vw 目标值）会卡在中间值不落定
        "relative hidden shrink-0 flex-col border-l border-hairline/60 bg-gray-50/60 lg:flex",
        "w-[46vw] min-w-[400px] max-w-[640px]",
      )}
    >
      {/* 头部：文件列表按钮 + 文件标签（或标题）+ 刷新/关闭 */}
      <div className="flex h-11 shrink-0 items-stretch border-b border-hairline/60 bg-gray-50/70">
        <button
          type="button"
          onClick={() => {
            // 空工作区无树可切；有文件时切换左侧文件树列
            if ((files?.length ?? 0) > 0) setListOpen((v) => !v);
          }}
          className={cn(
            "flex w-9 shrink-0 cursor-pointer items-center justify-center border-r border-hairline/60 transition-colors",
            treeVisible
              ? "bg-white text-primary-deep"
              : "text-muted hover:bg-gray-200/40 hover:text-foreground",
          )}
          title="文件树"
          aria-label={treeVisible ? "收起文件树" : "打开文件树"}
          aria-expanded={treeVisible}
        >
          <List className="h-4 w-4" aria-hidden="true" />
        </button>
        {tabs.length > 0 && activeFile ? (
          <WorkspaceTabStrip
            tabs={tabs}
            activeId={activeFile.file_id}
            onSelect={setActiveTabId}
            onCloseTab={closeTab}
          />
        ) : (
          <span className="flex items-center px-3 text-xs font-medium text-foreground">
            会话工作区
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 border-l border-hairline/60 pl-1 pr-2">
          <button
            type="button"
            onClick={refresh}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-gray-200/70 hover:text-foreground cursor-pointer"
            title="刷新"
            aria-label="刷新工作区"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-gray-100 hover:text-foreground cursor-pointer"
            title="关闭"
            aria-label="关闭会话工作区"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 主体：预览/占位/空态占满全宽；文件树为浮层盖在其上（不压缩预览区） */}
      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {activeFile ? (
            <FilePreview file={activeFile} onMetaUpdate={updateTabMeta} />
          ) : error ? (
            <div className="flex flex-1 items-center justify-center px-6">
              <p className="text-xs text-red-500">{error}</p>
            </div>
          ) : files == null ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              加载工作区…
            </div>
          ) : files.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <FolderOpen className="h-6 w-6 text-muted-subtle" aria-hidden="true" />
              <p className="max-w-[230px] text-xs leading-5 text-muted-subtle">
                工作区为空——用输入框的「附件」按钮上传文件，上传与执行产物都会汇集在这里。
              </p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <FolderOpen className="h-6 w-6 text-muted-subtle" aria-hidden="true" />
              <p className="text-xs leading-5 text-muted-subtle">
                {treeVisible ? "在左侧文件树选择文件查看预览" : "点击左上角 ☰ 打开文件树选择文件"}
              </p>
            </div>
          )}
        </div>
        {/* 文件树浮层：左缘盖在预览上方，预览区宽度不变（部分被遮属预期） */}
        {treeVisible ? (
          <div className="absolute inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-hairline/60 bg-white shadow-[8px_0_16px_rgba(0,0,0,0.12)]">
            <p className="shrink-0 border-b border-hairline/50 px-4 py-2 text-[11px] text-muted-subtle">
              {statsLine}
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
              <WorkspaceFileList
                files={files}
                onRefresh={refresh}
                onOpen={openFile}
                activeFileId={activeTabId}
                onFileDeleted={handleFileDeleted}
              />
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/** 移动端工作区抽屉（/lg 布局，与会话抽屉同一交互层；点文件进全屏预览） */
function WorkspaceMobileDrawer({
  sessionId,
  open,
  onClose,
  onCountChange,
  onOpenFile,
}: {
  sessionId: string;
  open: boolean;
  onClose: () => void;
  onCountChange: (count: number) => void;
  onOpenFile: (file: AgentWorkspaceFile) => void;
}) {
  const [files, setFiles] = useState<AgentWorkspaceFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    listAgentSessionFiles(sessionId)
      .then((items) => {
        setFiles(items);
        setError(null);
        onCountChange(items.length);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "工作区加载失败"));
  };

  useEffect(() => {
    if (!open) return;
    setFiles(null);
    setError(null);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, open]);

  if (!open) return null;
  const totalBytes = (files ?? []).reduce((acc, f) => acc + (f.size || 0), 0);

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button
        type="button"
        aria-label="关闭会话工作区"
        onClick={onClose}
        className="absolute inset-0 bg-black/25"
      />
      <div className="absolute inset-y-0 right-0 flex w-[85%] max-w-xs flex-col border-l border-hairline/60 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-hairline/70 px-4 py-3">
          <span className="text-sm font-medium text-foreground">会话工作区</span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-gray-100 hover:text-foreground cursor-pointer"
            title="关闭"
            aria-label="关闭会话工作区"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="px-4 py-2 text-[11px] text-muted-subtle">
          {files ? `${files.length} 个文件 · 已用 ${humanSize(totalBytes)} / 500MB` : "…"}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <p className="px-4 py-4 text-xs text-red-500">{error}</p>
          ) : (
            <WorkspaceFileList files={files} onRefresh={refresh} onOpen={onOpenFile} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 轮次块：用户右对齐轻气泡 + 助手通栏（对齐知识库 ChatTurnBlock）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 附件（会话工作空间，docs/会话附件与工作空间设计.md §7）
// ---------------------------------------------------------------------------

/** composer 里待发送附件的本地状态（chip 状态机） */
interface PendingAttachment {
  localId: string;
  fileId: string | null;
  name: string;
  kind: "file" | "image";
  size: number;
  status: "uploading" | "parsing" | "ready" | "failed";
  error?: string;
}

function attachmentIcon(kind: "file" | "image") {
  return kind === "image" ? ImageIcon : FileText;
}

/** session 平均缓存命中率（token 加权：Σcached/Σinput，非百分比均值） */
function sessionCacheHitRate(
  usages: Array<{ input_tokens?: number; cached_tokens?: number } | null | undefined>,
): number | null {
  let cached = 0;
  let input = 0;
  for (const u of usages) {
    if (!u?.input_tokens) continue;
    input += u.input_tokens;
    cached += u.cached_tokens ?? 0;
  }
  if (input <= 0) return null;
  return cached / input;
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

/**
 * 对话栏上下文/缓存控件（与知识库 ContextIndicator 同一交互形态；agent 侧
 * 无 context status 上报，构成展示简化为：缓存命中 + 当前上下文规模 + 累计）。
 * 小圈 = session 缓存命中率；横条 = 当前上下文占模型窗口比例。
 */
function ComposerContextWidget({
  usages,
  maxContext,
}: {
  usages: Array<{ input_tokens?: number; cached_tokens?: number; output_tokens?: number } | null | undefined>;
  maxContext?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // 浮层以按钮中心居中锚定（CSS left-1/2 -translate-x-1/2）。小屏上按钮不在
  // 屏幕中线，居中后可能单侧出屏——不做位移（位移会破坏"圈在浮层下沿正中"），
  // 而是按按钮到两侧视口边的可用空间收缩宽度
  useLayoutEffect(() => {
    if (!open || !popupRef.current || !rootRef.current) return;
    const el = popupRef.current;
    el.style.width = "";
    const r = rootRef.current.getBoundingClientRect();
    const center = r.left + r.width / 2;
    const avail = Math.floor(2 * Math.min(center - 8, window.innerWidth - center - 8));
    const width = el.getBoundingClientRect().width;
    if (width > avail) el.style.width = `${Math.max(avail, 240)}px`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const rate = sessionCacheHitRate(usages);
  const cachePct = rate != null ? Math.round(rate * 100) : null;
  // 当前上下文规模 = 最近一轮的输入 tokens（含历史前缀）
  const lastInput = [...usages].reverse().find((u) => (u?.input_tokens ?? 0) > 0)?.input_tokens ?? 0;
  const window_ = maxContext && maxContext > 0 ? maxContext : 0;
  const ctxPct = window_ > 0 ? Math.min(100, Math.round((lastInput / window_) * 100)) : 0;
  let totalIn = 0;
  let totalOut = 0;
  for (const u of usages) {
    totalIn += u?.input_tokens ?? 0;
    totalOut += u?.output_tokens ?? 0;
  }
  if (cachePct == null && lastInput <= 0) return null; // 尚无任何用量数据不占位

  return (
    <div ref={rootRef} className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          // 裸圈形态：无胶囊壳，仅 hover 轻底色
          "inline-flex h-6 w-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-gray-100 hover:text-foreground cursor-pointer",
          open && "bg-gray-100 text-foreground",
        )}
        title={`上下文 ${ctxPct}% · 缓存命中 ${cachePct ?? 0}%`}
        aria-label="缓存命中与上下文"
        aria-expanded={open}
      >
        {/* 小圈 = 上下文使用比例（不显数字；缓存命中看浮层行） */}
        <ContextRing pct={ctxPct} size={14} title={`上下文 ${ctxPct}% · 缓存命中 ${cachePct ?? 0}%`} />
      </button>
      {open ? (
        <div
          ref={popupRef}
          className="absolute bottom-full left-1/2 z-30 mb-1.5 w-64 max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-3 text-[11px] shadow-xl"
        >
          <div className="mb-2 font-medium text-foreground">上下文与缓存</div>
          <div className="space-y-1 text-muted">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <ContextRing pct={cachePct ?? 0} size={12} /> 缓存命中
              </span>
              <span>{cachePct != null ? `${cachePct}%` : "暂无"}</span>
            </div>
            {window_ > 0 ? (
              <div className="flex items-center justify-between">
                <span>当前上下文</span>
                <span>
                  ~{formatTokens(lastInput)} / {formatTokens(window_)}（{ctxPct}%）
                </span>
              </div>
            ) : null}
            <div className="flex items-center justify-between">
              <span>累计输入</span>
              <span>{formatTokens(totalIn)} tokens</span>
            </div>
            <div className="flex items-center justify-between">
              <span>累计输出</span>
              <span>{formatTokens(totalOut)} tokens</span>
            </div>
          </div>
          <p className="mt-2 border-t border-gray-100 pt-2 text-[10.5px] leading-4 text-muted-subtle">
            缓存命中为前缀缓存复用比例（按 token 加权）；首轮与长对话后回落的命中率属正常现象。
          </p>
        </div>
      ) : null}
    </div>
  );
}

function humanSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = size;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${i === 0 ? v.toFixed(0) : v.toFixed(1)}${units[i]}`;
}

/** 图片附件缩略图（鉴权 fetch → blob URL；点击新开查看，卸载回收） */
function AttachmentThumb({ fileId, name }: { fileId: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    fetchAgentFileBlobUrl(fileId)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        revoke = u;
        setUrl(u);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [fileId]);
  if (failed) {
    return (
      <div
        className="flex h-20 w-20 items-center justify-center rounded-lg border border-hairline bg-gray-50 text-muted-subtle"
        title={name}
      >
        <ImageIcon className="h-5 w-5" aria-hidden="true" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => url && window.open(url, "_blank")}
      className="h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-hairline bg-gray-100 transition-shadow hover:shadow-md cursor-pointer"
      title={`查看 ${name}`}
    >
      {url ? (
        // blob URL 本地对象，next/image 无优化收益
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full animate-pulse" />
      )}
    </button>
  );
}

/** 用户消息里的文件附件 chip（点击下载原始文件） */
function AttachmentFileChip({ attachment }: { attachment: AgentAttachmentMeta }) {
  const [busy, setBusy] = useState(false);
  const Icon = attachmentIcon(attachment.kind);
  const handleDownload = () => {
    if (busy) return;
    setBusy(true);
    fetchAgentFileBlobUrl(attachment.file_id)
      .then((url) => {
        const a = document.createElement("a");
        a.href = url;
        a.download = attachment.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      })
      .catch(() => {
        /* 静默：chip 仍在，可重试 */
      })
      .finally(() => setBusy(false));
  };
  const sizeLabel = humanSize(attachment.size ?? 0);
  return (
    <button
      type="button"
      onClick={handleDownload}
      className="flex max-w-full items-center gap-1.5 rounded-full border border-hairline bg-white px-3 py-1.5 text-xs text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary cursor-pointer"
      title={`下载 ${attachment.name}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate max-w-[180px]">{attachment.name}</span>
      {sizeLabel ? (
        <span className="shrink-0 text-muted-subtle">{sizeLabel}</span>
      ) : null}
      {busy ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" /> : null}
    </button>
  );
}

/** 用户消息气泡上方的附件展示（图片缩略图 + 文件 chip；发送即时与回放共用） */
function AttachmentBubbleRow({ attachments }: { attachments: AgentAttachmentMeta[] }) {
  const valid = (attachments ?? []).filter((a) => a && a.file_id);
  if (valid.length === 0) return null;
  const images = valid.filter((a) => a.kind === "image");
  const files = valid.filter((a) => a.kind !== "image");
  return (
    <div className="mb-2 flex flex-col items-end gap-1.5">
      {images.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {images.map((a) => (
            <AttachmentThumb key={a.file_id} fileId={a.file_id} name={a.name} />
          ))}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="flex flex-wrap justify-end gap-1.5">
          {files.map((a) => (
            <AttachmentFileChip key={a.file_id} attachment={a} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** composer 里的待发送附件 chip（上传中/解析中/就绪/失败 状态机，D2 发送锁配套） */
function PendingAttachmentChip({
  item,
  onRemove,
}: {
  item: PendingAttachment;
  onRemove: () => void;
}) {
  const Icon = attachmentIcon(item.kind);
  const label =
    item.status === "uploading"
      ? "上传中…"
      : item.status === "parsing"
        ? "解析中…"
        : item.status === "failed"
          ? item.error || "失败"
          : "就绪";
  return (
    <div
      className={cn(
        "flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors",
        item.status === "failed"
          ? "border-red-200 bg-red-50/80 text-red-600"
          : item.status === "ready"
            ? "border-hairline bg-white text-foreground/80"
            : "border-hairline bg-gray-50 text-muted",
      )}
      title={item.status === "failed" ? item.error : item.name}
    >
      {item.status === "uploading" || item.status === "parsing" ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
      ) : item.status === "failed" ? (
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden="true" />
      )}
      <span className="truncate max-w-[160px]">{item.name}</span>
      <span
        className={cn(
          "shrink-0 text-[11px]",
          item.status === "failed" ? "text-red-500" : "text-muted-subtle",
        )}
      >
        {label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-subtle transition-colors hover:bg-gray-200/70 hover:text-foreground cursor-pointer"
        title="移除附件"
        aria-label={`移除附件 ${item.name}`}
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}

function UserBubble({ message }: { message: UiAgentMessage }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(message.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="group relative flex flex-col items-end gap-1 pt-1">
      {message.attachments && message.attachments.length > 0 ? (
        <div className="max-w-[85%]">
          <AttachmentBubbleRow attachments={message.attachments} />
        </div>
      ) : null}
      <div className="relative max-w-[85%] rounded-[20px_20px_4px_20px] bg-primary/5 px-4 py-2.5 text-[14px] sm:text-[15px] leading-relaxed sm:leading-7 text-foreground sm:px-5 sm:py-3 transition-colors hover:bg-primary/10 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        <div className="whitespace-pre-wrap break-words leading-relaxed sm:leading-7">
          {message.text}
        </div>
      </div>
      <div className="flex h-5 items-center gap-1.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={handleCopy}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-subtle hover:bg-gray-100 hover:text-foreground transition-colors cursor-pointer"
          title="复制问题"
          aria-label="复制问题"
        >
          {copied ? (
            <Check className="h-3 w-3 text-emerald-600" aria-hidden="true" />
          ) : (
            <Copy className="h-3 w-3" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

function ChatTurnBlock({
  userMessage,
  assistant,
  isLastTurn,
}: {
  userMessage: UiAgentMessage;
  assistant: UiAgentMessage | null;
  isLastTurn: boolean;
}) {
  const inflight = assistant ? !assistant.done : false;
  const hasAnswer = Boolean(assistant?.text);

  return (
    <div className="space-y-4 animate-fadeIn">
      <UserBubble message={userMessage} />

      {/* 助手回答：通栏、无外框 */}
      {assistant ? (
        <div className="min-w-0 space-y-3 pt-1">
          {/* 身份头 */}
          <div className="flex items-center gap-2">
            <BrandAvatar className="h-6 w-6" />
            <span className="text-xs font-medium text-foreground select-none">
              智能体助手
            </span>
            {inflight ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-primary-deep font-medium">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                正在生成…
              </span>
            ) : null}
          </div>

          {/* 推理轨道 */}
          <AgentTraceTimeline message={assistant} inflight={inflight} />

          {/* 正文 */}
          {hasAnswer ? (
            <div className="markdown-body prose prose-sm max-w-none text-foreground text-[14px] sm:text-[15px] leading-relaxed sm:leading-7 prose-p:leading-relaxed sm:prose-p:leading-7 prose-li:leading-relaxed sm:prose-li:leading-7 prose-p:my-2 prose-li:my-0.5 prose-headings:font-semibold prose-headings:leading-snug prose-blockquote:leading-relaxed">
              <AgentMarkdown content={assistant.text} inflight={inflight} />
            </div>
          ) : inflight && assistant.segments.length === 0 ? (
            <div className="flex items-center gap-2 py-1.5 text-sm text-muted-subtle">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="font-medium">正在思考…</span>
            </div>
          ) : null}

          {/* 底部：从左到右 = 操作栏 → token 数量（左对齐，不留右推空位） */}
          {!inflight && hasAnswer ? (
            <div className="mt-4 flex flex-wrap items-center gap-2.5 border-t border-hairline/60 pt-2.5">
              <AssistantActionBar message={assistant} />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 轮次间微弱分隔线（仅非最后一轮） */}
      {!isLastTurn ? (
        <div className="my-6 h-px bg-hairline/60" aria-hidden="true" />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 欢迎屏（对齐知识库 ChatEmptyWelcomeGuide）
// ---------------------------------------------------------------------------

const STARTER_CARDS = [
  {
    title: "沙箱算数",
    desc: "在 WASM 沙箱里执行 Python，完成精确计算与数据处理",
    prompt: "用代码沙箱算一算：从 1 加到 1000 等于多少",
    icon: SquareTerminal,
  },
  {
    title: "联网搜索",
    desc: "检索公开网络的最新信息，汇总成简明摘要",
    prompt: "搜索今天的 AI 领域新闻，并总结成三句话",
    icon: Globe,
  },
  {
    title: "写码验证",
    desc: "生成代码并实际运行验证，确保给到的结果可复现",
    prompt: "帮我写一个快速排序，并在沙箱里运行验证",
    icon: Code2,
  },
];

function WelcomeGuide({ onSelectPrompt }: { onSelectPrompt: (p: string) => void }) {
  return (
    <div className="mx-auto my-auto flex w-full max-w-2xl flex-col items-center py-6 text-center animate-fadeIn">
      {/* 沉浸式微渐变徽标 */}
      <BrandAvatar className="relative mb-4 h-14 w-14 rounded-2xl" />

      <h2 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
        有什么可以帮你？
      </h2>
      <p className="mt-1.5 max-w-md text-xs leading-relaxed text-muted-subtle sm:text-[13px]">
        可以检索你的知识库、搜索网络、在隔离沙箱里执行代码完成计算与数据处理。
      </p>

      {/* 3 张 Prompt 卡片 */}
      <div className="mt-6 grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        {STARTER_CARDS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.prompt}
              type="button"
              onClick={() => onSelectPrompt(item.prompt)}
              className="group relative flex flex-col justify-between rounded-xl border border-hairline/90 bg-white/90 p-3.5 text-left shadow-[0_1px_3px_rgba(0,0,0,0.03)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-white hover:shadow-md active:scale-[0.98] cursor-pointer"
            >
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary-deep transition-colors group-hover:bg-primary/15">
                    <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  </div>
                  <ArrowUpRight
                    className="h-3.5 w-3.5 text-muted-faint opacity-0 transition-all duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary-deep group-hover:opacity-100"
                    aria-hidden="true"
                  />
                </div>
                <div className="text-xs font-semibold text-foreground transition-colors group-hover:text-primary-deep">
                  {item.title}
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-subtle">
                  {item.desc}
                </p>
              </div>

              <div className="mt-3 flex items-center gap-1 text-[10.5px] font-medium text-primary-deep opacity-80 group-hover:opacity-100">
                <span>立即提问</span>
                <ChevronRight className="h-2.5 w-2.5" aria-hidden="true" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 主面板
// ---------------------------------------------------------------------------

export function AgentChatPanel() {
  const {
    messages,
    busy,
    connection,
    lastError,
    sessions,
    sessionsLoading,
    historyLoading,
    sessionId,
    newSession,
    selectSession,
    renameSession,
    deleteSession,
    sendMessage,
    stop,
  } = useAgentChat();
  const { models } = useAgentModels();

  const [input, setInput] = useState("");
  const [modelId, setModelId] = useState<string>("");
  const [thinkingLevel, setThinkingLevel] = useState<string>("");
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [sessionsDrawerOpen, setSessionsDrawerOpen] = useState(false);
  const [desktopHistoryOpen, setDesktopHistoryOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const [desktopWorkspaceOpen, setDesktopWorkspaceOpen] = useState(false);
  const [mobileWorkspaceOpen, setMobileWorkspaceOpen] = useState(false);
  const [workspaceCount, setWorkspaceCount] = useState(0);
  // 工作区树刷新信号：附件上传完成/解析结束时自增，驱动 WorkspacePanel 主动刷新
  const [workspaceRefreshSignal, setWorkspaceRefreshSignal] = useState(0);
  // 移动端无侧板，点工作区文件进全屏预览（桌面预览在 WorkspacePanel 内部自理）
  const [mobilePreview, setMobilePreview] = useState<AgentWorkspaceFile | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentSeq = useRef(0);

  const currentModel = useMemo(
    () => models.find((m) => m.id === modelId) ?? models[0],
    [models, modelId],
  );

  // ----- 附件（D1 临时区 / D2 发送锁 / D15 纯轮询） -----
  const attachmentsLocked = pendingFiles.some(
    (f) => f.status === "uploading" || f.status === "parsing",
  );
  const readyAttachmentMetas: AgentAttachmentMeta[] = pendingFiles
    .filter((f) => f.status === "ready" && f.fileId)
    .map((f) => ({ file_id: f.fileId as string, kind: f.kind, name: f.name, size: f.size }));

  // 会话切换即清空待发送附件（旧附件属于旧会话/临时区，24h 未绑定自动回收）；
  // 工作区面板收起 + 徽标计数随会话刷新；移动端全屏预览一并关闭（文件属于旧会话）
  useEffect(() => {
    setPendingFiles([]);
    setDesktopWorkspaceOpen(false);
    setMobileWorkspaceOpen(false);
    setMobilePreview(null);
    if (sessionId) {
      listAgentSessionFiles(sessionId)
        .then((items) => setWorkspaceCount(items.length))
        .catch(() => setWorkspaceCount(0));
    } else {
      setWorkspaceCount(0);
    }
  }, [sessionId]);

  // ----- 移动端文件全屏预览（桌面预览由 WorkspacePanel 内部标签页承载） -----

  const openMobilePreview = (file: AgentWorkspaceFile) => {
    setMobilePreview(file);
    setMobileWorkspaceOpen(false);
  };

  /** 解析状态轮询回填（ready 后全屏预览自动切解析文本） */
  const updateMobilePreviewMeta = useCallback((fileId: string, meta: AgentWorkspaceFile) => {
    setMobilePreview((p) => (p && p.file_id === fileId ? meta : p));
  }, []);


  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const sid = sessionId; // null = 临时区上传，首条消息时绑定（D1）
    Array.from(files)
      .slice(0, 10)
      .forEach((file) => {
        attachmentSeq.current += 1;
        const localId = `att-${Date.now().toString(36)}-${attachmentSeq.current}`;
        const kind: "file" | "image" = file.type.startsWith("image/") ? "image" : "file";
        setPendingFiles((prev) => [
          ...prev,
          { localId, fileId: null, name: file.name, kind, size: file.size, status: "uploading" },
        ]);
        uploadAgentAttachment(sid, file)
          .then((created) => {
            setPendingFiles((prev) =>
              prev.map((f) =>
                f.localId === localId
                  ? {
                      ...f,
                      fileId: created.file_id,
                      kind: created.kind,
                      size: created.size,
                      status: created.parse_status === "ready" ? "ready" : "parsing",
                    }
                  : f,
              ),
            );
            // 会话内上传：文件已直接入区，刷新徽标 + 工作区树（临时区等发送绑定后再刷）
            if (sid) {
              listAgentSessionFiles(sid)
                .then((items) => setWorkspaceCount(items.length))
                .catch(() => {});
              setWorkspaceRefreshSignal((s) => s + 1);
            }
          })
          .catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            setPendingFiles((prev) =>
              prev.map((f) =>
                f.localId === localId ? { ...f, status: "failed", error: msg } : f,
              ),
            );
          });
      });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePendingAttachment = (item: PendingAttachment) => {
    setPendingFiles((prev) => prev.filter((f) => f.localId !== item.localId));
    if (item.fileId) {
      void deleteAgentAttachment(item.fileId).catch(() => {
        /* 软删失败不打扰：24h 清理任务兜底 */
      });
    }
  };

  // 解析状态轮询（只轮 pending/parsing；有目标才起 interval）
  useEffect(() => {
    const targets = pendingFiles.filter((f) => f.status === "parsing" && f.fileId);
    if (targets.length === 0) return;
    const timer = window.setInterval(() => {
      targets.forEach((f) => {
        fetchAgentFile(f.fileId as string)
          .then((info) => {
            if (info.parse_status === "ready" || info.parse_status === "failed") {
              const next = info.parse_status;
              setPendingFiles((prev) =>
                prev.map((x) =>
                  x.localId === f.localId
                    ? {
                        ...x,
                        status: next,
                        error: info.parse_error ?? undefined,
                      }
                    : x,
                ),
              );
              // 解析结束同步刷工作区树（更新行内"解析中/失败"徽标）
              setWorkspaceRefreshSignal((s) => s + 1);
            }
          })
          .catch(() => {
            /* 下个周期再试 */
          });
      });
    }, 2000);
    return () => window.clearInterval(timer);
  }, [pendingFiles]);

  // 换模型时档位回落：当前档被支持则沿用；否则该模型上次使用的档（记忆与
  // 知识库互通）；再否则回默认档。与知识库 applyModelSelection 的推导一致。
  useEffect(() => {
    if (!currentModel) return;
    setThinkingLevel((prev) => {
      if (prev && currentModel.thinking_levels?.includes(prev)) return prev;
      if (!currentModel.supports_thinking) return "off";
      const remembered = getLastModelLevel(currentModel.id);
      if (remembered && currentModel.thinking_levels?.includes(remembered)) {
        return remembered;
      }
      return (
        currentModel.default_thinking_level ??
        currentModel.thinking_levels?.find((l) => l !== "off") ??
        "off"
      );
    });
  }, [
    currentModel?.id,
    currentModel?.default_thinking_level,
    currentModel?.supports_thinking,
    currentModel?.thinking_levels,
  ]);

  // 消息更新时贴底滚动（用户已滚离底部超过 120px 则不打扰）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isAtBottom) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isAtBottom]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setIsAtBottom(true);
  };

  const submit = () => {
    const text = input.trim();
    // D2：任一附件还在上传/解析 → 锁定发送（失败附件不携带、不阻塞）
    if (!text || busy || connection !== "open" || attachmentsLocked) return;
    sendMessage({
      message: text,
      model: currentModel?.id,
      thinking_level: thinkingLevel || undefined,
      attachments: readyAttachmentMetas.length ? readyAttachmentMetas : undefined,
    });
    // 附件已随 start 帧携带（临时区文件由后端绑定归位），chips 清空；
    // 刷新工作区徽标计数（附件已入区）
    setPendingFiles([]);
    if (readyAttachmentMetas.length > 0 && sessionId) {
      listAgentSessionFiles(sessionId)
        .then((items) => setWorkspaceCount(items.length))
        .catch(() => {});
    }
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setIsAtBottom(true);
  };

  const sendPrompt = (text: string) => {
    if (busy || connection !== "open") return;
    sendMessage({
      message: text,
      model: currentModel?.id,
      thinking_level: thinkingLevel || undefined,
    });
    setIsAtBottom(true);
  };

  // 轮次分组：user 开新轮，其后的一条 assistant 聚合归属该轮
  const turns = useMemo(() => {
    const list: Array<{ user: UiAgentMessage; assistant: UiAgentMessage | null }> = [];
    for (const m of messages) {
      if (m.role === "user") {
        list.push({ user: m, assistant: null });
      } else if (list.length > 0) {
        list[list.length - 1].assistant = m;
      } else {
        // 无 user 前导的 assistant（防御）
        list.push({
          user: { id: `u-${m.id}`, role: "user", text: "", toolCalls: [], segments: [], done: true },
          assistant: m,
        });
      }
    }
    return list;
  }, [messages]);

  const empty = messages.length === 0;
  const connected = connection === "open";
  const activeSession = sessions.find((s) => s.session_id === sessionId) ?? null;

  const commitRename = () => {
    const next = renameValue.trim();
    if (next && sessionId && next !== activeSession?.title) {
      void renameSession(sessionId, next);
    }
    setRenaming(false);
  };

  return (
    <section className="relative flex h-[calc(100dvh-3.5rem)] overflow-hidden bg-white md:h-screen">
      {/* 左侧图标栏 + 可折叠历史面板（lg+，默认隐藏） */}
      <SessionIconRail
        historyOpen={desktopHistoryOpen}
        onToggleHistory={() => setDesktopHistoryOpen((v) => !v)}
        onNew={() => {
          newSession();
          setDesktopHistoryOpen(false);
        }}
      />
      {desktopHistoryOpen ? (
        <SessionDrawer
          sessions={sessions}
          activeSessionId={sessionId}
          onClose={() => setDesktopHistoryOpen(false)}
          onSelect={(id) => {
            setDesktopHistoryOpen(false);
            if (id !== sessionId) void selectSession(id);
          }}
          onRename={(id, title) => void renameSession(id, title)}
          onDelete={(id) => void deleteSession(id)}
        />
      ) : null}

      {/* 移动端 / 中屏抽屉 */}
      <SessionMobileDrawer
        sessions={sessions}
        activeSessionId={sessionId}
        loading={sessionsLoading}
        open={sessionsDrawerOpen}
        onClose={() => setSessionsDrawerOpen(false)}
        onNew={newSession}
        onSelect={(id) => {
          if (id !== sessionId) void selectSession(id);
        }}
        onRename={(id, title) => void renameSession(id, title)}
        onDelete={(id) => void deleteSession(id)}
      />
      <WorkspaceMobileDrawer
        sessionId={sessionId ?? ""}
        open={mobileWorkspaceOpen && Boolean(sessionId)}
        onClose={() => setMobileWorkspaceOpen(false)}
        onCountChange={setWorkspaceCount}
        onOpenFile={openMobilePreview}
      />

      {/* 移动端文件全屏预览（lg 以下点工作区文件进入；返回即回对话） */}
      {mobilePreview ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-white lg:hidden">
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-hairline/70 px-2">
            <button
              type="button"
              onClick={() => setMobilePreview(null)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-gray-100 hover:text-foreground cursor-pointer"
              title="返回"
              aria-label="返回对话"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <span className="min-w-0 truncate text-sm font-medium text-foreground">
              {mobilePreview.name}
            </span>
          </div>
          <FilePreview file={mobilePreview} onMetaUpdate={updateMobilePreviewMeta} />
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {/* 顶部状态栏（对齐知识库：标题双击重命名 + 状态胶囊 + 消息计数） */}
        <div className="relative shrink-0 border-b border-hairline/70 bg-white/95 px-4 py-2.5 backdrop-blur-xs sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {renaming ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) commitRename();
                        if (e.key === "Escape") {
                          setRenaming(false);
                          setRenameValue("");
                        }
                      }}
                      className="min-w-0 rounded-md border border-primary/40 bg-white px-2 py-0.5 text-sm font-medium outline-none focus:ring-1 focus:ring-primary"
                    />
                  ) : (
                    <span
                      className="cursor-pointer truncate text-sm font-semibold text-foreground transition-colors select-none hover:text-primary-deep"
                      title={
                        activeSession?.title
                          ? `${activeSession.title}（双击可重命名）`
                          : "通用智能体"
                      }
                      onDoubleClick={() => {
                        if (activeSession) {
                          setRenameValue(activeSession.title || "");
                          setRenaming(true);
                        }
                      }}
                    >
                      {activeSession?.title || "通用智能体"}
                    </span>
                  )}
                  <AgentPhasePill busy={busy} connection={connection} />
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-subtle">
                  <span className="truncate">
                    {activeSession?.model
                      ? `模型 ${activeSession.model.split("/").pop()}`
                      : "知识检索 · 联网搜索 · 沙箱执行"}
                  </span>
                  {activeSession ? (
                    <span className="shrink-0 text-muted-faint">
                      · {activeSession.message_count ?? 0} 条消息
                    </span>
                  ) : null}

                </div>
              </div>
            </div>

            {/* 工作区开关（右侧侧板入口；徽标=会话文件数） */}
            <button
              type="button"
              onClick={() => setDesktopWorkspaceOpen((v) => !v)}
              disabled={!sessionId}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
                !sessionId
                  ? "cursor-not-allowed border-hairline bg-white text-muted-subtle opacity-50"
                  : desktopWorkspaceOpen
                    ? "border-primary/40 bg-primary/5 text-primary cursor-pointer"
                    : "border-hairline bg-white text-muted hover:border-primary/40 hover:text-primary cursor-pointer",
              )}
              title={sessionId ? "会话工作区（附件与执行产物）" : "发送首条消息后可用"}
              aria-label="打开会话工作区"
            >
              <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">工作区</span>
              {workspaceCount > 0 ? (
                <span className="ml-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary-deep">
                  {workspaceCount}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        {/* 预览标签条已移除：文件预览归宿在工作区面板内部（Cursor 分区语义） */}
        {/* 消息流：scroll 层外包一层不滚动的 relative 壳，悬浮胶囊锚它
            （知识库同构；此前胶囊挂在滚动容器自身上，会随内容滚走） */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            <div
              className={cn(
                CHAT_CONTENT_CLASS,
                "flex min-h-full flex-col px-4 py-6 sm:px-6",
              )}
            >
              {/* 加载历史消息中先出加载态，不闪欢迎页（与知识库一致）；
                  sessionsLoading 一并计入：初始进入时尚不知是否有会话要恢复 */}
              {(sessionsLoading || historyLoading) && empty ? (
                <div className="flex items-center justify-center py-10 text-xs text-muted">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  加载历史消息…
                </div>
              ) : empty ? (
                <WelcomeGuide onSelectPrompt={sendPrompt} />
              ) : (
                turns.map((t, i) => (
                  <ChatTurnBlock
                    key={t.user.id}
                    userMessage={t.user}
                    assistant={t.assistant}
                    isLastTurn={i === turns.length - 1}
                  />
                ))
              )}
            </div>
          </div>

          {/* 智能置底悬浮胶囊（挂不滚动的外壳，不随内容上下移动） */}
          {!isAtBottom && !empty ? (
            <div className="absolute bottom-3 right-6 z-20 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <button
                type="button"
                onClick={scrollToBottom}
                className="group inline-flex items-center gap-1.5 rounded-full border border-hairline bg-white/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-md backdrop-blur-sm transition-all hover:border-primary/40 hover:text-primary-deep cursor-pointer"
                title="滚动到底部"
                aria-label="滚动到底部"
              >
                {busy ? (
                  <>
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                    <span className="font-medium text-primary-deep">生成中</span>
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
          ) : null}
        </div>

        {/* 输入区：悬浮 composer（圆角大输入框 + 下沿模型选择与发送） */}
        <div className="shrink-0">
          <div className={cn(COMPOSER_CONTENT_CLASS, "px-3 pb-3 pt-2 sm:px-5 sm:pb-4")}>
            {lastError ? (
              <div className="mb-2 rounded-xl border border-red-100 bg-red-50/80 px-3 py-2 text-xs leading-5 text-red-600">
                {lastError}
              </div>
            ) : null}

            <div className="rounded-2xl border border-hairline bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all hover:border-gray-300/80 focus-within:border-primary focus-within:shadow-[0_4px_12px_rgba(0,0,0,0.06)] focus-within:ring-2 focus-within:ring-primary/15">
              {pendingFiles.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 px-3 pb-1 pt-3">
                  {pendingFiles.map((f) => (
                    <PendingAttachmentChip
                      key={f.localId}
                      item={f}
                      onRemove={() => removePendingAttachment(f)}
                    />
                  ))}
                </div>
              ) : null}
              <textarea
                ref={textareaRef}
                value={input}
                rows={1}
                placeholder={
                  attachmentsLocked
                    ? "附件解析中，完成后即可发送…"
                    : connected
                      ? "输入问题，Enter 发送，Shift+Enter 换行"
                      : "正在连接服务…"
                }
                disabled={!connected}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                className="block max-h-[200px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[14.5px] leading-relaxed text-foreground outline-none placeholder:text-muted-faint disabled:cursor-not-allowed"
              />

              <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1">
                <div className="flex min-w-0 items-center gap-2">
                  {/* 中屏/移动：历史会话入口（lg+ 为图标栏） */}
                  <button
                    type="button"
                    onClick={() => setSessionsDrawerOpen(true)}
                    className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-white px-2.5 text-xs text-muted transition-colors hover:border-primary/40 hover:text-primary cursor-pointer lg:hidden"
                    title="历史会话"
                    aria-label="打开历史会话"
                  >
                    <History className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>会话</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMobileWorkspaceOpen(true)}
                    disabled={!sessionId}
                    className={cn(
                      "flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-white px-2.5 text-xs transition-colors lg:hidden",
                      sessionId
                        ? "text-muted hover:border-primary/40 hover:text-primary cursor-pointer"
                        : "text-muted-subtle opacity-50 cursor-not-allowed",
                    )}
                    title={sessionId ? "会话工作区（附件与执行产物）" : "发送首条消息后可用"}
                    aria-label="打开会话工作区"
                  >
                    <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>工作区</span>
                    {workspaceCount > 0 ? (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary-deep">
                        {workspaceCount}
                      </span>
                    ) : null}
                  </button>
                  {messages.length > 0 ? (
                    <button
                      type="button"
                      onClick={newSession}
                      disabled={busy}
                      className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-white px-2.5 text-xs text-muted transition-colors hover:border-primary/40 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                      title="开启新对话（当前会话保留在历史列表）"
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="hidden sm:inline">新对话</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!connected || busy}
                    className={cn(
                      "flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-hairline bg-white px-2.5 text-xs transition-colors cursor-pointer",
                      connected && !busy
                        ? "text-muted hover:border-primary/40 hover:text-primary"
                        : "text-muted-subtle cursor-not-allowed opacity-50",
                    )}
                    title="上传附件（文档自动解析，数据/图片直接可用）"
                    aria-label="上传附件"
                  >
                    <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">附件</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      handleFilesSelected(e.target.files);
                    }}
                  />
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {/* 缓存命中小圈 + 上下文规模（ZCode 式对话栏指示器） */}
                  <ComposerContextWidget
                    usages={messages.map((m) => m.usage)}
                    maxContext={currentModel?.max_context ?? undefined}
                  />
                  <UnifiedModelPicker
                    modelId={currentModel?.id ?? ""}
                    thinkingLevel={thinkingLevel}
                    models={models}
                    disabled={!connected}
                    onModelChange={setModelId}
                    onThinkingLevelChange={setThinkingLevel}
                  />
                  {busy ? (
                    <button
                      type="button"
                      onClick={stop}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow-xs transition-all hover:bg-red-600 active:scale-95 animate-pulse cursor-pointer sm:h-7 sm:w-7"
                      title="停止生成"
                      aria-label="停止生成"
                    >
                      <CircleStop className="h-3.5 w-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={submit}
                      disabled={!input.trim() || !connected || attachmentsLocked}
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all sm:h-7 sm:w-7",
                        !input.trim() || !connected || attachmentsLocked
                          ? "cursor-not-allowed bg-gray-100 text-muted-subtle"
                          : "bg-primary text-white shadow-xs hover:bg-primary-deep active:scale-95 cursor-pointer",
                      )}
                      title={attachmentsLocked ? "附件解析中，完成后自动解锁" : "发送（Enter）"}
                      aria-label="发送"
                    >
                      <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <p className="mt-2 text-center text-[11px] text-muted-subtle">
              内容由 AI 生成，请注意甄别；代码在隔离沙箱中执行。
            </p>
          </div>
        </div>
      </div>

      {/* 右侧工作区侧板（lg+；文件列表与预览标签页都在面板内，与对话区分区） */}
      {desktopWorkspaceOpen && sessionId ? (
        <WorkspacePanel
          sessionId={sessionId}
          onClose={() => setDesktopWorkspaceOpen(false)}
          onCountChange={setWorkspaceCount}
          refreshSignal={workspaceRefreshSignal}
        />
      ) : null}
    </section>
  );
}

