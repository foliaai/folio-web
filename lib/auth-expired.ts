/**
 * 登录凭证过期的统一出口。
 *
 * 两条触发路径汇到这里：
 * - 响应式：任意 API 返回 401（lib/api/http.ts authFetch、知识库 XHR 上传）
 * - 主动式：AuthProvider 启动/周期检查、WebSocket 断连时检查 JWT exp
 */
import { clearAuthSession } from "@/lib/auth";

/** 登录流程自身的页面：这些页面上的 401 属于正常态，跳转会死循环 */
const AUTH_FLOW_PATHS = ["/login", "/callback"];

/** 解码 JWT payload 取 exp（秒级时间戳）。非 JWT / 缺 exp 返回 null，调用方按未知处理 */
export function getTokenExpiry(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/** 时钟偏差留 30 秒余量：略早于服务端判定就视为过期，避免拿将死 token 发请求 */
export function isTokenExpired(token: string | null | undefined): boolean {
  if (!token) return false;
  const exp = getTokenExpiry(token);
  if (exp == null) return false;
  return Date.now() / 1000 > exp - 30;
}

let redirecting = false;

/**
 * 清本地凭证并整页跳回登录页。幂等：并发 401 只触发一次跳转。
 *
 * 不复用 AuthProvider.logout：那会先跳 IdP 登出端点（Logto end_session / OA 中台），
 * 过期场景凭证已无效，本地清理后直接回 /login 即可。
 */
export function handleAuthExpired(): void {
  if (typeof window === "undefined") return;
  if (redirecting) return;

  const { pathname, search } = window.location;
  if (AUTH_FLOW_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return;
  }

  redirecting = true;
  clearAuthSession();

  const params = new URLSearchParams();
  params.set("next", pathname + search);
  params.set("expired", "1");
  window.location.assign(`/login?${params.toString()}`);
}
