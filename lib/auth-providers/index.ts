/**
 * 登录 Provider 工厂
 *
 * 通过 NEXT_PUBLIC_AUTH_PROVIDER 选择登录方式：
 * - logto（默认）: 自建 Logto OIDC，公网部署
 * - oa:           企业 OA 授权登录，内部部署
 *
 * 两个部署使用同一份代码，仅 env 配置不同。
 */
import { oaAuthProvider } from "./oa";
import { logtoAuthProvider } from "./logto";
import { AuthProviderClient } from "./types";

export type AuthProviderName = "logto" | "oa";

export type { AuthCallbackResult, AuthProviderClient } from "./types";

export function getAuthProviderName(): AuthProviderName {
  const raw = (process.env.NEXT_PUBLIC_AUTH_PROVIDER || "logto").toLowerCase();
  return raw === "oa" ? "oa" : "logto";
}

export function getAuthProvider(): AuthProviderClient {
  return getAuthProviderName() === "oa" ? oaAuthProvider : logtoAuthProvider;
}

export function getAuthProviderLabel(): string {
  return getAuthProvider().label;
}
