"use client";

/**
 * SkillDetail — 放大卡片预览（覆盖在集市上，不切换整页）
 */

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, Wrench, Edit3, Tag, FileCode, Loader2, BookOpen, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SkillDetail as SkillDetailType } from "@/lib/api/skills";
import { resolveSkillCoverUrl } from "@/lib/api/skills";
import { SkillCover } from "@/components/skills/SkillCover";
import {
  MermaidBlock,
  isMermaidCode,
  isMermaidPre,
  mermaidCodeText,
} from "@/components/ui/MermaidBlock";

type BodyView = "preview" | "source";

function splitSkillMarkdown(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) return raw;
  const rest = raw.slice(match[0].length).trim();
  return rest || raw;
}

interface SkillDetailProps {
  skill: SkillDetailType | null;
  loading?: boolean;
  onBack: () => void;
  onEdit?: (name: string) => void;
}

export function SkillDetail({ skill, loading = false, onBack, onEdit }: SkillDetailProps) {
  const [bodyView, setBodyView] = useState<BodyView>("preview");

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onBack]);

  useEffect(() => {
    setBodyView("preview");
  }, [skill?.descriptor.name]);

  const desc = skill?.descriptor;
  const body = skill?.body ?? "";
  const files = skill?.files ?? [];
  const markdownBody = useMemo(() => splitSkillMarkdown(body), [body]);

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/30 px-4 py-6 backdrop-blur-sm sm:px-6"
      onClick={onBack}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-preview-title"
        aria-busy={loading}
        onClick={(event) => event.stopPropagation()}
        className="relative flex max-h-[min(880px,calc(100vh-3rem))] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-gray-200/90 bg-white shadow-2xl animate-fadeIn"
      >
        <button
          type="button"
          onClick={onBack}
          className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-muted shadow-xs ring-1 ring-gray-200/80 transition-colors hover:bg-white hover:text-foreground focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          aria-label="关闭预览"
        >
          <X className="h-4 w-4" />
        </button>

        {loading && !desc ? (
          <div className="flex flex-1 items-center justify-center py-24 text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">加载技能内容…</span>
          </div>
        ) : desc ? (
          <>
            <div className="shrink-0">
              <SkillCover
                name={desc.name}
                category={desc.category}
                tags={desc.tags}
                source={desc.source}
                enabled={desc.enabled}
                coverUrl={resolveSkillCoverUrl(desc.cover_url)}
                height={168}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="space-y-4 px-5 py-5 sm:px-7 sm:py-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2
                        id="skill-preview-title"
                        className="text-xl font-bold text-foreground"
                      >
                        {desc.name}
                      </h2>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          desc.source === "builtin"
                            ? "bg-emerald-50 text-primary-deep ring-1 ring-primary/20"
                            : "bg-blue-50 text-blue-700 ring-1 ring-blue-200"
                        )}
                      >
                        {desc.source === "builtin" ? "内置技能" : "自定义技能"}
                      </span>
                      {desc.version ? (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-muted-subtle">
                          v{desc.version}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-medium",
                          desc.enabled
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-gray-100 text-gray-500"
                        )}
                      >
                        {desc.enabled ? "已启用" : "已停用"}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      {desc.description || "暂无技能详细描述"}
                    </p>
                  </div>

                  {desc.deletable && onEdit ? (
                    <button
                      type="button"
                      onClick={() => onEdit(desc.name)}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-primary-light focus:outline-hidden focus:ring-2 focus:ring-primary/30"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      编辑技能
                    </button>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {desc.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700"
                    >
                      <Tag className="h-3 w-3 text-muted-subtle" />
                      {tag}
                    </span>
                  ))}
                  {desc.requires_tools?.length ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
                      <Wrench className="h-3 w-3" />
                      依赖工具: {desc.requires_tools.join(", ")}
                    </span>
                  ) : null}
                </div>

                {files.length > 0 ? (
                  <div className="flex items-center gap-2 rounded-xl border border-gray-200/70 bg-gray-50 p-3 text-xs text-muted">
                    <FileCode className="h-4 w-4 text-primary-deep" />
                    <span>附带资源文件：{files.join(", ")}</span>
                  </div>
                ) : null}

                <section>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted">
                      技能定义 (SKILL.md)
                    </h3>
                    <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50/80 p-0.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setBodyView("preview")}
                        title="预览"
                        aria-label="预览"
                        className={cn(
                          "inline-flex items-center justify-center rounded-lg p-1.5 transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary/30",
                          bodyView === "preview"
                            ? "bg-white text-primary-deep shadow-xs"
                            : "text-muted hover:text-foreground"
                        )}
                      >
                        <BookOpen className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setBodyView("source")}
                        title="源码"
                        aria-label="源码"
                        className={cn(
                          "inline-flex items-center justify-center rounded-lg p-1.5 transition-colors focus:outline-hidden focus:ring-2 focus:ring-primary/30",
                          bodyView === "source"
                            ? "bg-white text-primary-deep shadow-xs"
                            : "text-muted hover:text-foreground"
                        )}
                      >
                        <Code2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {loading ? (
                    <div className="rounded-2xl border border-gray-200/70 bg-gray-50/80 px-4 py-8 text-center text-xs text-muted">
                      正在加载正文…
                    </div>
                  ) : bodyView === "source" ? (
                    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-2xl border border-gray-200/70 bg-gray-50 p-4 font-mono text-[11px] leading-6 text-foreground sm:text-xs">
                      {body}
                    </pre>
                  ) : (
                    <div className="rounded-2xl border border-gray-200/70 bg-white px-4 py-4 sm:px-5">
                      <SkillMarkdown content={markdownBody} />
                    </div>
                  )}
                </section>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SkillMarkdown({ content }: { content: string }) {
  if (!content.trim()) {
    return <p className="text-sm text-muted">这份技能还没有可预览的 Markdown 正文。</p>;
  }

  return (
    <div className="text-sm leading-7 text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 mt-1 text-lg font-bold text-foreground first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-5 text-base font-bold text-foreground first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-4 text-sm font-semibold text-foreground first:mt-0">{children}</h3>
          ),
          p: ({ children }) => <p className="my-2 text-sm leading-7 text-foreground">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5 text-sm">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5 text-sm">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-7">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-primary/40 pl-3 text-muted">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-primary-deep underline underline-offset-2"
            >
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            if (isMermaidCode(className)) {
              return <MermaidBlock code={mermaidCodeText(children)} />;
            }
            const isBlock = Boolean(className) || String(children).includes("\n");
            if (isBlock) {
              return (
                <code className="block overflow-x-auto font-mono text-[12px] leading-6">
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[12px] text-primary-deep">
                {children}
              </code>
            );
          },
          pre: ({ children }) =>
            isMermaidPre(children) ? (
              <>{children}</>
            ) : (
              <pre className="my-3 overflow-x-auto rounded-xl bg-gray-50 p-3 ring-1 ring-gray-200">
                {children}
              </pre>
            ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-gray-200 bg-gray-50 px-2 py-1.5 font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-200 px-2 py-1.5">{children}</td>
          ),
          hr: () => <hr className="my-4 border-gray-200" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
