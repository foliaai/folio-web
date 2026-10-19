"use client";

import { useEffect, useState } from "react";
import { createKnowledgeBase } from "@/lib/api/knowledge";
import type { KnowledgeBaseInfo } from "@/lib/knowledge-types";
import { cn } from "@/lib/utils";
import { Globe, Loader2, User, Users, X } from "lucide-react";

/**
 * 新建知识库对话框：名称 + 可见性（个人 / 共享 / 订阅）。
 *
 * "团队"对用户只是知识库的一种可见性：不选团队、不建团队——
 * 创建团队库时后端自动生成 1:1 成员组（D12），创建者即负责人，
 * 成员经库行「成员管理」邀请/管理（TeamMembersDialog）。
 *
 * - 订阅（后端值仍为 public）：所有登录用户可读；canCreatePublic=false（prd 公网仅管理员）时隐藏该选项
 * - Escape 关闭、焦点可见（ui-ux-pro-max：模态控件焦点指示）
 */

type Visibility = "private" | "team" | "public";

const VISIBILITY_OPTIONS: Array<{
  value: Visibility;
  label: string;
  icon: typeof User;
  hint: string;
}> = [
  { value: "private", label: "个人", icon: User, hint: "仅自己可见" },
  { value: "team", label: "共享", icon: Users, hint: "邀请成员共同读写" },
  { value: "public", label: "订阅", icon: Globe, hint: "所有登录用户可读" },
];

export function CreateKbDialog({
  canCreatePublic,
  onClose,
  onCreated,
}: {
  /** 后端 permissions.can_create_public；false 时隐藏公共选项 */
  canCreatePublic: boolean;
  onClose: () => void;
  onCreated: (kb: KnowledgeBaseInfo) => void;
}) {
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const options = VISIBILITY_OPTIONS.filter(
    (option) => option.value !== "public" || canCreatePublic
  );

  const canConfirm = name.trim().length > 0 && !busy;

  const handleConfirm = async () => {
    try {
      setBusy(true);
      setError(null);
      const kb = await createKnowledgeBase({
        knowledge_base_name: name.trim(),
        parent_knowledge_base_id: null,
        visibility,
      });
      onCreated(kb);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建知识库失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/30 px-4 pb-4 backdrop-blur-sm sm:items-center sm:pb-0">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="新建知识库"
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-medium text-foreground">新建知识库</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-muted transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
            aria-label="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <label htmlFor="kb-name" className="mb-1.5 block text-xs font-medium text-muted">
          名称
        </label>
        <input
          id="kb-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={255}
          placeholder="请输入知识库名称"
          onKeyDown={(e) => {
            if (e.key === "Enter" && canConfirm && !e.nativeEvent.isComposing) {
              void handleConfirm();
            }
          }}
          className="mb-4 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
        />

        <span className="mb-1.5 block text-xs font-medium text-muted">可见性</span>
        <div role="radiogroup" aria-label="可见性" className="mb-3 grid grid-cols-3 gap-2">
          {options.map((option) => {
            const active = visibility === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setVisibility(option.value)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary cursor-pointer",
                  active
                    ? "border-primary bg-primary/[0.06] text-primary"
                    : "border-gray-200 text-muted hover:text-foreground"
                )}
              >
                <option.icon className="h-4 w-4" aria-hidden="true" />
                <span className="text-xs font-medium">{option.label}</span>
                <span className="text-[10px] leading-3 text-muted-faint">
                  {option.hint}
                </span>
              </button>
            );
          })}
        </div>

        {visibility === "team" ? (
          <p className="mb-3 rounded-xl bg-primary/[0.04] px-3 py-2 text-xs leading-relaxed text-muted">
            创建后可通过知识库行上的「成员管理」邀请同事（内网支持一键邀请同部门成员）。
          </p>
        ) : null}

        {error ? (
          <p className="mb-3 text-xs text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-9 rounded-xl border border-gray-200 px-4 text-sm text-muted transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!canConfirm}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
