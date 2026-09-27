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
const SESSION_STORAGE_KEY =
  process.env.NEXT_PUBLIC_AUTH_SESSION_STORAGE_KEY || "ai_site_auth_session";
const COOKIE_NAME =
  process.env.NEXT_PUBLIC_AUTH_COOKIE_NAME || "ai_site_auth_token";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

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

export function setAuthSession(session: AuthSession): void {
  if (!isBrowser()) return;

  localStorage.setItem(TOKEN_STORAGE_KEY, session.accessToken);
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));

  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(
    session.accessToken
  )}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

export function clearAuthSession(): void {
  if (!isBrowser()) return;

  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(SESSION_STORAGE_KEY);
  document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
}
