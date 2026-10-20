"use client";

/**
 * 通用 Agent（首页）对话 hook —— agent-server /api/v1/chat/ws + /api/v1/sessions
 *
 * 与 useKnowledgeChat 的关系：连接管理/心跳/重连/会话回放模式同源，协议与
 * 状态机面向 agent-server（docs/ws-protocol.md）。
 *
 * 会话持久化（v1.0.0）：
 * - 落库由后端负责（turn 结束 persist_turn）；本 hook 管会话列表/切换/重命名/
 *   删除与刷新恢复（localStorage 记住上次活跃会话）
 * - 惰性建会话：新对话不预建，首条消息时才 POST /sessions（避免堆积空会话）
 * - 回放聚合：agent_message 的 user/assistant 两行 → UiAgentMessage
 *   （assistant 行自带 thinking/tool_calls，回放不依赖其他行）
 *
 * 重连策略：指数退避 1s→2s→5s（封顶），与架构方案 §8.2 一致。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  openAgentStream,
  type AgentStreamHandle,
  createAgentSession,
  deleteAgentSession,
  listAgentMessages,
  listAgentSessions,
  renameAgentSession,
} from "@/lib/api/agent-chat";
import type {
  AgentMessageItem,
  AgentSegment,
  AgentServerFrame,
  AgentSessionInfo,
  AgentStartPayload,
  UiAgentMessage,
} from "@/lib/agent-chat-types";
import { getAuthToken } from "@/lib/auth";
import { handleAuthExpired, isTokenExpired } from "@/lib/auth-expired";

export type AgentConnectionState = "connecting" | "open" | "closed";

const ACTIVE_SESSION_KEY = "agent-chat-active-session-v1";

let localSeq = 0;
function makeLocalId(prefix: string): string {
  localSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${localSeq}`;
}

function loadPersistedActiveSession(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_SESSION_KEY);
  } catch {
    return null;
  }
}

function persistActiveSession(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(ACTIVE_SESSION_KEY, id);
    else window.localStorage.removeItem(ACTIVE_SESSION_KEY);
  } catch {
    // ignore
  }
}

/** 剥离 user content 里的 LLM 注入文本（存根块/图片占位）——发送时气泡
 *  只显示用户原文，回放须一致；旧数据 content 未清洗，这里兜底 */
function cleanPersistedUserText(raw: string): string {
  let t = raw ?? "";
  const marker = t.indexOf("[本次会话附件]");
  if (marker >= 0) t = t.slice(0, marker);
  t = t.replace(/\[图片附件[^\]]*\]/g, "");
  return t.trim();
}

/** 落库消息行 → UI 消息模型（user/assistant 两行成对，assistant 行自带工具轨迹） */
function fromPersistedMessage(m: AgentMessageItem): UiAgentMessage {
  if (m.role === "user") {
    return {
      id: m.message_id,
      role: "user",
      text: cleanPersistedUserText(m.content ?? ""),
      attachments: (m.attachments ?? []).filter((a) => a && a.file_id),
      toolCalls: [],
      segments: [],
      done: true,
    };
  }
  const toolCalls = (m.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.name,
    argsText: (() => {
      try {
        return JSON.stringify(tc.arguments ?? {}, null, 2);
      } catch {
        return "";
      }
    })(),
    status: "done" as const,
    resultBrief: tc.result_brief ?? undefined,
    timeMs: tc.time_ms ?? undefined,
  }));
  // 思考/工具交错段：后端从落库 items 派生的唯一事实源（空 = 无轨迹轮）
  const segments: AgentSegment[] = (m.segments ?? [])
    .filter((s) => (s.kind === "thinking" ? Boolean(s.text) : Boolean(s.id)))
    .map((s) => (s.kind === "thinking" ? { kind: "thinking", text: s.text } : { kind: "tool", id: s.id }));
  return {
    id: m.message_id,
    role: "assistant",
    text: m.content,
    thinkingMs: m.thinking_ms ?? undefined,
    usage: m.usage
      ? {
          total_tokens: m.usage.total_tokens,
          input_tokens: m.usage.input_tokens,
          cached_tokens: m.usage.cached_tokens,
        }
      : null,
    toolCalls,
    segments,
    done: true,
  };
}

