/**
 * 企业 OA 登录 Provider（内部部署，NEXT_PUBLIC_AUTH_PROVIDER=oa）
 *
 * 流程（OA 授权码模式，access_token 全程只在后端）：
 * 1. startSignIn: 302 跳转 OA SSO 授权页（scope=snsapi_base，无感授权）
 *    https://oasso.jiepei.com/connect/authorize?scope=snsapi_base&agentid=X
 *        &state=STATE&redirect_url=REDIRECT_URI
 * 2. OA 回调 redirect_url?code=CODE&state=STATE
 * 3. handleCallback: 校验 state 后，拿 code 调后端 /api/auth/oa/login，
 *    由后端完成 code 换用户信息并签发本域 JWT，前端仅持有最终 JWT
 */
import { AuthSession, AuthUser } from "@/lib/auth";
import { authApiUrl } from "@/lib/config";
import { AuthCallbackResult, AuthProviderClient } from "./types";

interface OALoginUserData {
  user_id: string;
  employee_no?: string | null;
  employee_id?: number | null;
  name?: string | null;
  alias_name?: string | null;
  role?: string | null;
  /** 自定义头像 URL（MinIO + avatar_url，无则为空） */
  avatar?: string | null;
}

interface OALoginResponseData {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  user: OALoginUserData;
}

interface OALoginResponse {
  code?: number;
  message?: string;
  data?: OALoginResponseData;
}

interface OaPendingState {
  state: string;
  nextPath: string;
}

const OA_PENDING_STATE_KEY = "ai_site_oa_sso_pending";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
}

function getRedirectUri(): string {
  return process.env.NEXT_PUBLIC_OA_REDIRECT_URI || `${getBaseUrl()}/callback`;
}

function getAuthorizeEndpoint(): string {
  return (
    process.env.NEXT_PUBLIC_OA_SSO_AUTHORIZE_URL ||
    "https://oasso.jiepei.com/connect/authorize"
  );
}

/**
 * OA 中台单点登出端点（可选）。
 * 作用：登出时清掉浏览器里 .jiepei.com 域的 WuJiAppAuthbtns 会话，
 * 使得"主动登出 → 下次登录必须重新扫码"成立。
 * 现状：中台暂未提供该端点（oasso/无极均无可发现的 logout 路径），
 * 留空时登出仅清本域会话，下次登录会被 OA 静默授权免扫码恢复。
 */
function getSsoLogoutUrl(): string | null {
  return process.env.NEXT_PUBLIC_OA_SSO_LOGOUT_URL || null;
}

function getPostLogoutRedirectUri(): string {
  return `${getBaseUrl()}/login`;
}

function getAgentId(): string {
  const agentId = process.env.NEXT_PUBLIC_OA_AGENT_ID;

  if (!agentId) {
    throw new Error("缺少 NEXT_PUBLIC_OA_AGENT_ID 配置");
  }

  return agentId;
}

function getLoginEndpoint(): string {
  // 登录走 folio-auth-server（Next.js rewrite 同源转发，无 CORS）
  return authApiUrl("/auth/oa/login");
}

function randomString(length = 48): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

function savePendingState(state: OaPendingState): void {
  sessionStorage.setItem(OA_PENDING_STATE_KEY, JSON.stringify(state));
}

function loadPendingState(): OaPendingState | null {
  const raw = sessionStorage.getItem(OA_PENDING_STATE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as OaPendingState;
  } catch {
    return null;
  }
}

function clearPendingState(): void {
  sessionStorage.removeItem(OA_PENDING_STATE_KEY);
}

function toAuthUser(data: OALoginUserData): AuthUser {
  // 服务端已完成 Name(AlisName) 组合并优先库内自定义昵称；此处仅做工号兜底
  const displayName = data.name || data.employee_no || data.user_id;

  return {
    id: data.user_id,
    user_id: data.user_id,
    sub: data.user_id,
    name: displayName,
    username: data.employee_no || data.user_id,
    preferred_username: displayName,
    avatar: data.avatar || undefined,
    picture: data.avatar || undefined,
    role: data.role || "user",
  };
}

async function requestLogin(code: string): Promise<AuthSession> {
  let response: Response;

  try {
    response = await fetch(getLoginEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code }),
    });
  } catch {
    throw new Error("OA 登录请求失败，请检查网络后重试");
  }

  const payload = (await response.json().catch(() => null)) as
    | (OALoginResponse & { detail?: string })
    | null;

  if (!response.ok || !payload?.data?.access_token) {
    // 服务端错误可能是 ApiResponse.message，也可能是 FastAPI 的 detail
    throw new Error(
      payload?.message ||
        payload?.detail ||
        `OA 登录失败 (HTTP ${response.status})，请重新发起登录`
    );
  }

  const data = payload.data;

  return {
    accessToken: data.access_token,
    scope: data.token_type || "bearer",
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    user: toAuthUser(data.user),
  };
}

export const oaAuthProvider: AuthProviderClient = {
  label: "企业 OA",

  async startSignIn(nextPath = "/"): Promise<void> {
    if (!isBrowser()) return;

    const state = randomString(32);

    savePendingState({ state, nextPath });

    const url = new URL(getAuthorizeEndpoint());
    url.searchParams.set("scope", "snsapi_base");
    url.searchParams.set("agentid", getAgentId());
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_url", getRedirectUri());

    window.location.assign(url.toString());
  },

  async handleCallback(search: URLSearchParams): Promise<AuthCallbackResult> {
    const code = search.get("code");
    const returnedState = search.get("state");
    const error = search.get("error");
    const errorDescription = search.get("error_description");

    if (error) {
      throw new Error(errorDescription || `OA 登录失败: ${error}`);
    }

    if (!code || !returnedState) {
      throw new Error("回调参数不完整，缺少 code 或 state");
    }

    const pendingState = loadPendingState();
    if (!pendingState) {
      throw new Error("登录状态已丢失，请重新发起登录");
    }

    if (pendingState.state !== returnedState) {
      clearPendingState();
      throw new Error("登录状态校验失败，请重新登录");
    }

    clearPendingState();

    const session = await requestLogin(code);

    return {
      session,
      nextPath: pendingState.nextPath || "/",
    };
  },

  async buildLogoutUrl(): Promise<string> {
    // 配置了中台登出端点 → 跳过去清 OA 会话后回到 /login（重新登录需扫码）
    const logoutUrl = getSsoLogoutUrl();
    if (logoutUrl) {
      const url = new URL(logoutUrl);
      // 参数名沿用中台 authorize 的 redirect_url 约定；中台若用别的名字按其文档调整
      url.searchParams.set("redirect_url", getPostLogoutRedirectUri());
      return url.toString();
    }
    // 未配置：仅清本域会话。OA snsapi_base 静默授权会保留，
    // 下次登录免扫码恢复（配合 AuthProvider 的登出标记，不会被自动弹回）
    return "/login";
  },
};
