/**
 * 通用 Agent API 客户端
 *
 * - WS  ：openAgentStream(...) —— agent-server /api/v1/chat/ws
 *          （连接/心跳/中断封装模式同 lib/api/chat.ts 的 openChatStream，
 *            独立实现避免动 AKS 链路；URL 经 getChatWsUrl 注入 token）
 * - REST：useAgentModels()    —— GET /api/v1/models（模型选择器数据源）
 */

import { useEffect, useRef, useState } from "react";

import { authFetch } from "@/lib/api/http";
import { API_CONFIG, getChatWsUrl, getCommonHeaders } from "@/lib/config";
import type {
  AgentClientFrame,
  AgentMessageItem,
  AgentMessageListResponse,
  AgentModelItem,
  AgentServerFrame,
  AgentSessionInfo,
  AgentSessionListResponse,
} from "@/lib/agent-chat-types";

const PING_INTERVAL_MS = 25_000;

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

export interface AgentStreamHandlers {
  onOpen?: () => void;
  onFrame?: (frame: AgentServerFrame) => void;
  onError?: (error: Error) => void;
  /** 连接关闭（服务端关闭/网络断开）；主动 close() 不触发 */
  onClose?: (event: CloseEvent) => void;
}

export interface AgentStreamHandle {
  send: (frame: AgentClientFrame) => void;
  stop: () => void;
  close: () => void;
  readyState: () => number;
}

/**
 * 打开通用 agent 对话 WebSocket。
 * start(payload) 直接发 start 帧（连接 open 后才有效，调用方自行保证）。
 */
export function openAgentStream(handlers: AgentStreamHandlers) {
  if (typeof window === "undefined") {
    throw new Error("openAgentStream 只能在浏览器环境调用");
  }

  const url = getChatWsUrl("/api/v1/chat/ws");
  const ws = new WebSocket(url);
  let pingTimer: number | null = null;
  let closedByUs = false;

  const send = (frame: AgentClientFrame) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(frame));
  };

  ws.onopen = () => {
    pingTimer = window.setInterval(() => send({ type: "ping" }), PING_INTERVAL_MS);
    handlers.onOpen?.();
  };

  ws.onmessage = (event) => {
    let frame: AgentServerFrame;
    try {
      frame = JSON.parse(event.data as string) as AgentServerFrame;
    } catch {
      return;
    }
    handlers.onFrame?.(frame);
  };

  ws.onerror = () => {
    handlers.onError?.(new Error("agent 服务连接异常"));
  };

  ws.onclose = (event) => {
    if (pingTimer != null) window.clearInterval(pingTimer);
    if (!closedByUs) handlers.onClose?.(event);
  };

  return {
    send,
    stop: () => send({ type: "stop" }),
    close: () => {
      closedByUs = true;
      if (pingTimer != null) window.clearInterval(pingTimer);
      try {
        ws.close();
      } catch {
        /* noop */
      }
    },
    readyState: () => ws.readyState,
  };
}

// ---------------------------------------------------------------------------
// 模型清单
// ---------------------------------------------------------------------------

interface ModelsPayload {
  models: AgentModelItem[];
}

/** 拉取 agent-server 模型清单（与 /api/v1/models 的 ApiResponse 形状对齐） */
export async function fetchAgentModels(): Promise<AgentModelItem[]> {
  const headers = getCommonHeaders();
  const next: Record<string, string> = {};
  if (headers.Authorization) next.Authorization = headers.Authorization;

  const resp = await authFetch(`${API_CONFIG.BASE_URL}/api/v1/models`, {
    headers: next,
  });
  if (!resp.ok) {
    throw new Error(`模型清单请求失败（HTTP ${resp.status}）`);
  }
  const body = (await resp.json()) as {
    code?: number;
    data?: ModelsPayload;
  };
  return body.data?.models ?? [];
}