export interface UseAgentChatResult {
  messages: UiAgentMessage[];
  /** 本轮进行中（start 已发、turn.done 未到） */
  busy: boolean;
  connection: AgentConnectionState;
  lastError: string | null;
  /** 当前会话 id（无活跃会话时为 null——首条消息时惰性创建） */
  sessionId: string | null;
  /** 会话列表（活跃度倒序） */
  sessions: AgentSessionInfo[];
  sessionsLoading: boolean;
  /** 历史消息回放中（切会话/刷新恢复；与知识库一致，先出加载态不闪欢迎页） */
  historyLoading: boolean;
  /** 开启新对话（本地清空；会话在首条消息时创建） */
  newSession: () => void;
  /** 切换会话（REST 回放历史） */
  selectSession: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  sendMessage: (payload: AgentStartPayload) => void;
  stop: () => void;
}

export function useAgentChat(): UseAgentChatResult {
  const [messages, setMessages] = useState<UiAgentMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<AgentConnectionState>("connecting");
  const [lastError, setLastError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);

  const wsRef = useRef<AgentStreamHandle | null>(null);
  const retryRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  /** 当前活跃会话（WS 回调与发送路径共用的唯一事实源） */
  const activeIdRef = useRef<string | null>(null);
  /** 当前进行中的 assistant 消息 id（帧归位用） */
  const inflightIdRef = useRef<string | null>(null);
  /** 发送中哨兵：waitForOpen/ensureSession 异步段内拦截重复发送（busy 尚未置位） */
  const sendingRef = useRef(false);
  const thinkingStartRef = useRef<number | null>(null);

  const patchInflight = useCallback(
    (patch: (m: UiAgentMessage) => UiAgentMessage) => {
      const id = inflightIdRef.current;
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? patch(m) : m))
      );
    },
    []
  );

  const handleFrame = useCallback(
    (frame: AgentServerFrame) => {
      switch (frame.type) {
        case "session.ready":
          if (frame.data?.session_id) setSessionId(frame.data.session_id);
          break;

        case "thinking.delta": {
          if (thinkingStartRef.current == null) thinkingStartRef.current = Date.now();
          patchInflight((m) => {
            // 段组装：最后一个思考段续写，否则开新段（工具调用之后的思考
            // 会成为新段，渲染时按发生顺序与工具交错）
            const segs = [...m.segments];
            const last = segs[segs.length - 1];
            const text = frame.data.text ?? "";
            if (last && last.kind === "thinking") {
              segs[segs.length - 1] = { kind: "thinking", text: last.text + text };
            } else {
              segs.push({ kind: "thinking", text });
            }
            return { ...m, segments: segs };
          });
          break;
        }

        case "content.delta":
          patchInflight((m) => ({ ...m, text: m.text + (frame.data.text ?? "") }));
          break;

        case "tool_call.started": {
          const { id, name } = frame.data;
          patchInflight((m) => ({
            ...m,
            toolCalls: [
              ...m.toolCalls,
              { id, name, argsText: "", status: "running" },
            ],
            segments: [...m.segments, { kind: "tool", id }],
          }));
          break;
        }

        case "tool_call.args_delta": {
          const { id, text } = frame.data;
          patchInflight((m) => ({
            ...m,
            toolCalls: m.toolCalls.map((tc) =>
              tc.id === id ? { ...tc, argsText: tc.argsText + (text ?? "") } : tc
            ),
          }));
          break;
        }

        case "tool_call.completed": {
          const { id, result_brief, time_ms, args } = frame.data;
          patchInflight((m) => ({
            ...m,
            toolCalls: m.toolCalls.map((tc) =>
              tc.id === id
                ? {
                    ...tc,
                    status: "done" as const,
                    // completed 帧带完整参数（部分工具不走 args_delta 流式）
                    argsText: args || tc.argsText,
                    resultBrief: result_brief ?? tc.resultBrief,
                    timeMs: time_ms ?? tc.timeMs,
                  }
                : tc
            ),
          }));
          break;
        }

        case "message.done": {
          const started = thinkingStartRef.current;
          patchInflight((m) => ({
            ...m,
            thinkingMs:
              started != null ? Date.now() - started : m.thinkingMs,
          }));
          break;
        }

        case "usage": {
          const { total_tokens, input_tokens, cached_tokens } = frame.data;
          patchInflight((m) => ({
            ...m,
            usage: { total_tokens, input_tokens, cached_tokens },
          }));
          break;
        }

        case "turn.done": {
          // 整个 turn 结束：把进行中的 assistant 消息标记完结
          // （推理轨道 / 身份头 spinner / 底部操作栏都由 done 驱动）
          const id = inflightIdRef.current;
          if (id) {
            setMessages((prev) =>
              prev.map((m) => (m.id === id ? { ...m, done: true } : m)),
            );
          }
          inflightIdRef.current = null;
          thinkingStartRef.current = null;
          setBusy(false);
          break;
        }

        case "error": {
          const cancelled = Boolean(frame.data?.cancelled);
          // stop 空回执（本端已无进行中 turn）静默：常见于断线后点停止解卡
          const stopNop =
            frame.data?.phase === "stop" && inflightIdRef.current == null;
          if (!cancelled && !stopNop) setLastError(frame.data?.error ?? "未知错误");
          inflightIdRef.current = null;
          thinkingStartRef.current = null;
          // 被取消/出错时把进行中的 assistant 消息标记完结（保留已产出内容）
          setMessages((prev) =>
            prev.map((m) =>
              m.role === "assistant" && !m.done ? { ...m, done: true } : m
            )
          );
          setBusy(false);
          break;
        }

        default:
          break;
      }
    },
    [patchInflight]
  );

  const connect = useCallback(() => {
    setConnection("connecting");
    const handle = openAgentStream({
      onOpen: () => {
        retryRef.current = 0;
        setConnection("open");
        setLastError(null);
        // 断线 / HMR 后重连：进行中 turn 的流式帧发往的是旧连接，永远不会
        // 到达本连接（后端不受影响照常跑完并落库，刷新/回放可见完整内容）。
        // 本地把未完成消息标记完结，避免 busy 永久卡死。幂等：无未完成
        // 消息时为 noop，不影响正常收发。
        setMessages((prev) =>
          prev.some((m) => !m.done)
            ? prev.map((m) => (m.done ? m : { ...m, done: true }))
            : prev,
        );
        inflightIdRef.current = null;
        thinkingStartRef.current = null;
        setBusy(false);
      },
      onFrame: handleFrame,
      onError: () => {
        /* onclose 随后触发，重连逻辑集中在 onClose */
      },
      onClose: () => {
        setConnection("closed");
        wsRef.current = null;
        // 凭证已过期：重连握手必被拒（无限退避死循环），直接走全局过期跳转
        if (isTokenExpired(getAuthToken())) {
          handleAuthExpired();
          return;
        }
        // 指数退避重连：1s → 2s → 5s（封顶）
        const delay = [1000, 2000, 5000][Math.min(retryRef.current, 2)];
        retryRef.current += 1;
        if (retryTimerRef.current != null) window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = window.setTimeout(connect, delay);
      },
    });
    wsRef.current = handle;
  }, [handleFrame]);

  useEffect(() => {
    connect();
    return () => {
      if (retryTimerRef.current != null) window.clearTimeout(retryTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // 会话列表 + 刷新恢复（localStorage 上次活跃会话 → 回放）
  // -------------------------------------------------------------------------

  const selectSession = useCallback(async (targetId: string) => {
    activeIdRef.current = targetId;
    setSessionId(targetId);
    persistActiveSession(targetId);
    setMessages([]);
    setHistoryLoading(true);
    try {
      // 回放全量（分页翻完；上限防御同 useKnowledgeChat）
      const all: AgentMessageItem[] = [];
      let page = 1;
      let total = Number.POSITIVE_INFINITY;
      while (all.length < total) {
        const data = await listAgentMessages(targetId, page, 100);
        total = data.total ?? 0;
        const items = data.items ?? [];
        if (items.length === 0) break;
        all.push(...items);
        page += 1;
        if (page > 100) break;
      }
      // 竞态防御：翻页期间用户又切了会话，丢弃本次结果
      if (activeIdRef.current !== targetId) return;
      setMessages(all.map(fromPersistedMessage));
    } catch {
      if (activeIdRef.current === targetId) {
        setLastError("历史消息加载失败");
      }
    } finally {
      // 仅当前会话的加载才解除；被新切换/新建抢占时不误清对方的加载态
      if (activeIdRef.current === targetId) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await listAgentSessions(1, 50);
        if (cancelled) return;
        setSessions(data.items ?? []);
        const persisted = loadPersistedActiveSession();
        const target =
          (persisted ? data.items?.find((s) => s.session_id === persisted) : undefined) ??
          data.items?.[0];
        if (target) {
          await selectSession(target.session_id);
        }
      } catch {
        // 服务未起 / 网络失败：空会话列表，不阻断（WS 重连兜底）
      } finally {
        if (!cancelled) setSessionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newSession = useCallback(() => {
    activeIdRef.current = null;
    setSessionId(null);
    setMessages([]);
    setLastError(null);
    setHistoryLoading(false);
    persistActiveSession(null);
  }, []);

  const renameSession = useCallback(async (targetId: string, title: string) => {
    const updated = await renameAgentSession(targetId, title);
    setSessions((prev) =>
      prev.map((s) => (s.session_id === targetId ? updated : s))
    );
  }, []);

  const deleteSession = useCallback(
    async (targetId: string) => {
      await deleteAgentSession(targetId);
      setSessions((prev) => prev.filter((s) => s.session_id !== targetId));
      if (activeIdRef.current === targetId) {
        // 删的是活跃会话 → 本地清空（不自动跳别的会话，用户显式选择）
        activeIdRef.current = null;
        setSessionId(null);
        setMessages([]);
        setHistoryLoading(false);
        persistActiveSession(null);
      }
    },
    []
  );

  const sendMessage = useCallback(
    (payload: AgentStartPayload) => {
      const text = payload.message.trim();
      if (!text || busy || sendingRef.current) return;
      sendingRef.current = true;

      /**
       * 等待 WS 就绪（最长 5s）：页面刚打开 / 断线重连期间用户点发送，
       * 不应静默失败——错误提示还会被随后的 onOpen 清掉，表现为"没反应"。
       * 连接就绪后立即继续；超时才报错（此时错误会保留到下次成功）。
       */
      const waitForOpen = (timeoutMs = 5000): Promise<boolean> => {
        const ws = wsRef.current;
        if (ws && ws.readyState() === WebSocket.OPEN) return Promise.resolve(true);
        return new Promise((resolve) => {
          const t0 = Date.now();
          const timer = window.setInterval(() => {
            const cur = wsRef.current;
            if (cur && cur.readyState() === WebSocket.OPEN) {
              window.clearInterval(timer);
              resolve(true);
            } else if (Date.now() - t0 > timeoutMs) {
              window.clearInterval(timer);
              resolve(false);
            }
          }, 150);
        });
      };

      void (async () => {
        const ok = await waitForOpen();
        if (!ok) {
          sendingRef.current = false;
          setLastError("服务连接中，请稍候重试");
          return;
        }

        // 无活跃会话 → 惰性创建（标题取首条消息截断，与后端 upsert 同口径）
        const ensureSession = async (): Promise<string | null> => {
          if (activeIdRef.current) return activeIdRef.current;
          try {
            const created = await createAgentSession({
              title: text.slice(0, 30),
              model: payload.model ?? null,
              thinking_level: payload.thinking_level ?? "off",
            });
            activeIdRef.current = created.session_id;
            setSessionId(created.session_id);
            persistActiveSession(created.session_id);
            setSessions((prev) => [created, ...prev]);
            return created.session_id;
          } catch {
            setLastError("会话创建失败，请重试");
            return null;
          }
        };

        const sid = await ensureSession();
        if (!sid) {
          sendingRef.current = false;
          return;
        }
        const current = wsRef.current;
        if (!current || current.readyState() !== WebSocket.OPEN) {
          sendingRef.current = false;
          setLastError("服务连接中断，请重试");
          return;
        }

        // busy 接管重复发送拦截，哨兵释放
        setBusy(true);
        sendingRef.current = false;

        // 用户消息（含附件元数据）+ 空的 assistant 占位
        const attachmentMetas = (payload.attachments ?? []).filter((a) => a && a.file_id);
        const assistantId = makeLocalId("a");
        inflightIdRef.current = assistantId;
        thinkingStartRef.current = null;
        setMessages((prev) => [
          ...prev,
          {
            id: makeLocalId("u"),
            role: "user",
            text,
            attachments: attachmentMetas,
            toolCalls: [],
            segments: [],
            done: true,
          },
          {
            id: assistantId,
            role: "assistant",
            text: "",
            toolCalls: [],
            segments: [],
            done: false,
          },
        ]);

        current.send({
          type: "start",
          data: {
            message: text,
            model: payload.model || undefined,
            thinking_level: payload.thinking_level || undefined,
            session_id: sid,
            // D1/D2：附件随 start 帧上送（临时区文件由后端绑定归位；
            // 非 ready 附件后端直接拒发——前端发送锁与之配套）
            attachments: attachmentMetas.length
              ? attachmentMetas.map((a) => ({ file_id: a.file_id, kind: a.kind }))
              : undefined,
          },
        });
      })();
    },
    [busy]
  );

  const stop = useCallback(() => {
    wsRef.current?.stop();
  }, []);

  return {
    messages,
    busy,
    connection,
    lastError,
    sessionId,
    sessions,
    sessionsLoading,
    historyLoading,
    newSession,
    selectSession,
    renameSession,
    deleteSession,
    sendMessage,
    stop,
  };
}
