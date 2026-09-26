export interface AuthUser {
  id?: string;
  user_id?: string;
  sub?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  username?: string;
  email?: string;
  avatar?: string;
  picture?: string;
  preferred_username?: string;
  /** 角色（folio-auth-server 签发的本域 JWT 携带）：user / admin */
  role?: string;
}

export interface AuthSession {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  scope?: string;
  expiresAt?: number;
  user: AuthUser | null;
}

const TOKEN_STORAGE_KEY =
  process.env.NEXT_PUBLIC_AUTH_TOKEN_STORAGE_KEY || "ai_site_auth_token";
const USER_STORAGE_KEY =
  process.env.NEXT_PUBLIC_AUTH_USER_STORAGE_KEY || "ai_site_auth_user";
const SESSION_STORAGE_KEY =
  process.env.NEXT_PUBLIC_AUTH_SESSION_STORAGE_KEY || "ai_site_auth_session";
const COOKIE_NAME =
  process.env.NEXT_PUBLIC_AUTH_COOKIE_NAME || "ai_site_auth_token";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * 一次性自动登录标记（sessionStorage，每浏览器会话至多自动发起一次）。
 * /login 页据此决定是否自动跳转登录窗口：
 * - 防循环：登录失败返回 /login 时不再自动弹
 * - 登出保护：主动登出后设置此标记，避免 OA 静默授权把用户秒弹回登录态
 * - 登录成功（completeLogin）时清除，下次会话恢复自动登录
 */
export const AUTO_LOGIN_ATTEMPT_KEY = "ai_site_auto_login_attempted";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function getCookieValue(name: string): string | null {
  if (!isBrowser()) return null;

  const matched = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`));

  return matched ? decodeURIComponent(matched.split("=").slice(1).join("=")) : null;
}

export function getAuthToken(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(TOKEN_STORAGE_KEY) || getCookieValue(COOKIE_NAME);
}

export function getAuthSession(): AuthSession | null {
  if (!isBrowser()) return null;

  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function getAuthUser(): AuthUser | null {
  const session = getAuthSession();
  if (session?.user) {
    return session.user;
  }

  if (!isBrowser()) return null;

  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setAuthSession(session: AuthSession): void {
  if (!isBrowser()) return;

  localStorage.setItem(TOKEN_STORAGE_KEY, session.accessToken);
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));

  if (session.user) {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(session.user));
  } else {
    localStorage.removeItem(USER_STORAGE_KEY);
  }

  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(
    session.accessToken
  )}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

export function clearAuthSession(): void {
  if (!isBrowser()) return;

  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
  localStorage.removeItem(SESSION_STORAGE_KEY);
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
}
