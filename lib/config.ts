/**
 * 应用配置
 * 包含 API、认证等全局配置
 */
import { getAuthSession, getAuthToken, getAuthUser } from "@/lib/auth";

// 获取 API 版本前缀（支持空字符串，自动处理斜杠）
function getApiVersion(): string {
  const version = process.env.NEXT_PUBLIC_API_VERSION;
  
  // 如果环境变量已定义
  if (typeof version !== 'undefined') {
    // 如果是空字符串，直接返回
    if (version === '') {
      return '';
    }
    // 确保以 / 开头
    return version.startsWith('/') ? version : `/${version}`;
  }
  
  // 默认值
  return "/api/v1";
}

// API 配置
export const API_CONFIG = {
  BASE_URL: process.env.NEXT_PUBLIC_API_URL || "",
  VERSION: getApiVersion(),
  TIMEOUT: 30000, // 30 秒超时
};

// 认证配置
export const AUTH_CONFIG = {
  COOKIE_NAME: process.env.NEXT_PUBLIC_AUTH_COOKIE_NAME || "ai_site_auth_token",
  MOCK_USER_ID: process.env.NEXT_PUBLIC_MOCK_USER_ID || "user_demo_001",
};

/**
 * 认证服务 API 地址（登录 / 用户资料 / 全局设置，由 folio-auth-server 提供）。
 * 走 Next.js rewrite（/auth-api -> :8003/api），同源无 CORS。
 * path 形如 "/auth/oa/login"、"/user/profile"。
 */
export function authApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `/auth-api${normalizedPath}`;
}

function resolveUserId(): string | null {
  const sessionUser = getAuthSession()?.user;
  if (sessionUser?.id) return sessionUser.id;
  if (sessionUser?.user_id) return sessionUser.user_id;
  if (sessionUser?.sub) return sessionUser.sub;

  const authUser = getAuthUser();
  if (authUser?.id) return authUser.id;
  if (authUser?.user_id) return authUser.user_id;
  if (authUser?.sub) return authUser.sub;

  return null;
}

/**
 * 获取当前用户 ID
 */
export function getCurrentUserId(): string {
  return resolveUserId() || AUTH_CONFIG.MOCK_USER_ID;
}

/**
 * 获取 query 通道（WS / react-pdf / img 直读）使用的鉴权 token。
 *
 * 这些通道无法自定义请求头，只能把凭证放进 URL。
 * 登录已统一走 folio-auth-server：两种模式签发的都是本域 JWT，
 * 优先带 accessToken；仅在未登录（访客流程）时降级为明文 user_id
 * （后端过渡期兼容该通道，见 folio-auth-core 的 header_passthrough）。
 */
export function getQueryAuthToken(): string {
  return getAuthToken() || getCurrentUserId();
}

/**
 * 推导知识库对话 WebSocket 的连接 URL。
 *
 * 规则：
 * - 优先用 NEXT_PUBLIC_CHAT_WS_URL（允许部署时显式覆盖完整 URL，含协议）
 * - 其次基于 API_CONFIG.BASE_URL 推导：http(s) -> ws(s)
 * - 兜底：基于 window.location.origin（同源部署）
 * - 自动追加 ?token=<accessToken|user_id> 用于鉴权（与后端 query token 通道一致）
 */
export function getChatWsUrl(path: string = "/api/chat/ws"): string {
  const token = getQueryAuthToken();
  const explicit = process.env.NEXT_PUBLIC_CHAT_WS_URL;

  let baseUrl: string;
  if (explicit && explicit.trim().length > 0) {
    baseUrl = explicit;
  } else if (API_CONFIG.BASE_URL) {
    baseUrl = API_CONFIG.BASE_URL;
  } else if (typeof window !== "undefined") {
    baseUrl = window.location.origin;
  } else {
    baseUrl = "http://localhost:8000";
  }

  let wsUrl = baseUrl;
  if (wsUrl.startsWith("https://")) {
    wsUrl = "wss://" + wsUrl.slice("https://".length);
  } else if (wsUrl.startsWith("http://")) {
    wsUrl = "ws://" + wsUrl.slice("http://".length);
  } else if (!wsUrl.startsWith("ws://") && !wsUrl.startsWith("wss://")) {
    wsUrl = `ws://${wsUrl}`;
  }

  wsUrl = wsUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  const separator = normalizedPath.includes("?") ? "&" : "?";
  return `${wsUrl}${normalizedPath}${separator}token=${encodeURIComponent(token)}`;
}

/**
 * 获取 API 请求的通用请求头
 */
export function getCommonHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-User-Id": getCurrentUserId(),
  };

  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}
