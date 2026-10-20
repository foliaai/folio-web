"use client";

/**
 * 知识库对话主 Hook：把 REST + WebSocket 的细节收敛在一处。
 *
 * 责任：
 *   1. 按 (knowledge_base_id) 维度 ensureSession / 列出该 KB 的会话
 *   2. 切换 active session 时通过 REST 回放历史消息
 *   3. 发送 query 时建/复用 WebSocket，按 §4.3 事件类型累积流式状态
 *   4. Stop / 错误 / 断线 / 首轮异步起标题等边界处理
 *
 * 不做的事：UI 渲染、Markdown 解析、滚动控制等都交给 KnowledgeChatPanel。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatStreamHandle,
  clearChatMessages,
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatMessages,
  listChatSessions,
  openChatStream,
  renameChatSession,
  summarizeChatContext,
  fetchContextStatus,
} from "@/lib/api/chat";
import { getAuthToken } from "@/lib/auth";
import { handleAuthExpired, isTokenExpired } from "@/lib/auth-expired";
import {
  getSettingsDefaultModel,
  getSettingsEnableRoutePlan,
} from "@/lib/chat/chat-preferences";
import type {
  ChatMention,
  ChatMessage,
  ChatRequestPayload,
  ChatSessionInfo,
  Citation,
  RetrievalChunkPreview,
  ServerFrame,
  ToolCallRecord,
  UiChatMessage,
  UiToolCall,
  ChatPhase,
  ContextStatusReport,
} from "@/lib/chat-types";

const PAGE_SIZE = 50;
const TITLE_POLL_DELAYS_MS = [1500, 4000, 9000];
const ACTIVE_SESSION_STORAGE_PREFIX = "knowledge_chat_active_session";

function activeSessionStorageKey(
  kbId: string,
  folderId: string | null
): string {
  return `${ACTIVE_SESSION_STORAGE_PREFIX}:${kbId}:${folderId ?? "__kb__"}`;
}

function loadPersistedSessionId(
  kbId: string,
  folderId: string | null
): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(activeSessionStorageKey(kbId, folderId));
  } catch {
    return null;
  }
}

function persistActiveSessionId(
  kbId: string,
  folderId: string | null,
  sessionId: string
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(activeSessionStorageKey(kbId, folderId), sessionId);
  } catch {
    // localStorage 不可用时忽略
  }
}

export interface UseKnowledgeChatOptions {
  knowledgeBaseId: string | null;
  /** 用户登录态（未登录时不做任何后端调用） */
  enabled: boolean;
  /**
   * 当前用户通过文件夹「对话」按钮进入的文件夹 ID（v0.8.0 文件夹问答）。
   *
   * 切换 folder / KB 时会自动加载对应 scope 的 session 列表并恢复最近一条
   * 对话历史；不同 folder 的 session 列表彼此独立。
   *
   * 不传 / `null` → KB scope（folder_id IS NULL 的会话）。
   */
  folderId?: string | null;
  /**
   * 文件夹的可读名（仅用于 UI 提示文案）；hook 不会拿它做任何业务判断。
   */
  folderName?: string | null;
  /**
   * folder 模式下是否含子文件夹的文档；默认 true。仅作为新会话默认值。
   */
  includeSubfolders?: boolean;
}

/**
 * 新建会话时可选的初始偏好。所有字段均为 optional：缺省时由后端默认值决定。
 *
 * 模型应传设置页默认项（`pickSettingsDefaultModel`），不要沿用当前 chip。
 */
export interface NewSessionInit {
  modelPreset?: string;
  model?: string | null;
  /** 思考强度档位（off/minimal/low/medium/high/xhigh/max）；默认 off */
  thinkingLevel?: string;
  enableMultimodal?: boolean;
  /** 会话交互模式（agent / plan 等）；默认 agent */
  mode?: string;
  /**
   * 把新会话锁定在此文件夹内（folder scope，v0.8.0）。
   * 不传 → 走 hook 入参 `folderId`；显式传 `null` → 强制 KB scope，忽略 hook 入参。
   */
  folderId?: string | null;
  /** folder 模式是否递归含子文件夹；不传时沿用 hook 入参 `includeSubfolders` */
  includeSubfolders?: boolean;
}

export interface SendOptions {
  /** 覆盖 session 默认 mode */
  mode?: string;
  /** 覆盖 session 默认 thinking_level（pi 标准 7 档之一） */
  thinkingLevel?: string;
  /** 覆盖 session 默认 enable_multimodal */
  enableMultimodal?: boolean;
  /** 覆盖 session 默认 model_preset（采样参数模板，如 "fast" / "deep_thinking"） */
  modelPreset?: string;
  /**
   * 用户从 `/api/chat/models` 选定的 LiteLLM 模型字符串（如 `openai/gpt-4o-mini`）。
   *
   * 与 modelPreset 的关系：
   * - 优先级高于 modelPreset：传了 model 时，model 决定具体模型，
   *   modelPreset 仅作为 temperature / max_tokens / thinking_budget 等
   *   采样参数的模板。
   * - 不传或传空字符串 → 沿用 session 当前的 model（或 model_preset）。
   *   modelPreset 仅作为 temperature / max_tokens 等采样参数的模板（思考强度由 thinking_level 逐轮传入）。
   */
  model?: string;
  /** 覆盖 session 默认 retrieve_top_k */
  retrieveTopK?: number;
  /** 跳过服务端无条件初次召回（仅特殊场景使用） */
  skipRetrieval?: boolean;
  /** 是否启用智能路由规划（LLM₁）；未传则读取偏好设置 */
  enableRoutePlan?: boolean;
  /** Slash 显式召唤的技能名列表（后端注入当轮 user turn，非 system prompt） */
  forcedSkillNames?: string[];
  /**
   * Cursor 式 @ 内联引用（软引用，可多个，文件/目录混选）。
   * 后端解析为「引用资料」块（小文件全量注入 / 大文件与目录仅提示 document_id），不锁死 scope。
   */
  mentions?: ChatMention[];
  /**
   * 请求级临时覆盖 folder scope（@ 目录）；不传 → 沿用 session.folder_id。
   */
  folderId?: string | null;
  /** 请求级临时覆盖 include_subfolders；不传 → 沿用 session 默认 */
  includeSubfolders?: boolean;
}

