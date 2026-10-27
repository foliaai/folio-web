"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";

export type ConfirmAction =
  | {
      /** 需要手动输入名称二次确认的高危操作（删除知识库） */
      kind: "knowledge-base";
      title: string;
      description: string;
      confirmLabel: string;
      confirmText: string;
      dangerNote?: string;
      onConfirm: () => Promise<void>;
    }
  | {
      kind: "danger";
      title: string;
      description: string;
      confirmLabel: string;
      dangerNote?: string;
      onConfirm: () => Promise<void>;
    }
  | {
      /** 常规确认（非破坏性，如转让负责人），主色按钮 */
      kind: "default";
      title: string;
      description: string;
      confirmLabel: string;
      dangerNote?: string;
      onConfirm: () => Promise<void>;
    };

export function ConfirmModal({
  action,
  busy,
  onCancel,
}: {
  action: ConfirmAction | null;
  busy: boolean;
  onCancel: () => void;
}) {
  const [input, setInput] = useState("");

  useEffect(() => {
    setInput("");
  }, [action]);

  useEffect(() => {
    if (!action) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [action, busy, onCancel]);

  if (!action) return null;

  const requiresTypedConfirm = action.kind === "knowledge-base";
  const canConfirm = requiresTypedConfirm
    ? input.trim() === action.confirmText
    : true;
  const isDanger = action.kind !== "default";

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={
                isDanger
                  ? "flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-500"
                  : "flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"
              }
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg text-foreground">{action.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{action.description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 text-muted transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {action.dangerNote ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {action.dangerNote}
          </div>
        ) : null}

        {requiresTypedConfirm ? (
          <div className="mt-5">
            <div className="text-xs text-muted">
              请输入 <span className="font-medium text-foreground">{action.confirmText}</span>{" "}
              以确认删除。
            </div>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={action.confirmText}
              className="mt-3 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary"
            />
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-9 items-center justify-center rounded-full border border-gray-200 px-5 text-sm font-medium text-foreground transition-colors hover:border-gray-300 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canConfirm || busy}
            onClick={() => void action.onConfirm()}
            className={
              isDanger
                ? "flex h-9 items-center justify-center rounded-full bg-red-500 px-5 text-sm font-medium text-white shadow-sm transition-all hover:bg-red-400 disabled:cursor-not-allowed disabled:bg-red-500/40 disabled:shadow-none"
                : "flex h-9 items-center justify-center rounded-full bg-primary px-5 text-sm font-medium text-white shadow-sm transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            }
          >
            {busy ? "处理中..." : action.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
