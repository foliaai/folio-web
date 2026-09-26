"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  AuthSession,
  AuthUser,
  AUTO_LOGIN_ATTEMPT_KEY,
  clearAuthSession,
  getAuthSession,
  setAuthSession,
} from "@/lib/auth";
import { migrateGuestHomeConversations } from "@/lib/home-chat";
import { getAuthProvider } from "@/lib/auth-providers";

interface AuthContextValue {
  isAuthenticated: boolean;
  isReady: boolean;
  token: string | null;
  session: AuthSession | null;
  user: AuthUser | null;
  login: (nextPath?: string) => Promise<void>;
  completeLogin: (session: AuthSession) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    const storedSession = getAuthSession();
    setSession(storedSession);
    setToken(storedSession?.accessToken ?? null);
    setUser(storedSession?.user ?? null);
    setIsReady(true);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: Boolean(token),
      isReady,
      session,
      token,
      user,
      login: async (nextPath = "/") => {
        await getAuthProvider().startSignIn(nextPath);
      },
      completeLogin: (nextSession: AuthSession) => {
        // 登录成功：清除自动登录标记，下个浏览器会话恢复自动跳转
        try {
          sessionStorage.removeItem(AUTO_LOGIN_ATTEMPT_KEY);
        } catch {
          // sessionStorage 不可用时忽略
        }
        migrateGuestHomeConversations(
          nextSession.user?.id || nextSession.user?.user_id || nextSession.user?.sub
        );
        setAuthSession(nextSession);
        setSession(nextSession);
        setToken(nextSession.accessToken);
        setUser(nextSession.user);
      },
      logout: async () => {
        let logoutUrl = "/login";

        try {
          logoutUrl = await getAuthProvider().buildLogoutUrl(session?.idToken);
        } catch {
          logoutUrl = "/login";
        }

        // 登出保护：置自动登录标记，/login 不再自动重登
        // （OA snsapi_base 为静默授权，不拦截会被 OA 会话秒弹回登录态）
        try {
          sessionStorage.setItem(AUTO_LOGIN_ATTEMPT_KEY, "1");
        } catch {
          // 忽略
        }

        clearAuthSession();
        setSession(null);
        setToken(null);
        setUser(null);
        window.location.assign(logoutUrl);
      },
    }),
    [isReady, session, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
