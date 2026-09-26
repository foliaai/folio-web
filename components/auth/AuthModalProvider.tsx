"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";
import { LockKeyhole, Sparkles, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { getAuthProviderLabel } from "@/lib/auth-providers";

interface AuthModalOptions {
  title: string;
  description: string;
  nextPath?: string;
  featureLabel?: string;
}

interface AuthModalContextValue {
  openAuthModal: (options: AuthModalOptions) => void;
  closeAuthModal: () => void;
}

const AuthModalContext = createContext<AuthModalContextValue | null>(null);

export function AuthModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const { login, isReady } = useAuth();
  const [options, setOptions] = useState<AuthModalOptions | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isOpen = Boolean(options);

  const value = useMemo<AuthModalContextValue>(
    () => ({
      openAuthModal: (nextOptions) => {
        setOptions(nextOptions);
      },
      closeAuthModal: () => {
        setOptions(null);
      },
    }),
    []
  );

  const handleLogin = async () => {
    if (!options) return;

    setIsSubmitting(true);

    try {
      await login(options.nextPath || pathname);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthModalContext.Provider value={value}>
      {children}

      {isOpen && options && (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/40 px-6 backdrop-blur-sm"
          onClick={() => setOptions(null)}
          role="presentation"
        >
          <div
            className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-dark-border bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top,rgba(0,179,107,0.12),transparent_70%)]" />
            <button
              type="button"
              onClick={() => setOptions(null)}
              className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full text-muted transition hover:bg-gray-100 hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative p-7">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <LockKeyhole className="h-5 w-5" />
              </div>

              <h2 id="auth-modal-title" className="mt-5 text-2xl text-foreground">
                {options.title}
              </h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                {options.description}
              </p>

              {options.featureLabel && (
                <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-dark-border bg-dark-card px-3 py-1.5 text-xs text-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  {options.featureLabel}
                </div>
              )}

              <div className="mt-7 space-y-3">
                <button
                  type="button"
                  onClick={handleLogin}
                  disabled={!isReady || isSubmitting}
                  className="flex w-full items-center justify-center rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting
                    ? `正在跳转到 ${getAuthProviderLabel()}...`
                    : "登录 / 注册后继续"}
                </button>

                <button
                  type="button"
                  onClick={() => setOptions(null)}
                  className="flex w-full items-center justify-center rounded-2xl border border-dark-border px-4 py-3 text-sm text-foreground transition hover:bg-gray-50"
                >
                  继续先逛逛
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AuthModalContext.Provider>
  );
}

export function useAuthModal(): AuthModalContextValue {
  const context = useContext(AuthModalContext);

  if (!context) {
    throw new Error("useAuthModal must be used within AuthModalProvider");
  }

  return context;
}
