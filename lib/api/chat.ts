/**
 * 知识库对话（Chat）模块 API 客户端。
 *
 * - REST：会话 CRUD + 历史消息分页（沿用 lib/api/knowledge.ts 的 requestJson 范式）
 * - WS  ：openChatStream(...) 工厂，封装连接/订阅/心跳/中断
 *
 * 后端契约见：docs/特殊功能设计/知识库对话设计.md §4 / §5
 */

import { API_CONFIG, getChatWsUrl, getCommonHeaders } from "@/lib/config";
import type { ApiResponse } from "@/lib/knowledge-types";
import type {
  ChatMessage,
  ChatMessageListResponse,
  ChatSessionCreateRequest,
  ChatSessionInfo,
  ChatSessionListResponse,
  ChatSessionRenameRequest,
  ChatRequestPayload,
  ClientFrame,
  ServerFrame,
  ContextStatusReport,
} from "@/lib/chat-types";

const CHAT_API_PREFIX = process.env.NEXT_PUBLIC_CHAT_API_PREFIX ?? "";
const CHAT_WS_SUBPROTOCOL = "aks-chat-v1";
const PING_INTERVAL_MS = 25_000;

function buildChatUrl(path: string): string {
  return `${API_CONFIG.BASE_URL}${CHAT_API_PREFIX}${path}`;
}

function buildHeaders(init?: RequestInit): HeadersInit {
  const defaultHeaders = getCommonHeaders();
  const next: Record<string, string> = {
    "Content-Type": defaultHeaders["Content-Type"],
  };
  if (defaultHeaders.Authorization) {
    next.Authorization = defaultHeaders.Authorization;
  }
  return {
    ...next,
    ...(init?.headers ?? {}),
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildChatUrl(path), {
    ...init,
    headers: buildHeaders(init),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: "对话接口请求失败",
    }));
    throw new Error(error.detail || error.message || `HTTP ${response.status}`);
  }

  // 部分端点（DELETE）可能没有 body，避免 JSON.parse 抛错
  const text = await response.text();
  if (!text) {
    return undefined as unknown as T;
  }

  let payload: ApiResponse<T> | T;
  try {
    payload = JSON.parse(text) as ApiResponse<T> | T;
  } catch {
    return undefined as unknown as T;
  }

  if (
    payload &&
    typeof payload === "object" &&
    "data" in (payload as ApiResponse<T>)
  ) {
    return (payload as ApiResponse<T>).data as T;
  }
  return payload as T;
}

// ---------------------------------------------------------------------------
// REST：会话 CRUD
// ---------------------------------------------------------------------------

export async function createChatSession(
  input: ChatSessionCreateRequest
): Promise<ChatSessionInfo> {
  return requestJson<ChatSessionInfo>("/api/chat/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listChatSessions(
  params: {
    page?: number;
    page_size?: number;
    knowledge_base_id?: string;
    /** 'kb' = 仅 KB 级会话；'folder' = 仅指定 folder 的会话（须配合 folder_id） */
    scope?: "kb" | "folder";
    folder_id?: string;
  } = {}
): Promise<ChatSessionListResponse> {
  const search = new URLSearchParams();
  if (typeof params.page === "number") search.set("page", String(params.page));
  if (typeof params.page_size === "number") {
    search.set("page_size", String(params.page_size));
  }
  if (params.knowledge_base_id) {
    search.set("knowledge_base_id", params.knowledge_base_id);
  }
  if (params.scope) {
    search.set("scope", params.scope);
  }
  if (params.folder_id) {
    search.set("folder_id", params.folder_id);
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return requestJson<ChatSessionListResponse>(`/api/chat/sessions${suffix}`, {
    method: "GET",
  });
}

export async function getChatSession(
  sessionId: string
): Promise<ChatSessionInfo> {
  return requestJson<ChatSessionInfo>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
    { method: "GET" }
  );
}

export async function renameChatSession(
  sessionId: string,
  payload: ChatSessionRenameRequest
): Promise<ChatSessionInfo> {
  return requestJson<ChatSessionInfo>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  await requestJson<void>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
}

/** UI 历史全量回放分页（page=1 最早；调用方应翻页拼完）。LLM 上下文不走此接口。 */
export async function listChatMessages(
  sessionId: string,
  params: { page?: number; page_size?: number } = {}
): Promise<ChatMessageListResponse> {
  const search = new URLSearchParams();
  if (typeof params.page === "number") search.set("page", String(params.page));
  if (typeof params.page_size === "number") {
    search.set("page_size", String(params.page_size));
  }
  const suffix = search.toString() ? `?${search.toString()}` : "";
  return requestJson<ChatMessageListResponse>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages${suffix}`,
    { method: "GET" }
  );
}

export async function clearChatMessages(sessionId: string): Promise<void> {
  await requestJson<void>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`,
    { method: "DELETE" }
  );
}

