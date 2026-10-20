/**
 * API 层统一 fetch 出口：唯一的职责是在凭证失效（401）时触发全局登出跳转。
 *
 * 请求头（Authorization 等）仍由各模块的 buildHeaders / getCommonHeaders 组装，
 * 本包装不碰 init，原样透传。401 时照常返回 Response，调用方原有的
 * throw / 静默降级逻辑不变——跳转随后发生，错误分支只是兜底。
 *
 * 例外：登录流程（lib/auth-providers/*）的接口不走这里，未认证是它们的正常态。
 */
import { handleAuthExpired } from "@/lib/auth-expired";

export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401) {
    handleAuthExpired();
  }
  return response;
}
