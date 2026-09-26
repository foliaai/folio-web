"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { useAuth } from "@/components/auth/AuthProvider";
import { getAuthProvider, getAuthProviderLabel } from "@/lib/auth-providers";

export default function CallbackPage() {
  const router = useRouter();
  const { completeLogin } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // 授权码一次性、PKCE state 全页仅一份：回调必须整页只处理一次，
  // StrictMode 双执行与 completeLogin 引用变化都不得重入。
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const run = async () => {
      try {
        const { session, nextPath } = await getAuthProvider().handleCallback(
          new URLSearchParams(window.location.search)
        );

        completeLogin(session);
        router.replace(nextPath);
      } catch (callbackError) {
        setError(
          callbackError instanceof Error
            ? callbackError.message
            : "处理登录回调失败"
        );
      }
    };

    void run();
    // 依赖必须为空，否则 completeLogin 引用变化会触发重入（见 handledRef 注释）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-md rounded-[28px] border border-gray-200 bg-white p-8 text-center shadow-2xl">
        {error ? (
          <>
            <AlertCircle className="mx-auto h-10 w-10 text-red-500" />
            <h1 className="mt-4 text-2xl font-bold text-foreground">登录回调失败</h1>
            <p className="mt-3 text-sm leading-6 text-muted">{error}</p>
            <button
              type="button"
              onClick={() => router.replace("/login")}
              className="mt-6 inline-flex items-center justify-center rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-white shadow-md shadow-primary/20 hover:bg-primary-light transition-colors"
            >
              返回登录页
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="mx-auto h-10 w-10 animate-spin text-primary" />
            <h1 className="mt-4 text-2xl font-bold text-foreground">正在完成登录</h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              正在与 {getAuthProviderLabel()} 交换令牌并恢复你的登录态，请稍候。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
