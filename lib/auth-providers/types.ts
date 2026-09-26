/**
 * 登录 Provider 统一接口
 *
 * 不同部署可通过 NEXT_PUBLIC_AUTH_PROVIDER 选择不同登录方式
 * （logto=公网部署 / oa=企业内部部署），所有 Provider 实现同一接口，
 * 产出同一 AuthSession，上层 AuthProvider / callback 页面无需感知差异。
 */
import { AuthSession } from "@/lib/auth";

export interface AuthCallbackResult {
  session: AuthSession;
  nextPath: string;
}

export interface AuthProviderClient {
  /** 登录方式展示名（登录页文案用） */
  readonly label: string;

  /** 发起登录跳转，nextPath 为登录成功后要回到的路径 */
  startSignIn(nextPath?: string): Promise<void>;

  /** 处理登录回调（/callback?code=...&state=...），返回会话与去向 */
  handleCallback(search: URLSearchParams): Promise<AuthCallbackResult>;

  /** 构造登出跳转地址 */
  buildLogoutUrl(idToken?: string): Promise<string>;
}
