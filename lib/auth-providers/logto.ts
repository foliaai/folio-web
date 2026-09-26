/**
 * Logto 登录 Provider（公网部署，NEXT_PUBLIC_AUTH_PROVIDER=logto）
 *
 * 流程（授权码 + PKCE，token 交换全部在服务端）：
 * 1. startSignIn: 生成 PKCE 并 302 跳转 Logto 授权页（code_challenge=S256）
 * 2. Logto 回调 redirect_uri?code=CODE&state=STATE
 * 3. handleCallback: 校验 state 后，把 code + code_verifier 交给
 *    folio-auth-server（POST /auth-api/auth/logto/login），由服务端完成：
 *      - Logto token 端点换 id_token / access_token（前端不经手）
 *      - id_token 验签 + userinfo 拉取（权威身份）
 *      - 换发本域 RS256 JWT 返回前端
 * 4. 前端仅持有本域 JWT，后续请求统一 Authorization: Bearer <本域JWT>
 *
 * 安全收益：修复此前"前端直接持有 Logto access_token 充当本域凭证 +
 * 后端裸信 X-User-Id"的透传漏洞。
 */
import { AuthSession, AuthUser } from "@/lib/auth";
import { authApiUrl } from "@/lib/config";
import { AuthCallbackResult, AuthProviderClient } from "./types";

interface OpenIdConfiguration {
  authorization_endpoint: string;
  end_session_endpoint?: string;
  issuer: string;
}

interface PkceState {
  codeVerifier: string;
  state: string;
  nextPath: string;
}

/** folio-auth-server /api/auth/logto/login 返回的用户信息 */
interface LoginUserData {
  user_id: string;
  name?: string | null;
  role?: string | null;
  employee_no?: string | null;
  employee_id?: number | null;
  alias_name?: string | null;
  email?: string | null;
  avatar?: string | null;
}

interface LoginResponseData {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  user: LoginUserData;
}

interface LoginResponse {
  code?: number;
  message?: string;
  data?: LoginResponseData;
}

const PKCE_STORAGE_KEY = "ai_site_logto_pkce";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
}

function getRedirectUri(): string {
  return (
    process.env.NEXT_PUBLIC_LOGTO_REDIRECT_URI || `${getBaseUrl()}/callback`
  );
}

function getPostLogoutRedirectUri(): string {
  return process.env.NEXT_PUBLIC_LOGTO_POST_LOGOUT_REDIRECT_URI || getBaseUrl();
}

function getClientId(): string {
  const clientId = process.env.NEXT_PUBLIC_LOGTO_APP_ID;

  if (!clientId) {
    throw new Error("缺少 NEXT_PUBLIC_LOGTO_APP_ID 配置");
  }

  return clientId;
}

function getEndpoint(): string {
  const endpoint = process.env.NEXT_PUBLIC_LOGTO_ENDPOINT;

  if (!endpoint) {
    throw new Error("缺少 NEXT_PUBLIC_LOGTO_ENDPOINT 配置");
  }

  return endpoint.replace(/\/$/, "");
}

function getScopes(): string {
  return (
    process.env.NEXT_PUBLIC_LOGTO_SCOPES || "openid profile email offline_access"
  );
}

function getResource(): string | null {
  return process.env.NEXT_PUBLIC_LOGTO_RESOURCE || null;
}

function toAuthUser(data: LoginUserData): AuthUser {
  const displayName = data.name || data.email || data.user_id;

  return {
    id: data.user_id,
    user_id: data.user_id,
    sub: data.user_id,
    name: displayName,
    username: data.user_id,
    preferred_username: displayName,
    email: data.email || undefined,
    avatar: data.avatar || undefined,
    picture: data.avatar || undefined,
    role: data.role || "user",
  };
}

