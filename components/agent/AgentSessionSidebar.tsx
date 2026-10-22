"use client";

/**
 * 通用 Agent 会话侧栏 —— 布局与交互对齐 KnowledgeChatPanel 的会话区：
 * - 桌面(lg+)：SessionIconRail(w-11 图标栏：新建/历史) + 可折叠 SessionDrawer（默认隐藏）
 * - 中屏/移动：由父组件以移动抽屉形式挂载（mobileOpen）
 * - SessionRow：active 高亮(primary/10 + 标题 primary)、副行「N 条 · 时间」、
 *   hover 内联重命名/删除；SessionList 默认 5 条 + 「展开全部」
 */

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Trash2,
  X,
  FolderOpen,
} from "lucide-react";

import type { AgentSessionInfo } from "@/lib/agent-chat-types";
import { cn } from "@/lib/utils";

const SESSION_DEFAULT_VISIBLE = 5;

/** 相对时间：今天 HH:mm，今年 M/D，更早 YYYY-M-D */
function formatSessionTime(iso?: string | null): string {
  if (!iso) return "新建";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "新建";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function SessionRow({
  session,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  session: AgentSessionInfo;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(session.title);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, session.title]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== session.title) onRename(next);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 rounded-lg bg-white px-2 py-1.5 ring-1 ring-primary/40">
        <input
          ref={inputRef}
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] leading-5 text-foreground outline-none"
        />
        <button
          type="button"
          onClick={commit}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-primary hover:bg-primary/10 cursor-pointer"
          title="确认"
          aria-label="确认重命名"
        >
          <Check className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-gray-100 cursor-pointer"
          title="取消"
          aria-label="取消重命名"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

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
        className="flex min-w-0 flex-1 flex-col text-left cursor-pointer"
        title={session.title || "新会话"}
      >
        <span
          className={cn(
            "flex items-center gap-1 truncate text-[12.5px] leading-5",
            active ? "text-primary" : "text-foreground",
          )}
        >
          <span className="truncate">{session.title || "新会话"}</span>
        </span>
        <span className="mt-0.5 truncate text-[10.5px] leading-4 text-muted">
          {session.message_count ?? 0} 条 · {formatSessionTime(session.last_message_at)}
        </span>
      </button>

      {/* hover 时直接出现编辑 / 删除两个图标 */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-gray-200 hover:text-foreground cursor-pointer"
          title="重命名"
          aria-label="重命名会话"
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`删除会话「${session.title}」？`)) onDelete();
          }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-red-50 hover:text-red-600 cursor-pointer"
          title="删除"
          aria-label="删除会话"
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
}: {
  sessions: AgentSessionInfo[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sessions : sessions.slice(0, SESSION_DEFAULT_VISIBLE);
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
          onRename={(title) => onRename(s.session_id, title)}
          onDelete={() => onDelete(s.session_id)}
        />
      ))}
      {sessions.length > SESSION_DEFAULT_VISIBLE ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-primary hover:bg-primary/5 cursor-pointer"
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

/** 桌面图标栏（lg+）：新建 + 历史开关（历史面板默认隐藏，对齐知识库；
 *  工作区面板在右侧，入口在顶栏右端） */
export function SessionIconRail({
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
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white hover:text-primary cursor-pointer"
        title="新建会话"
        aria-label="新建会话"
      >
        <MessageSquarePlus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onToggleHistory}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg transition-colors cursor-pointer",
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

/** 桌面历史面板（图标栏开关控制，w-60，对齐知识库 SessionDrawer） */
export function SessionDrawer({
  sessions,
  activeSessionId,
  onClose,
  onSelect,
  onRename,
  onDelete,
}: {
  sessions: AgentSessionInfo[];
  activeSessionId: string | null;
  onClose: () => void;
  onSelect: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
}) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-gray-50/60 lg:flex">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-xs font-medium text-foreground">历史会话</span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-gray-100 hover:text-foreground cursor-pointer"
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

/** 移动端 / 中屏抽屉 */
export function SessionMobileDrawer({
  sessions,
  activeSessionId,
  loading,
  open,
  onClose,
  onNew,
  onSelect,
  onRename,
  onDelete,
}: {
  sessions: AgentSessionInfo[];
  activeSessionId: string | null;
  loading: boolean;
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onSelect: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="absolute inset-y-0 left-0 flex w-[78%] max-w-xs flex-col bg-gray-50 shadow-2xl animate-in slide-in-from-left duration-200">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-xs font-medium text-foreground">历史会话</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onNew();
                onClose();
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 text-foreground hover:border-primary cursor-pointer"
              title="新建会话"
              aria-label="新建会话"
            >
              <MessageSquarePlus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted hover:bg-gray-100 hover:text-foreground cursor-pointer"
              title="关闭"
              aria-label="关闭历史会话"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto pb-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              加载会话中…
            </div>
          ) : (
            <SessionList
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelect={(id) => {
                onSelect(id);
                onClose();
              }}
              onRename={onRename}
              onDelete={onDelete}
            />
          )}
        </div>
      </aside>
    </div>
  );
}