export interface UseKnowledgeChatResult {
  sessions: ChatSessionInfo[];
  activeSession: ChatSessionInfo | null;
  activeSessionId: string | null;
  messages: UiChatMessage[];
  phase: ChatPhase;
  /** 最近一次错误（致命/非致命都会写） */
  lastError: string | null;
  /** 当前轮是否在流式中（与 phase=running 等价，便于 UI 判断） */
  isStreaming: boolean;
  /** 加载会话/历史消息中 */
  isLoading: boolean;
  /** 正在总结上下文（POST /summarize 进行中） */
  summarizing: boolean;
  /** 当前会话是否已有上下文总结消息（后端 role=summary） */
  hasSummary: boolean;
  /** 当前会话上下文用量（后端计量；无会话时为 null） */
  contextStatus: ContextStatusReport | null;
  /** 主动刷新上下文用量 */
  refreshContextStatus: () => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  newSession: (init?: NewSessionInit) => Promise<void>;
  renameActive: (title: string) => Promise<void>;
  deleteActive: () => Promise<void>;
  /** 清空当前会话消息（保留会话本身） */
  clearMessages: () => Promise<void>;
  /** 触发后端上下文总结并刷新消息列表 */
  summarizeContext: () => Promise<void>;
  send: (query: string, opts?: SendOptions) => Promise<void>;
  stop: () => void;
  /** 中断正在进行的上下文总结 */
  stopSummarize: () => void;
  /** 主动关连接（一般在卸载时） */
  disconnect: () => void;
  /** 重置错误 chip */
  clearError: () => void;
}

function fromBackendMessage(message: ChatMessage): UiChatMessage {
  const meta = message.metadata as Record<string, unknown> | undefined;
  const retrievalMeta = meta?.retrieval as
    | {
        hit_count?: number;
        time_ms?: number;
        chunks?: RetrievalChunkPreview[];
        error?: string;
        params?: Record<string, unknown>;
      }
    | undefined;

  return {
    id: message.message_id,
    role: message.role,
    content: message.content ?? "",
    thinking: message.thinking ?? undefined,
    thinking_ms:
      typeof message.thinking_ms === "number" ? message.thinking_ms : undefined,
    tool_calls: message.tool_calls ?? [],
    citations: message.citations ?? [],
    usage: message.usage ?? undefined,
    finish_reason: message.finish_reason ?? null,
    created_at: message.create_time,
    ...(retrievalMeta
      ? {
          retrieval: {
            state: retrievalMeta.error
              ? ("failed" as const)
              : ("done" as const),
            hit_count: retrievalMeta.hit_count,
            time_ms: retrievalMeta.time_ms,
            chunks: retrievalMeta.chunks,
            error: retrievalMeta.error,
            params: retrievalMeta.params,
          },
        }
      : {}),
  };
}

function stampThinkingStart(m: UiChatMessage): UiChatMessage {
  if (m.thinking_started_at != null) return m;
  return { ...m, thinking_started_at: Date.now() };
}

function finalizeThinkingMs(m: UiChatMessage): UiChatMessage {
  if (m.thinking_ms != null || m.thinking_started_at == null) return m;
  return { ...m, thinking_ms: Math.max(0, Date.now() - m.thinking_started_at) };
}