/** 模型清单 hook（失败降级为空列表；refresh 手动刷新） */
export function useAgentModels() {
  const [models, setModels] = useState<AgentModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = async (force = false) => {
    setLoading(true);
    try {
      const items = await fetchAgentModels();
      if (mountedRef.current) setModels(items);
    } catch {
      if (mountedRef.current && !force) setModels([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { models, loading, refresh: () => load(true) };
}

// ---------------------------------------------------------------------------
// 会话持久化 REST（/api/v1/sessions）
// ---------------------------------------------------------------------------

async function sessionsFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = getCommonHeaders();
  const next: Record<string, string> = { "Content-Type": headers["Content-Type"] };
  if (headers.Authorization) next.Authorization = headers.Authorization;
  if (init?.body) next["Content-Type"] = "application/json";
  return authFetch(`${API_CONFIG.BASE_URL}/api/v1/sessions${path}`, {
    ...init,
    headers: next,
  });
}

async function unwrap<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    throw new Error(`sessions API HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as { code?: number; message?: string; data?: T };
  if (body.code !== 0) {
    throw new Error(body.message || `sessions API code=${body.code}`);
  }
  return (body.data ?? ({} as T)) as T;
}

// ---------------------------------------------------------------------------
// 会话工作空间附件（/api/v1/uploads、/api/v1/sessions/{sid}/files、/api/v1/files/*）
// ---------------------------------------------------------------------------

/** agent_session_file 目录行（前端关心的字段） */
export interface AgentWorkspaceFile {
  file_id: string;
  session_id: string | null;
  kind: "file" | "image";
  origin: "upload" | "agent";
  name: string;
  mime: string;
  size: number;
  parse_status: "pending" | "parsing" | "ready" | "failed";
  parse_error?: string | null;
  md_chars?: number;
  asset_count?: number;
}

async function filesFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = getCommonHeaders();
  // 合并调用方 headers（如 asset-urls 的 JSON Content-Type）而非整体覆盖
  const next: Record<string, string> = {};
  if (headers.Authorization) next.Authorization = headers.Authorization;
  const extra = init?.headers as Record<string, string> | undefined;
  if (extra) {
    for (const [k, v] of Object.entries(extra)) next[k] = v;
  }
  return authFetch(`${API_CONFIG.BASE_URL}${path}`, { ...init, headers: next });
}

/**
 * 上传一个附件进工作空间。
 * sessionId 为空 = 临时区（首条消息前上传，后端 start 帧时绑定归位，D1）；
 * 有会话则直接进会话工作空间。
 */
export async function uploadAgentAttachment(
  sessionId: string | null,
  file: File,
): Promise<AgentWorkspaceFile> {
  const form = new FormData();
  form.append("file", file);
  const path = sessionId
    ? `/api/v1/sessions/${encodeURIComponent(sessionId)}/files`
    : "/api/v1/uploads";
  const resp = await filesFetch(path, { method: "POST", body: form });
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* keep */
    }
    throw new Error(detail);
  }
  const body = (await resp.json()) as { code?: number; message?: string; data?: AgentWorkspaceFile };
  if (body.code !== 0 || !body.data) throw new Error(body.message || "上传失败");
  return body.data;
}

/** 查询单个附件元数据（chip 轮询解析状态用，D15 纯轮询） */
export async function fetchAgentFile(fileId: string): Promise<AgentWorkspaceFile> {
  const resp = await filesFetch(`/api/v1/files/${encodeURIComponent(fileId)}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const body = (await resp.json()) as { code?: number; data?: AgentWorkspaceFile };
  if (body.code !== 0 || !body.data) throw new Error("文件查询失败");
  return body.data;
}

/** 会话工作区完整清单（上传 + agent 产物同列，D20 统一视图） */
export async function listAgentSessionFiles(
  sessionId: string,
): Promise<AgentWorkspaceFile[]> {
  const resp = await filesFetch(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}/files`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const body = (await resp.json()) as {
    code?: number;
    data?: { items?: AgentWorkspaceFile[] };
  };
  if (body.code !== 0) throw new Error("工作区清单获取失败");
  return body.data?.items ?? [];
}

/** 文档类附件的解析产物 markdown（工作区面板展开渲染用） */
export async function fetchAgentFileMarkdown(fileId: string): Promise<string> {
  const resp = await filesFetch(
    `/api/v1/files/${encodeURIComponent(fileId)}/markdown`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const body = (await resp.json()) as {
    code?: number;
    data?: { markdown?: string };
  };
  if (body.code !== 0 || !body.data) throw new Error("解析产物获取失败");
  return body.data.markdown ?? "";
}

/** md 内图片资产批量换 presigned URL（D14：渲染前替换相对引用） */
export async function fetchAgentAssetUrls(
  fileId: string,
): Promise<Record<string, string>> {
  const resp = await filesFetch(
    `/api/v1/files/${encodeURIComponent(fileId)}/asset-urls`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: [] }),
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const body = (await resp.json()) as {
    code?: number;
    data?: { urls?: Record<string, string> };
  };
  if (body.code !== 0) throw new Error("资产 URL 获取失败");
  return body.data?.urls ?? {};
}

/** 删除附件（软删） */
export async function deleteAgentAttachment(fileId: string): Promise<void> {
  const resp = await filesFetch(`/api/v1/files/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

/**
 * 取附件原始内容的 blob URL（鉴权 fetch 后本地建链——<img> 带不了
 * Authorization 头，图片缩略图/点击查看用）。
 */
export async function fetchAgentFileBlobUrl(fileId: string): Promise<string> {
  const resp = await filesFetch(`/api/v1/files/${encodeURIComponent(fileId)}/raw`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  return URL.createObjectURL(blob);
}

/** 取附件原始文本（工作区预览的代码/文本视图用，鉴权直读） */
export async function fetchAgentFileText(fileId: string): Promise<string> {
  const resp = await filesFetch(`/api/v1/files/${encodeURIComponent(fileId)}/raw`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.text();
}

export async function createAgentSession(input?: {
  title?: string;
  model?: string | null;
  thinking_level?: string;
}): Promise<AgentSessionInfo> {
  const resp = await sessionsFetch("", {
    method: "POST",
    body: JSON.stringify({
      title: input?.title ?? "新会话",
      model: input?.model ?? null,
      thinking_level: input?.thinking_level ?? "off",
    }),
  });
  return unwrap<AgentSessionInfo>(resp);
}

export async function listAgentSessions(
  page = 1,
  pageSize = 50,
): Promise<AgentSessionListResponse> {
  const resp = await sessionsFetch(`?page=${page}&page_size=${pageSize}`);
  return unwrap<AgentSessionListResponse>(resp);
}

export async function renameAgentSession(
  sessionId: string,
  title: string,
): Promise<AgentSessionInfo> {
  const resp = await sessionsFetch(`/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  return unwrap<AgentSessionInfo>(resp);
}

export async function deleteAgentSession(sessionId: string): Promise<void> {
  const resp = await sessionsFetch(`/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
  await unwrap<unknown>(resp);
}

export async function listAgentMessages(
  sessionId: string,
  page = 1,
  pageSize = 100,
): Promise<AgentMessageListResponse> {
  const resp = await sessionsFetch(
    `/${encodeURIComponent(sessionId)}/messages?page=${page}&page_size=${pageSize}`,
  );
  return unwrap<AgentMessageListResponse>(resp);
}

export async function clearAgentMessages(sessionId: string): Promise<void> {
  const resp = await sessionsFetch(`/${encodeURIComponent(sessionId)}/messages`, {
    method: "DELETE",
  });
  await unwrap<unknown>(resp);
}