export async function summarizeChatContext(
  sessionId: string,
  signal?: AbortSignal
): Promise<void> {
  await requestJson<void>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/summarize`,
    { method: "POST", signal }
  );
}

export async function fetchContextStatus(
  sessionId: string,
  signal?: AbortSignal
): Promise<ContextStatusReport> {
  return requestJson<ContextStatusReport>(
    `/api/chat/sessions/${encodeURIComponent(sessionId)}/context-status`,
    { method: "GET", signal }
  );
}

// ---------------------------------------------------------------------------
// WebSocket：openChatStream
// ---------------------------------------------------------------------------

export interface OpenChatStreamHandlers {
  onFrame: (frame: ServerFrame) => void;
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
  onError?: (error: Error) => void;
}

export interface ChatStreamHandle {
  /** 在收到 ready 帧后再调用：发起一轮对话 */
  start: (payload: ChatRequestPayload) => void;
  /** 中断当前轮 */
  stop: () => void;
  /** 主动关闭连接（不会触发 onClose 重连，需要业务自行管理） */
  close: (code?: number, reason?: string) => void;
  /** 当前 WS 状态 */
  readyState: () => number;
}

/**
 * 打开一条 Chat WebSocket。返回的 handle 暴露 start/stop/close。
 *
 * 心跳：每 25s 发一次 ping，避免 NAT 中间设备掐连接。
 * 鉴权：URL 里带 ?token=<user_id>（由 getChatWsUrl 注入）。
 */
export function openChatStream(handlers: OpenChatStreamHandlers): ChatStreamHandle {
  if (typeof window === "undefined") {
    throw new Error("openChatStream 只能在浏览器环境调用");
  }

  const url = getChatWsUrl();
  const ws = new WebSocket(url, [CHAT_WS_SUBPROTOCOL]);
  let pingTimer: number | null = null;
  let closed = false;

  const send = (frame: ClientFrame) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(frame));
    } catch (error) {
      handlers.onError?.(
        error instanceof Error ? error : new Error("发送失败")
      );
    }
  };

  ws.onopen = () => {
    pingTimer = window.setInterval(() => {
      send({ type: "ping" });
    }, PING_INTERVAL_MS);
    handlers.onOpen?.();
  };

  ws.onmessage = (event) => {
    let frame: ServerFrame | null = null;
    try {
      frame = JSON.parse(event.data) as ServerFrame;
    } catch {
      handlers.onFrame({
        type: "error",
        data: { phase: "protocol", error: "无法解析的服务端帧" },
      });
      return;
    }
    if (!frame || typeof frame !== "object" || !("type" in frame)) {
      handlers.onFrame({
        type: "error",
        data: { phase: "protocol", error: "服务端帧缺少 type 字段" },
      });
      return;
    }
    handlers.onFrame(frame);
  };

  ws.onerror = () => {
    if (closed) return;
    handlers.onError?.(new Error("WebSocket 连接异常"));
  };

  ws.onclose = (event) => {
    if (pingTimer !== null) {
      window.clearInterval(pingTimer);
      pingTimer = null;
    }
    if (closed) return;
    closed = true;
    handlers.onClose?.(event);
  };

  return {
    start(payload) {
      send({ type: "start", data: payload });
    },
    stop() {
      send({ type: "stop" });
    },
    close(code = 1000, reason = "client closed") {
      closed = true;
      if (pingTimer !== null) {
        window.clearInterval(pingTimer);
        pingTimer = null;
      }
      try {
        ws.close(code, reason);
      } catch {
        // ignore
      }
    },
    readyState() {
      return ws.readyState;
    },
  };
}

/** 帮 UI 把后端返回的 ChatMessage 转成 UI 渲染态 */
export function toUiCreateTime(message: ChatMessage): string | undefined {
  return message.create_time ?? undefined;
}
