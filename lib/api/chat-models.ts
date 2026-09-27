/**
 * 知识库对话 — 模型选择器 API
 *
 * 后端契约：`GET /api/chat/models` → ApiResponse<{ models: ChatModelItem[] }>
 *
 * 关键点：
 * - 前端只关心 `id / label / provider`；后端不会下发能力 / 价格 / preset 等字段
 * - 列表来自当前档案 `visible` 白名单与网关库存的交集，失败或空列表就展示空
 */

import { useEffect, useRef, useState } from "react";

import { API_CONFIG, getCommonHeaders } from "@/lib/config";
import type { ApiResponse } from "@/lib/knowledge-types";

const CHAT_API_PREFIX = process.env.NEXT_PUBLIC_CHAT_API_PREFIX ?? "";

/** 与后端 `ChatModelItem` 对齐 */
export interface ChatModelItem {
  /** LiteLLM 模型字符串（同时是 chat WebSocket `model` 字段的入参） */
  id: string;
  /** UI 友好名（去掉 provider 前缀） */
  label: string;
  /** Provider 名（用于按 provider 分组） */
  provider: string;
  /** 模型是否支持思考链 / reasoning（前端据此控制思考档位下拉显隐） */
  supports_thinking?: boolean;
  /** 该模型支持的思考档位（pi 标准 7 档子集）。
   *  不支持思考：['off']；只支持开关：['off', 'medium']；支持强度：多个非 off 档。
   *  前端据此渲染开关或 Effort 下拉。 */
  thinking_levels?: string[];
  /** 新建会话时默认选中的档位（必须在 thinking_levels 内）；supports_thinking=false 时为 null */
  default_thinking_level?: string | null;
  /** 模型是否支持多模态读图（前端据此控制多模态 Chip 显隐） */
  supports_multimodal?: boolean;
  /** 模型最大上下文长度（tokens，来自后端 config/long_context_models.json）；null 表示未声明 */
  max_context?: number | null;
}

export interface ChatModelListPayload {
  models: ChatModelItem[];
}

function buildHeaders(): HeadersInit {
  const defaults = getCommonHeaders();
  const next: Record<string, string> = {
    "Content-Type": defaults["Content-Type"],
  };
  if (defaults.Authorization) next.Authorization = defaults.Authorization;
  return next;
}

function buildUrl(path: string): string {
  return `${API_CONFIG.BASE_URL}${CHAT_API_PREFIX}${path}`;
}

/**
 * 拉取当前 LiteLLM Proxy 路由的全部 chat 模型。
 *
 * @param signal AbortSignal - 调用方组件卸载时取消请求
 * @returns 排序后的模型列表（provider 升序、同 provider 内 label 升序）
 * @throws 请求非 2xx / 解析失败时抛错；调用方应自行兜底
 */
export async function fetchChatModels(
  signal?: AbortSignal,
): Promise<ChatModelItem[]> {
  const response = await fetch(buildUrl("/api/chat/models"), {
    method: "GET",
    headers: buildHeaders(),
    signal,
  });
  if (!response.ok) {
    throw new Error(`fetchChatModels HTTP ${response.status}`);
  }
  const text = await response.text();
  if (!text) {
    return [];
  }
  let payload: ApiResponse<ChatModelListPayload> | ChatModelListPayload;
  try {
    payload = JSON.parse(text) as
      | ApiResponse<ChatModelListPayload>
      | ChatModelListPayload;
  } catch {
    throw new Error("fetchChatModels 响应解析失败");
  }
  const data =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as ApiResponse<ChatModelListPayload>).data
      : (payload as ChatModelListPayload);
  return data?.models ?? [];
}

/** 按 provider 分组（保持后端给出的排序） */
export function groupChatModelsByProvider(
  items: ChatModelItem[],
): Array<{ provider: string; items: ChatModelItem[] }> {
  const map = new Map<string, ChatModelItem[]>();
  for (const it of items) {
    const list = map.get(it.provider) ?? [];
    list.push(it);
    map.set(it.provider, list);
  }
  return Array.from(map.entries()).map(([provider, items]) => ({
    provider,
    items,
  }));
}

// ---------------------------------------------------------------------------
// React 共享 Hook：模型清单
// ---------------------------------------------------------------------------

export interface UseChatModelsResult {
  models: ChatModelItem[];
  loading: boolean;
  /** 接口失败时为 true；空列表不算失败 */
  errored: boolean;
}

/**
 * 拉取并缓存 chat 模型清单（页面级单例）。
 *
 * 进程内只发一次请求；失败或空列表都保持空数组，不使用本地写死清单。
 */
let _modelsPromise: Promise<ChatModelItem[]> | null = null;

function ensureChatModelsPromise(): Promise<ChatModelItem[]> {
  if (!_modelsPromise) {
    _modelsPromise = fetchChatModels();
  }
  return _modelsPromise;
}

export function useChatModels(): UseChatModelsResult {
  const [models, setModels] = useState<ChatModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    ensureChatModelsPromise()
      .then((items) => {
        if (cancelledRef.current) return;
        setModels(items);
        setErrored(false);
      })
      .catch(() => {
        if (cancelledRef.current) return;
        setModels([]);
        setErrored(true);
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false);
      });
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  return { models, loading, errored };
}

/** 测试 / 调试用：清空内部缓存，下次调用 useChatModels 会重新拉取 */
export function _resetChatModelsCacheForTest(): void {
  _modelsPromise = null;
}