function makeLocalId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useKnowledgeChat(
  options: UseKnowledgeChatOptions
): UseKnowledgeChatResult {
  const {
    knowledgeBaseId,
    enabled,
    folderId: optionFolderId = null,
    includeSubfolders: optionIncludeSubfolders = true,
  } = options;

  const [sessions, setSessions] = useState<ChatSessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiChatMessage[]>([]);
  const [hasSummary, setHasSummary] = useState(false);
  const [contextStatus, setContextStatus] = useState<ContextStatusReport | null>(null);
  const [phase, setPhase] = useState<ChatPhase>("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // ---- 持久 refs（不触发 re-render） ----
  const wsRef = useRef<ChatStreamHandle | null>(null);
  /** 当 ready 帧到达后调用 */
  const pendingStartRef = useRef<ChatRequestPayload | null>(null);
  /** 当前轮临时 assistant 消息 id，便于 message.done 时定位 */
  const inflightAssistantIdRef = useRef<string | null>(null);
  /**
   * 最近一次完成 LLM 流的 assistant 消息 id（保持到 turn.done 才清）。
   *
   * 后端事件顺序是：tool_call.started/args_delta → message.done(round N) →
   * tool_call.completed → tool_round.done → 下一轮 content.delta …
   *
   * `message.done` 会清掉 `inflightAssistantIdRef`，但其后到达的
   * `tool_call.completed` 仍然属于刚结束流的那条 assistant 消息——必须靠这个
   * "上一条 assistant 消息 id" 兜底，否则工具结果就被丢了，等到刷新走历史
   * 回放才会出现。
   */
  const lastAssistantIdRef = useRef<string | null>(null);
  /** 当前轮临时 user 消息 id（挂检索状态） */
  const inflightUserIdRef = useRef<string | null>(null);
  /** 当前轮的 tool_call 累积器：index → 累积 */
  const inflightToolCallsRef = useRef<Map<number, UiToolCall>>(new Map());
  /** 当前轮 round 0 / round 1 ... 区分主流程进度 */
  const currentRoundRef = useRef<number>(0);
  /**
   * 方案 B 核心：turn 级 citations 累积器（chunk_id → Citation）。
   *
   * - retrieval.done 帧到达时立即用种子 chunks 填充本 ref，让 LLM 一吐出
   *   [chunk-xxx] 就能从这里查到完整渲染信息（彩色 chip + hover preview）。
   * - 后续 message.done 帧带的本轮完整 citations 会覆盖到 ref（含工具补充）。
   * - ensureInflightAssistant 创建临时 assistant 时把 ref 当前快照作为初始
   *   citations，使流式渲染期间 markdown 拦截器能立即命中。
   * - turn.done / resetInflight 时清空。
   */
  const turnCitationsRef = useRef<Map<string, Citation>>(new Map());
  /** 起标题轮询用 */
  const titleTimersRef = useRef<number[]>([]);
  /** 当前活跃 session id 的 ref 副本，便于 close handler 里读取最新值 */
  const activeSessionIdRef = useRef<string | null>(null);

  // 同步 ref
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // -------------------------------------------------------------------------
  // 内部工具：清理一切轮内累积态
  // -------------------------------------------------------------------------
  const resetInflight = useCallback(() => {
    inflightAssistantIdRef.current = null;
    lastAssistantIdRef.current = null;
    inflightUserIdRef.current = null;
    inflightToolCallsRef.current = new Map();
    currentRoundRef.current = 0;
    turnCitationsRef.current = new Map();
  }, []);

  const clearTitleTimers = useCallback(() => {
    titleTimersRef.current.forEach((id) => window.clearTimeout(id));
    titleTimersRef.current = [];
  }, []);

  // -------------------------------------------------------------------------
  // 历史会话加载（按 KB + scope 过滤）
  // -------------------------------------------------------------------------
  const loadSessionsForScope = useCallback(
    async (
      kbId: string,
      folderId: string | null
    ): Promise<ChatSessionInfo[]> => {
      const list = await listChatSessions({
        page: 1,
        page_size: 100,
        knowledge_base_id: kbId,
        scope: folderId ? "folder" : "kb",
        ...(folderId ? { folder_id: folderId } : {}),
      });
      const items = list.items ?? [];
      setSessions(items);
      return items;
    },
    []
  );

  /** 构造 createChatSession 的 scope 字段（folder / KB 二选一） */
  const buildScopeFields = useCallback(
    (folderId: string | null) =>
      folderId
        ? {
            folder_id: folderId,
            include_subfolders: optionIncludeSubfolders,
          }
        : {},
    [optionIncludeSubfolders]
  );

  const loadMessagesForSession = useCallback(async (sessionId: string) => {
    // UI 全量回放：按时间正序翻页拉完；LLM 上下文装配另走后端最近 N 条，不在此截断
    const allItems: Awaited<ReturnType<typeof listChatMessages>>["items"] = [];
    let page = 1;
    let total = Number.POSITIVE_INFINITY;
    while (allItems.length < total) {
      const data = await listChatMessages(sessionId, {
        page,
        page_size: PAGE_SIZE,
      });
      total = data.total ?? 0;
      const items = data.items ?? [];
      if (items.length === 0) break;
      allItems.push(...items);
      page += 1;
      // 防御：避免异常 total 导致死循环
      if (page > 1000) break;
    }
    // 检测是否有 summary 消息
    const hasSummaryMsg = allItems.some((m) => m.role === "summary");
    setHasSummary(hasSummaryMsg);
    // tool/system 不参与 UI 时间线；summary 是持久化的上下文压缩事件，
    // 必须保留，以便刷新后仍在其原始时间位置显示完成状态。
    const ui = allItems
      .filter((m) => m.role !== "tool" && m.role !== "system")
      .map(fromBackendMessage);
    setMessages(ui);
  }, []);

  // -------------------------------------------------------------------------
  // ensureSession：当前 scope 没有可用 session 就建一条
  // -------------------------------------------------------------------------
  const ensureSession = useCallback(
    async (
      kbId: string,
      folderId: string | null
    ): Promise<ChatSessionInfo> => {
      const existing = await loadSessionsForScope(kbId, folderId);
      if (existing.length > 0) {
        const persistedId = loadPersistedSessionId(kbId, folderId);
        const target =
          (persistedId
            ? existing.find((s) => s.session_id === persistedId)
            : undefined) ?? existing[0];
        setActiveSessionId(target.session_id);
        persistActiveSessionId(kbId, folderId, target.session_id);
        await loadMessagesForSession(target.session_id);
        return target;
      }
      const defaultModel = getSettingsDefaultModel();
      const created = await createChatSession({
        knowledge_base_ids: [kbId],
        title: "新会话",
        ...buildScopeFields(folderId),
        ...(defaultModel ? { model: defaultModel } : {}),
      });
      setSessions([created]);
      setActiveSessionId(created.session_id);
      persistActiveSessionId(kbId, folderId, created.session_id);
      setMessages([]);
      return created;
    },
    [buildScopeFields, loadMessagesForSession, loadSessionsForScope]
  );

  // -------------------------------------------------------------------------
  // KB / folder 切换 → 重新装载对应 scope 的 session 列表 + 对话历史
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!enabled || !knowledgeBaseId) {
      setSessions([]);
      setActiveSessionId(null);
      setMessages([]);
      setPhase("idle");
      setLastError(null);
      return;
    }

    let cancelled = false;
    // 切换 scope 时先清空，避免短暂展示上一个 folder/KB 的消息
    setSessions([]);
    setActiveSessionId(null);
    setMessages([]);
    setIsLoading(true);
    setLastError(null);

    void (async () => {
      try {
        await ensureSession(knowledgeBaseId, optionFolderId);
        if (!cancelled) {
          setPhase("idle");
        }
      } catch (error) {
        if (!cancelled) {
          setLastError(
            error instanceof Error ? error.message : "加载会话失败"
          );
          setPhase("error");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [knowledgeBaseId, optionFolderId, enabled, ensureSession]);

  // -------------------------------------------------------------------------
  // WebSocket 帧分发
  // -------------------------------------------------------------------------
  const handleFrame = useCallback(
    (frame: ServerFrame) => {
      switch (frame.type) {
        case "ready": {
          // 收到 ready 后立即把 pending 的 start 发出
          const pending = pendingStartRef.current;
          pendingStartRef.current = null;
          if (pending && wsRef.current) {
            setPhase("running");
            wsRef.current.start(pending);
          } else {
            setPhase("ready");
          }
          break;
        }

        case "pong": {
          break;
        }

        case "session.ready": {
          // 后端确认 user 消息已落库；这里只是状态提示
          break;
        }

        case "retrieval.started": {
          const userId = inflightUserIdRef.current;
          if (!userId) break;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === userId
                ? { ...m, retrieval: { state: "started" } }
                : m
            )
          );
          break;
        }

        case "tool.progress": {
          const toolCallId = frame.data.tool_call_id;
          if (!toolCallId) break;
          const targetId =
            inflightAssistantIdRef.current ?? lastAssistantIdRef.current;
          if (!targetId) break;
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== targetId) return m;
              return {
                ...m,
                tool_calls: m.tool_calls.map((t) =>
                  t.id === toolCallId
                    ? {
                        ...t,
                        execution_stage: frame.data.stage,
                        execution_model:
                          frame.data.model ?? t.execution_model ?? null,
                      }
                    : t
                ),
              };
            })
          );
          break;
        }

        case "retrieval.progress": {
          // 检索工具进度：关联到 tool_call（通过 tool_call_id）
          const toolCallId = frame.data.tool_call_id;
          if (toolCallId) {
            // 更新对应 tool_call 的 retrieval_progress
            const targetId = inflightAssistantIdRef.current ?? lastAssistantIdRef.current;
            if (targetId) {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== targetId) return m;
                  return {
                    ...m,
                    tool_calls: m.tool_calls.map((t) =>
                      t.id === toolCallId
                        ? { ...t, retrieval_progress: frame.data.stage }
                        : t
                    ),
                  };
                })
              );
            }
          } else {
            // 兼容旧路径：关联到 user 消息的 retrieval 状态
            const userId = inflightUserIdRef.current;
            if (!userId) break;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === userId
                  ? { ...m, retrieval: { state: "started", stage: frame.data.stage } }
                  : m
              )
            );
          }
          break;
        }

        case "retrieval.done": {
          const userId = inflightUserIdRef.current;
          const { hit_count, time_ms, chunks, params } = frame.data;
          const previewChunks = chunks as RetrievalChunkPreview[];

          // 方案 B：把种子 chunks 提前进入 turn 级 citations 缓存。
          // ensureInflightAssistant 创建临时 assistant 时会把这些种子作为初始
          // citations 挂上，使 content.delta 流到 [chunk-xxx] 时能立即彩色渲染。
          for (const c of previewChunks) {
            if (!c.chunk_id) continue;
            const cite: Citation = {
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
              // Phase B：alias 提前下发，使流式期间 [cN] chip 能即时彩色渲染。
              alias: c.alias ?? null,
              // 图片 chunk 专用：存储路径，用于按需请求 presigned URL
              image_file_path: c.image_file_path ?? null,
              bucket_name: c.bucket_name ?? null,
            };
            turnCitationsRef.current.set(c.chunk_id, cite);
          }

          if (userId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === userId
                  ? {
                      ...m,
                      retrieval: {
                        state: "done",
                        hit_count,
                        time_ms,
                        chunks: previewChunks,
                        params: params as Record<string, unknown> | undefined,
                      },
                    }
                  : m
              )
            );
          }
          break;
        }

        case "thinking.delta": {
          const id = inflightAssistantIdRef.current;
          if (!id) break;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id
                ? stampThinkingStart({
                    ...m,
                    thinking: (m.thinking ?? "") + frame.data.text,
                  })
                : m
            )
          );
          break;
        }

        case "content.delta": {
          const id = inflightAssistantIdRef.current;
          if (!id) break;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id
                ? finalizeThinkingMs({
                    ...m,
                    content: m.content + frame.data.text,
                  })
                : m
            )
          );
          break;
        }

        case "tool_call.started": {
          // 累积到 ref（用于按 index 找回 args 增量）
          const buf = new Map(inflightToolCallsRef.current);
          buf.set(frame.data.index, {
            index: frame.data.index,
            id: frame.data.id,
            name: frame.data.name,
            argsText: "",
            completed: false,
          });
          inflightToolCallsRef.current = buf;

          // 同时立刻往当前 assistant 消息上 push 一条"进行中"占位卡片，
          // 让前端立刻显示蓝色框（之前只在 completed 才 push，
          // 导致整个工具运行期间都看不到任何痕迹）。
          const targetId =
            inflightAssistantIdRef.current ?? lastAssistantIdRef.current;
          if (!targetId) break;
          const placeholder: ToolCallRecord = {
            id: frame.data.id,
            name: frame.data.name,
            arguments: {},
            result_brief: null,
            items_added: 0,
            inflight: true,
            argsText: "",
            index: frame.data.index,
          };
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== targetId) return m;
              const doneThinking = finalizeThinkingMs(m);
              const dup = doneThinking.tool_calls.some(
                (t) => t.id === placeholder.id || t.index === placeholder.index
              );
              return dup
                ? doneThinking
                : {
                    ...doneThinking,
                    tool_calls: [...doneThinking.tool_calls, placeholder],
                  };
            })
          );
          break;
        }

        case "tool_call.args_delta": {
          // 维护 ref 累积
          const buf = new Map(inflightToolCallsRef.current);
          const existing = buf.get(frame.data.index) ?? {
            index: frame.data.index,
            argsText: "",
            completed: false,
          };
          const merged = {
            ...existing,
            argsText: existing.argsText + frame.data.text,
          };
          buf.set(frame.data.index, merged);
          inflightToolCallsRef.current = buf;

          // 同步把累积的 argsText（以及尝试性 JSON.parse 后的 arguments）
          // 反映到消息上的占位卡片，UI 即时刷新
          const targetId =
            inflightAssistantIdRef.current ?? lastAssistantIdRef.current;
          if (!targetId) break;
          let parsedArgs: Record<string, unknown> | null = null;
          try {
            parsedArgs = JSON.parse(merged.argsText);
          } catch {
            parsedArgs = null;
          }
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== targetId) return m;
              return {
                ...m,
                tool_calls: m.tool_calls.map((t) =>
                  t.index === frame.data.index
                    ? {
                        ...t,
                        argsText: merged.argsText,
                        arguments:
                          parsedArgs && typeof parsedArgs === "object"
                            ? parsedArgs
                            : t.arguments,
                      }
                    : t
                ),
              };
            })
          );
          break;
        }

        case "tool_call.completed": {
          // 维护 ref（保持原有兼容）
          const buf = new Map(inflightToolCallsRef.current);
          let matchedIndex: number | null = null;
          for (const [idx, tc] of buf.entries()) {
            if (tc.id === frame.data.id) {
              matchedIndex = idx;
              break;
            }
          }
          if (matchedIndex === null) {
            for (const [idx, tc] of buf.entries()) {
              if (!tc.completed) {
                matchedIndex = idx;
                break;
              }
            }
          }
          if (matchedIndex !== null) {
            const existing = buf.get(matchedIndex)!;
            buf.set(matchedIndex, {
              ...existing,
              id: frame.data.id,
              name: frame.data.name,
              args: frame.data.args,
              result_brief: frame.data.result_brief ?? null,
              items_added: frame.data.items_added,
              completed: true,
            });
            inflightToolCallsRef.current = buf;
          }

          // 关键：completed 通常发生在 message.done 之后，inflightAssistantIdRef
          // 已被清空——这里改用 lastAssistantIdRef 兜底；先按 id 匹配占位卡片，
          // 没找到再按未 inflight 的最早一条匹配，再没找到才 push 新条目。
          const targetId =
            inflightAssistantIdRef.current ?? lastAssistantIdRef.current;
          if (!targetId) break;
          const completedRecord: ToolCallRecord = {
            id: frame.data.id,
            name: frame.data.name,
            arguments: frame.data.args,
            result_brief: frame.data.result_brief ?? null,
            items_added: frame.data.items_added,
            inflight: false,
            retrieval_progress: null,
            ...(frame.data.retrieval_chunks
              ? { retrieval_chunks: frame.data.retrieval_chunks }
              : {}),
            ...(frame.data.retrieval_params
              ? { retrieval_params: frame.data.retrieval_params }
              : {}),
            ...(frame.data.recall_stats
              ? { recall_stats: frame.data.recall_stats }
              : {}),
            ...(frame.data.time_ms != null
              ? { time_ms: frame.data.time_ms }
              : {}),
            ...(frame.data.execution_model
              ? { execution_model: frame.data.execution_model }
              : {}),
            execution_stage: null,
          };
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== targetId) return m;
              let matched = false;
              const updated = m.tool_calls.map((t) => {
                if (matched) return t;
                if (
                  t.id === completedRecord.id ||
                  (t.inflight &&
                    matchedIndex !== null &&
                    t.index === matchedIndex)
                ) {
                  matched = true;
                  return {
                    ...t,
                    ...completedRecord,
                    argsText: undefined,
                  };
                }
                return t;
              });
              return {
                ...m,
                tool_calls: matched ? updated : [...updated, completedRecord],
              };
            })
          );
          break;
        }

        case "tool_round.done": {
          // 一轮工具批次结束；本轮的 tool_calls 已经累积到 assistant 上了
          currentRoundRef.current = frame.data.round + 1;
          // 清空 tool_call 累积器，准备下一轮
          inflightToolCallsRef.current = new Map();
          break;
        }

        case "message.done": {
          const id = inflightAssistantIdRef.current;
          if (!id) break;
          // 把临时 id 替换为后端 message_id，并固化 inflight 标志
          const backendId = frame.data.message_id;

          // 方案 B：把本轮权威 citations 合并进 turn 级缓存，同时刷新到当前
          // assistant 消息上。后端第 0 轮的 citations 已含完整种子；后续轮次只带
          // "本轮新增"，所以这里用 merge 语义（按 chunk_id 覆盖），不是替换。
          const roundCitations = (frame.data.citations ?? []) as Citation[];
          for (const c of roundCitations) {
            if (c?.chunk_id) {
              turnCitationsRef.current.set(c.chunk_id, c);
            }
          }
          const mergedCitations: Citation[] = Array.from(
            turnCitationsRef.current.values()
          );

          setMessages((prev) =>
            prev.map((m) =>
              m.id === id
                ? finalizeThinkingMs({
                    ...m,
                    id: backendId,
                    inflight: false,
                    citations:
                      mergedCitations.length > 0 ? mergedCitations : m.citations,
                    finish_reason: frame.data.finish_reason ?? null,
                    usage: frame.data.usage ?? m.usage ?? null,
                    thinking_ms:
                      typeof frame.data.thinking_ms === "number"
                        ? frame.data.thinking_ms
                        : m.thinking_ms,
                  })
                : m
            )
          );
          // 把 inflight 切到 last：随后到达的 tool_call.completed 还要往这条
          // 消息上挂结果（事件顺序见 lastAssistantIdRef 注释）。
          // 注意：这里必须存 backendId 而不是 id —— 上面的 setMessages 已经把
          // 该消息的 id 从 local 临时 id 换成 backendId 了，后续 tool_call.completed
          // 用 lastAssistantIdRef 兜底匹配时 m.id 是 backendId。存 local id 会
          // 永远匹配不到，导致工具结果被静默丢弃、卡片卡在"调用中…"。
          lastAssistantIdRef.current = backendId;
          inflightAssistantIdRef.current = null;
          break;
        }

        case "turn.done": {
          // 整轮收尾：同时把 message 自身和所有 tool_call 占位卡片的 inflight 清零，
          // 防止极端情况下（tool_call.completed 漏帧 / id 漂移）UI 永远卡在
          // "调用中…"。tool_call 缺失的结果会在下一次会话回放走 REST 历史时补齐
          // （后端 _persist_assistant 已合并了 result_brief / items_added）。
          setMessages((prev) =>
            prev.map((m) =>
              finalizeThinkingMs({
                ...m,
                inflight: false,
                tool_calls: m.tool_calls.map((t) =>
                  t.inflight
                    ? { ...t, inflight: false, argsText: undefined }
                    : t
                ),
              })
            )
          );
          resetInflight();
          setPhase("ready");

          // 刷新上下文用量（Cursor 式 Context 指示器）
          if (activeSessionIdRef.current) {
            void fetchContextStatus(activeSessionIdRef.current)
              .then((report) => setContextStatus(report))
              .catch((err) => console.debug("fetchContextStatus failed", err));
          }

          // 首轮异步起标题：轮询拉 session
          const sid = activeSessionIdRef.current;
          if (sid) {
            // 仅当当前 session 仍然没有"用户自定义标题"时才轮询
            // 这里不做太严格的判断，统一三次轻量轮询，若 title 变化就同步到 sessions
            clearTitleTimers();
            TITLE_POLL_DELAYS_MS.forEach((delay) => {
              const id = window.setTimeout(async () => {
                try {
                  const fresh = await getChatSession(sid);
                  setSessions((prev) =>
                    prev.map((s) =>
                      s.session_id === fresh.session_id ? fresh : s
                    )
                  );
                } catch {
                  // ignore
                }
              }, delay);
              titleTimersRef.current.push(id);
            });
          }
          break;
        }

        case "error": {
          const phaseStr = String(frame.data.phase ?? "");
          const errMsg = String(frame.data.error ?? "未知错误");
          const cancelled = frame.data.cancelled === true;

          if (cancelled || phaseStr === "stop") {
            // 用户主动中断：在最近一条 assistant/或 inflight 上挂 cancelled 标记
            const id = inflightAssistantIdRef.current;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === id || (m.inflight && !id)
                  ? finalizeThinkingMs({ ...m, inflight: false, cancelled: true })
                  : m
              )
            );
            resetInflight();
            setPhase("stopped");
            setLastError(null);
            return;
          }

          if (phaseStr === "retrieve") {
            // 检索失败：标记 user 消息的 retrieval 状态，不打断主流程
            const userId = inflightUserIdRef.current;
            if (userId) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === userId
                    ? {
                        ...m,
                        retrieval: { state: "failed", error: errMsg },
                      }
                    : m
                )
              );
            }
            return;
          }

          // 其他错误（llm_stream / start / load_session …）视为致命
          setMessages((prev) =>
            prev.map((m) =>
              m.inflight
                ? finalizeThinkingMs({ ...m, inflight: false, cancelled: true })
                : m
            )
          );
          resetInflight();
          setLastError(`${phaseStr ? `[${phaseStr}] ` : ""}${errMsg}`);
          setPhase("error");
          break;
        }

        default: {
          // 未知 frame type：忽略
          break;
        }
      }
    },
    [clearTitleTimers, resetInflight]
  );

  // 在新 round 收到 content/thinking 增量但没有 inflight assistant 时，自动新建一条临时 assistant
  // 由于 handleFrame 里我们用 setMessages(prev => prev.map(...))，无法直接 push，
  // 这里在 content.delta / thinking.delta case 里需要兜底。我们在上面的实现做了 if(!id) break，
  // 这里补一个：如果是 round>0 的新临时 assistant，turn 流程中我们在 message.done 后等到下一帧再补建。
  // 实现策略：在 content.delta 和 thinking.delta 的处理里增加"无 inflight 则新建"的兜底。
  // 为避免 closure 复杂度，我们重写 handleFrame 的两个 case。
  // —— 这部分逻辑下移到 ensureInflightAssistant() 工具方法。

  // 重写：把 content.delta / thinking.delta 改为先 ensureInflightAssistant
  // 通过 monkey-patch 不利于维护，下面是替代实现：抽工具函数。
  const ensureInflightAssistant = useCallback(() => {
    if (inflightAssistantIdRef.current) return;
    const tempId = makeLocalId("local_asst");
    inflightAssistantIdRef.current = tempId;
    // 方案 B：用 turn 级 citations 缓存的快照作为初始 citations。
    // 在 content.delta 流出 [chunk-xxx] 时，MarkdownRenderer 即可立刻命中
    // 完整渲染信息（而不是先显示降级短 hash，message.done 后才"亮起来"）。
    const initialCitations: Citation[] = Array.from(
      turnCitationsRef.current.values()
    );
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        role: "assistant",
        content: "",
        tool_calls: [],
        citations: initialCitations,
        inflight: true,
        created_at: new Date().toISOString(),
      },
    ]);
  }, []);

  // 包装 handleFrame：在 content/thinking delta 之前确保有 inflight assistant
  const dispatchFrame = useCallback(
    (frame: ServerFrame) => {
      if (frame.type === "content.delta" || frame.type === "thinking.delta") {
        ensureInflightAssistant();
      }
      handleFrame(frame);
    },
    [ensureInflightAssistant, handleFrame]
  );

  // -------------------------------------------------------------------------
  // 连接 / 复用 WebSocket
  // -------------------------------------------------------------------------
  const ensureWs = useCallback((): ChatStreamHandle => {
    const existing = wsRef.current;
    if (existing && existing.readyState() === WebSocket.OPEN) {
      return existing;
    }
    if (existing) {
      existing.close();
    }

    setPhase("connecting");
    const handle = openChatStream({
      onFrame: dispatchFrame,
      onOpen: () => {
        // ready 帧才是真正可发 start 的信号；这里只切 connecting → connecting
      },
      onClose: () => {
        wsRef.current = null;
        // 凭证已过期的断连：重连无意义，走全局过期跳转（HTTP 401 拦截的 WS 侧补充）
        if (isTokenExpired(getAuthToken())) {
          handleAuthExpired();
          return;
        }
        // 进行中的轮没收到 turn.done → 标记为中断
        setMessages((prev) =>
          prev.map((m) =>
            m.inflight
              ? finalizeThinkingMs({ ...m, inflight: false, cancelled: true })
              : m
          )
        );
        resetInflight();
        setPhase((prev) =>
          prev === "running" || prev === "connecting" || prev === "ready"
            ? "disconnected"
            : prev
        );
      },
      onError: (err) => {
        setLastError(err.message);
      },
    });
    wsRef.current = handle;
    return handle;
  }, [dispatchFrame, resetInflight]);

  // -------------------------------------------------------------------------
  // 行为：选会话 / 新建 / 重命名 / 删除
  // -------------------------------------------------------------------------
  const selectSession = useCallback(
    async (sessionId: string) => {
      if (sessionId === activeSessionId) return;
      setActiveSessionId(sessionId);
      if (knowledgeBaseId) {
        persistActiveSessionId(knowledgeBaseId, optionFolderId, sessionId);
      }
      setMessages([]);
      setIsLoading(true);
      setLastError(null);
      try {
        await loadMessagesForSession(sessionId);
        setPhase("idle");
      } catch (error) {
        setLastError(
          error instanceof Error ? error.message : "加载历史消息失败"
        );
        setPhase("error");
      } finally {
        setIsLoading(false);
      }
    },
    [activeSessionId, knowledgeBaseId, loadMessagesForSession, optionFolderId]
  );

  const newSession = useCallback(
    async (init?: NewSessionInit) => {
      if (!knowledgeBaseId) return;
      // folder scope 解析：
      //   - init.folderId === null（显式）→ 强制 KB scope
      //   - init.folderId 非 undefined → 用它
      //   - 否则取 hook 入参 optionFolderId（用户在 FolderTree 选中的）
      const effectiveFolderId =
        init?.folderId === null
          ? null
          : init?.folderId !== undefined
            ? init.folderId
            : optionFolderId;
      const effectiveIncludeSubfolders =
        init?.includeSubfolders !== undefined
          ? init.includeSubfolders
          : optionIncludeSubfolders;
      try {
        setIsLoading(true);
        const created = await createChatSession({
          knowledge_base_ids: [knowledgeBaseId],
          title: "新会话",
          ...(effectiveFolderId
            ? {
                folder_id: effectiveFolderId,
                include_subfolders: effectiveIncludeSubfolders,
              }
            : {}),
          ...(init?.modelPreset !== undefined
            ? { model_preset: init.modelPreset }
            : {}),
          // model 允许为空字符串（前端清除选择 → 让后端走 model_preset），
          // 所以用 ?? 而不是 ||
          ...(init?.model !== undefined ? { model: init.model ?? null } : {}),
          ...(init?.thinkingLevel !== undefined
            ? { thinking_level: init.thinkingLevel }
            : {}),
          ...(init?.enableMultimodal !== undefined
            ? { enable_multimodal: init.enableMultimodal }
            : {}),
          ...(init?.mode !== undefined
            ? { mode: init.mode }
            : {}),
        });
        setSessions((prev) => [created, ...prev]);
        setActiveSessionId(created.session_id);
        persistActiveSessionId(knowledgeBaseId, effectiveFolderId, created.session_id);
        setMessages([]);
        setLastError(null);
        setPhase("idle");
      } catch (error) {
        setLastError(error instanceof Error ? error.message : "创建会话失败");
        setPhase("error");
      } finally {
        setIsLoading(false);
      }
    },
    [knowledgeBaseId, optionFolderId, optionIncludeSubfolders]
  );

  const renameActive = useCallback(
    async (title: string) => {
      if (!activeSessionId) return;
      const updated = await renameChatSession(activeSessionId, { title });
      setSessions((prev) =>
        prev.map((s) => (s.session_id === activeSessionId ? updated : s))
      );
    },
    [activeSessionId]
  );

  const deleteActive = useCallback(async () => {
    if (!activeSessionId || !knowledgeBaseId) return;
    await deleteChatSession(activeSessionId);
    const remaining = sessions.filter((s) => s.session_id !== activeSessionId);
    setSessions(remaining);
    if (remaining.length > 0) {
      const next = remaining[0];
      setActiveSessionId(next.session_id);
      persistActiveSessionId(knowledgeBaseId, optionFolderId, next.session_id);
      await loadMessagesForSession(next.session_id);
    } else {
      // 当前 scope 没有会话了，自动建一条（继承 folder / KB scope）
      const defaultModel = getSettingsDefaultModel();
      const created = await createChatSession({
        knowledge_base_ids: [knowledgeBaseId],
        title: "新会话",
        ...buildScopeFields(optionFolderId),
        ...(defaultModel ? { model: defaultModel } : {}),
      });
      setSessions([created]);
      setActiveSessionId(created.session_id);
      persistActiveSessionId(knowledgeBaseId, optionFolderId, created.session_id);
      setMessages([]);
    }
  }, [
    activeSessionId,
    buildScopeFields,
    knowledgeBaseId,
    loadMessagesForSession,
    optionFolderId,
    sessions,
  ]);

  // -------------------------------------------------------------------------
  // 清空当前会话的消息（保留会话本身）
  // -------------------------------------------------------------------------
  const clearMessages = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      await clearChatMessages(activeSessionId);
      setMessages([]);
      // 更新会话列表中的 message_count
      setSessions((prev) =>
        prev.map((s) =>
          s.session_id === activeSessionId
            ? { ...s, message_count: 0, last_message_at: undefined }
            : s
        )
      );
    } catch (error) {
      console.error("清空消息失败:", error);
      throw error;
    }
  }, [activeSessionId]);

  // -------------------------------------------------------------------------
  // 总结当前会话上下文
  // -------------------------------------------------------------------------
  const summarizeAbortRef = useRef<AbortController | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  const summarizeContext = useCallback(async () => {
    if (!activeSessionId) return;
    // 已有总结在进行中，不重复触发
    if (summarizeAbortRef.current) return;
    const controller = new AbortController();
    summarizeAbortRef.current = controller;
    setSummarizing(true);
    try {
      await summarizeChatContext(activeSessionId, controller.signal);
      // 重新加载消息以获取总结后的状态
      await loadMessagesForSession(activeSessionId);
      try {
        const report = await fetchContextStatus(activeSessionId);
        setContextStatus(report);
      } catch (err) {
        console.debug("fetchContextStatus failed", err);
      }
    } catch (error) {
      // 用户主动中断：AbortError，不打错误日志
      if ((error as Error)?.name !== "AbortError") {
        console.error("总结上下文失败:", error);
        throw error;
      }
    } finally {
      summarizeAbortRef.current = null;
      setSummarizing(false);
    }
  }, [activeSessionId, loadMessagesForSession]);

  /** 中断正在进行的上下文总结 */
  const stopSummarize = useCallback(() => {
    summarizeAbortRef.current?.abort();
  }, []);

  // -------------------------------------------------------------------------
  // 行为：发送 / 中断
  // -------------------------------------------------------------------------
  const send = useCallback(
    async (query: string, opts: SendOptions = {}) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      if (!activeSessionId) return;
      if (phase === "running" || phase === "connecting") return;

      // push 用户消息（临时 id）
      const tempUserId = makeLocalId("local_user");
      setMessages((prev) => [
        ...prev,
        {
          id: tempUserId,
          role: "user",
          content: trimmed,
          tool_calls: [],
          citations: [],
          created_at: new Date().toISOString(),
        },
      ]);
      inflightUserIdRef.current = tempUserId;
      inflightAssistantIdRef.current = null;
      inflightToolCallsRef.current = new Map();
      currentRoundRef.current = 0;
      setLastError(null);

      // 注意：后端 ChatRequestPayload 用 Pydantic 校验；其中 skip_retrieval 是
      // 严格 bool（不接受 null），其余字段虽是 Optional 但也建议 omit 而不是
      // 显式传 null —— "缺省" 才是协议里 "沿用 session 默认" 的正确表达。
      const payload: ChatRequestPayload = {
        session_id: activeSessionId,
        query: trimmed,
      };
      if (opts.mode !== undefined) payload.mode = opts.mode;
      if (opts.thinkingLevel !== undefined) {
        payload.thinking_level = opts.thinkingLevel;
      }
      if (opts.enableMultimodal !== undefined) {
        payload.enable_multimodal = opts.enableMultimodal;
      }
      if (opts.modelPreset !== undefined) {
        payload.model_preset = opts.modelPreset;
      }
      // model 与 modelPreset 并存：model 选定具体模型，modelPreset 仍是采样参数模板。
      // 空字符串视为"清除前端选择 → 沿用 session 默认"，所以这里 omit 而不是显式传 ""。
      if (opts.model) {
        payload.model = opts.model;
      }
      if (opts.retrieveTopK !== undefined) {
        payload.retrieve_top_k = opts.retrieveTopK;
      }
      if (opts.skipRetrieval !== undefined) {
        payload.skip_retrieval = opts.skipRetrieval;
      }
      const effectiveEnableRoutePlan =
        opts.enableRoutePlan !== undefined
          ? opts.enableRoutePlan
          : getSettingsEnableRoutePlan();
      payload.enable_route_plan = effectiveEnableRoutePlan;
      if (opts.forcedSkillNames && opts.forcedSkillNames.length > 0) {
        payload.forced_skill_names = opts.forcedSkillNames;
      }
      // Cursor 式 @ 内联引用：软引用，可多个，透传给后端解析为引用块
      if (opts.mentions && opts.mentions.length > 0) {
        payload.mentions = opts.mentions;
      }
      // 请求级临时覆盖 folder scope（@ 目录）
      if (opts.folderId !== undefined) {
        payload.folder_id = opts.folderId;
        if (opts.includeSubfolders !== undefined) {
          payload.include_subfolders = opts.includeSubfolders;
        }
      }

      const handle = ensureWs();
      if (handle.readyState() === WebSocket.OPEN) {
        // 已经 OPEN 但 ready 帧理论上应已经收到（连接复用时）；直接 start
        setPhase("running");
        handle.start(payload);
      } else {
        // 等 ready 帧
        pendingStartRef.current = payload;
      }
    },
    [activeSessionId, ensureWs, phase]
  );

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    ws.stop();
  }, []);

  const disconnect = useCallback(() => {
    clearTitleTimers();
    wsRef.current?.close();
    wsRef.current = null;
    pendingStartRef.current = null;
    resetInflight();
  }, [clearTitleTimers, resetInflight]);

  const clearError = useCallback(() => {
    setLastError(null);
    if (phase === "error") setPhase("idle");
  }, [phase]);

  // 卸载时清理
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // KB 切换 → 重连前先关掉旧连接
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      pendingStartRef.current = null;
    };
  }, [knowledgeBaseId]);

  const activeSession = useMemo(
    () =>
      sessions.find((s) => s.session_id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );

  const refreshContextStatus = useCallback(async () => {
    const sid = activeSessionIdRef.current;
    if (!sid || !enabled) {
      setContextStatus(null);
      return;
    }
    try {
      const report = await fetchContextStatus(sid);
      setContextStatus(report);
    } catch (err) {
      console.debug("fetchContextStatus failed", err);
    }
  }, [enabled]);

  useEffect(() => {
    if (!activeSessionId || !enabled) {
      setContextStatus(null);
      return;
    }
    void refreshContextStatus();
  }, [activeSessionId, enabled, refreshContextStatus]);

  useEffect(() => {
    const onFocus = () => {
      if (activeSessionIdRef.current && enabled) {
        void refreshContextStatus();
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, refreshContextStatus]);

  return {
    sessions,
    activeSession,
    activeSessionId,
    messages,
    hasSummary,
    contextStatus,
    refreshContextStatus,
    phase,
    lastError,
    isStreaming: phase === "running" || phase === "connecting",
    isLoading,
    selectSession,
    newSession,
    renameActive,
    deleteActive,
    clearMessages,
    summarizeContext,
    stopSummarize,
    summarizing,
    send,
    stop,
    disconnect,
    clearError,
  };
}
