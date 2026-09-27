"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  AuthSession,
  AuthUser,
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
