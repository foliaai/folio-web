"use client";

/**
 * MarkdownFileView - Markdown 文件预览
 *
 * 复用 chat 同套渲染（react-markdown + GFM + remark-math + KaTeX），
 * 原文经后端 /raw 端点拉取。窄屏：内容单列、表格横向滚动。
 */

import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { AlertCircle, FileText, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useEffect, useState } from "react";

import { formatBytes } from "@/lib/utils";

interface MarkdownFileViewProps {
  fileName: string;
  fileSize?: number | null;
  previewUrl: string;
}

export function MarkdownFileView({
  fileName,
  fileSize,
  previewUrl,
}: MarkdownFileViewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    fetch(previewUrl)
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return resp.text();
      })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Markdown 原文加载失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2.5">
        <FileText className="h-4 w-4 shrink-0 text-muted" />
        <span className="truncate text-sm text-foreground">{fileName}</span>
        {fileSize ? (
          <span className="shrink-0 text-xs text-muted">
            {formatBytes(fileSize)}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-xs text-muted">Markdown</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-gray-100">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center p-8">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <p className="mt-2 text-sm text-muted">Markdown 预览加载失败：{error}</p>
          </div>
        ) : content === null ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
            <span className="ml-2 text-sm text-muted">正在加载文档...</span>
          </div>
        ) : (
          <article className="mx-auto w-full max-w-3xl bg-white px-4 py-6 shadow-sm md:px-10 md:py-10">
            {/* agent-md：globals.css 手写文档样式（项目未装 typography 插件，
                prose 类不生效），与 agent 工作区渲染观感一致 */}
            <div className="agent-md text-[15px] leading-relaxed text-gray-800">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  pre: ({ children }) => (
                    <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] leading-relaxed [&_code]:bg-transparent [&_code]:p-0 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-inherit">
                      {children}
                    </pre>
                  ),
                  code: ({ className, children }) => (
                    <code
                      className={`rounded-sm bg-primary/10 px-1.5 py-0.5 font-mono text-[13px] text-primary-deep ${className || ""}`}
                    >
                      {children}
                    </code>
                  ),
                  img: ({ src, alt }) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={typeof src === "string" ? src : undefined}
                      alt={alt || ""}
                      className="my-2 h-auto max-w-full rounded-md border border-gray-200"
                      loading="lazy"
                    />
                  ),
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