function randomString(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join("");
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Digest(input: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(input);
  const subtle = globalThis.crypto?.subtle;
  if (subtle?.digest) {
    try {
      return await subtle.digest("SHA-256", data);
    } catch {
      // http://IP 不是 Secure Context，subtle 会不可用或抛错
    }
  }
  return sha256Fallback(data);
}

function sha256Fallback(message: Uint8Array): ArrayBuffer {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  const bitLen = message.length * 8;
  const withPad = new Uint8Array(((message.length + 9 + 63) & ~63));
  withPad.set(message);
  withPad[message.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, bitLen >>> 0);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < withPad.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const out = new ArrayBuffer(32);
  const outView = new DataView(out);
  outView.setUint32(0, h0);
  outView.setUint32(4, h1);
  outView.setUint32(8, h2);
  outView.setUint32(12, h3);
  outView.setUint32(16, h4);
  outView.setUint32(20, h5);
  outView.setUint32(24, h6);
  outView.setUint32(28, h7);
  return out;
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
  return toBase64Url(await sha256Digest(codeVerifier));
}

async function getOpenIdConfiguration(): Promise<OpenIdConfiguration> {
  const response = await fetch(
    `${getEndpoint()}/oidc/.well-known/openid-configuration`
  );

  if (!response.ok) {
    throw new Error("无法读取 Logto OIDC 配置");
  }

  return (await response.json()) as OpenIdConfiguration;
}

function savePkceState(state: PkceState): void {
  sessionStorage.setItem(PKCE_STORAGE_KEY, JSON.stringify(state));
}

function loadPkceState(): PkceState | null {
  const raw = sessionStorage.getItem(PKCE_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as PkceState;
  } catch {
    return null;
  }
}

function clearPkceState(): void {
  sessionStorage.removeItem(PKCE_STORAGE_KEY);
}

/**
 * 把授权码交给 folio-auth-server 换发本域 JWT。
 * code / code_verifier 均一次性，Logto 的 token 只在服务端短暂存在。
 */
async function requestLogin(
  code: string,
  codeVerifier: string
): Promise<AuthSession> {
  let response: Response;

  try {
    response = await fetch(authApiUrl("/auth/logto/login"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code,
        redirect_uri: getRedirectUri(),
        code_verifier: codeVerifier,
      }),
    });
  } catch {
    throw new Error("登录请求失败，请检查认证服务后重试");
  }

  const payload = (await response.json().catch(() => null)) as
    | (LoginResponse & { detail?: string })
    | null;

  if (!response.ok || !payload?.data?.access_token) {
    // 服务端错误可能是 ApiResponse.message，也可能是 FastAPI 的 detail
    throw new Error(
      payload?.message ||
        payload?.detail ||
        `Logto 登录失败 (HTTP ${response.status})，请重新发起登录`
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

export async function startLogtoSignIn(nextPath = "/"): Promise<void> {
  if (!isBrowser()) return;

  const config = await getOpenIdConfiguration();
  const codeVerifier = randomString(96);
  const state = randomString(48);
  const codeChallenge = await createCodeChallenge(codeVerifier);

  savePkceState({
    codeVerifier,
    state,
    nextPath,
  });

  const url = new URL(config.authorization_endpoint);
  url.searchParams.set("client_id", getClientId());
  url.searchParams.set("redirect_uri", getRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", getScopes());
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  const resource = getResource();
  if (resource) {
    url.searchParams.set("resource", resource);
  }

  window.location.assign(url.toString());
}

export async function handleLogtoCallback(search: URLSearchParams): Promise<{
  session: AuthSession;
  nextPath: string;
}> {
  const code = search.get("code");
  const returnedState = search.get("state");
  const error = search.get("error");
  const errorDescription = search.get("error_description");

  if (error) {
    throw new Error(errorDescription || `Logto 登录失败: ${error}`);
  }

  if (!code || !returnedState) {
    throw new Error("回调参数不完整，缺少 code 或 state");
  }

  const pkceState = loadPkceState();
  if (!pkceState) {
    throw new Error("登录状态已丢失，请重新发起登录");
  }

  if (pkceState.state !== returnedState) {
    throw new Error("登录状态校验失败，请重新登录");
  }

  const session = await requestLogin(code, pkceState.codeVerifier);

  clearPkceState();

  return {
    session,
    nextPath: pkceState.nextPath || "/",
  };
}

export async function buildLogtoLogoutUrl(idToken?: string): Promise<string> {
  // 本域会话已由前端清除；这里仅结束 Logto 侧会话。
  // 换发本域 JWT 后前端不再持有 Logto id_token，无法带 id_token_hint，
  // Logto 会在缺少 hint 时展示确认页后完成登出。
  const config = await getOpenIdConfiguration();
  const url = new URL(
    config.end_session_endpoint || `${getEndpoint()}/oidc/session/end`
  );

  url.searchParams.set("client_id", getClientId());
  url.searchParams.set("post_logout_redirect_uri", getPostLogoutRedirectUri());

  if (idToken) {
    url.searchParams.set("id_token_hint", idToken);
  }

  return url.toString();
}

/**
 * Logto Provider 适配器（公网部署，NEXT_PUBLIC_AUTH_PROVIDER=logto）
 */
export const logtoAuthProvider: AuthProviderClient = {
  label: "Logto",
  startSignIn: startLogtoSignIn,
  handleCallback: async (search: URLSearchParams): Promise<AuthCallbackResult> =>
    handleLogtoCallback(search),
  buildLogoutUrl: buildLogtoLogoutUrl,
};
