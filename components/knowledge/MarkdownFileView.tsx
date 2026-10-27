"use client";

/**
 * MarkdownFileView - Markdown 文件预览
 *
 * 复用 chat 同套渲染（react-markdown + GFM + remark-math + KaTeX），
 * 原文经后端 /raw 端点拉取。窄屏：内容单列、表格横向滚动。
 *
 * chunk 定位高亮：md 元素无 bbox 坐标，无法按坐标画框；position 接口对每个
 * 关联元素返回 type_ordinal（文档内同类型序号）。渲染出的顶层块与解析器
 * 元素流同构（同源码、同顺序），按标签分桶计数即可锚定：text→p/h/ul/ol/
 * blockquote、table→table、image→仅含图段落、code→pre。chunk 的全部关联
 * 块都框选（与 PDF 逐元素画框同口径），首块滚动居中。
 * 已知错位边缘：图片下载失败回退段（text 元素渲染成图段）、html_block
 * 罕见产物——序号漂移 clamp 兜底，最多框到相邻块。
 */

import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { AlertCircle, FileText, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useEffect, useRef, useState } from "react";

import type { ElementPosition } from "@/lib/knowledge-types";
import { FileUploaderMeta } from "@/components/knowledge/FileUploaderMeta";
import { formatBytes } from "@/lib/utils";
import {
  MermaidBlock,
  isMermaidCode,
  isMermaidPre,
  mermaidCodeText,
} from "@/components/ui/MermaidBlock";

interface MarkdownHighlight {
  chunkId: string | null;
  chunkType: string;
  elements: ElementPosition[];
}

interface MarkdownFileViewProps {
  fileName: string;
  fileSize?: number | null;
  /** 上传者用户ID + 上传时间（头部元信息；缺席不渲染） */
  uploadedBy?: string | null;
  uploadedAt?: string | null;
  previewUrl: string;
  highlight?: MarkdownHighlight | null;
}

/** 元素类型 → 序号锚桶（桶内序号与后端元素流的同类型序号同构） */
const ELEMENT_BUCKET: Record<string, string> = {
  text: "text",
  table: "table",
  image: "image",
  code_block: "code",
};

/** 渲染顶层块 → 桶分类；null = 不参与序号锚定的块（hr / KaTeX 块等） */
function classifyRenderedBlock(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag === "table") return "table";
  if (tag === "pre") return "code";
  if (tag === "img") return "image";
  if (tag === "p") {
    // 仅含图片、无文本的段落是图片元素的渲染形态；其余段落算文本块
    if (el.querySelector("img") && !(el.textContent || "").trim()) {
      return "image";
    }
    return "text";
  }
  if (/^h[1-6]$/.test(tag) || tag === "ul" || tag === "ol" || tag === "blockquote") {
    return "text";
  }
  return null;
}

const HIGHLIGHT_CLASS = "md-chunk-highlight";
const HIGHLIGHT_CLEAR_MS = 3200;

export function MarkdownFileView({
  fileName,
  fileSize,
  uploadedBy,
  uploadedAt,
  previewUrl,
  highlight,
}: MarkdownFileViewProps) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);

  // 序号锚定：按桶数渲染顶层块，chunk 的每个关联元素各自定位到
  // 桶内第 N 块；全部高亮（与 PDF 逐元素画框同口径），首块滚动居中
  useEffect(() => {
    if (!content || !highlight) return;
    const container = articleRef.current;
    if (!container) return;

    const buckets: Record<string, Element[]> = {
      text: [],
      table: [],
      image: [],
      code: [],
    };
    for (const child of Array.from(container.children)) {
      const bucket = classifyRenderedBlock(child);
      if (bucket) buckets[bucket].push(child);
    }

    const targets: HTMLElement[] = [];
    for (const e of highlight.elements) {
      const bucket = ELEMENT_BUCKET[e.element_type];
      if (!bucket || typeof e.type_ordinal !== "number") continue;
      const list = buckets[bucket];
      if (list.length === 0) continue;
      const node = list[Math.min(e.type_ordinal, list.length - 1)];
      if (node instanceof HTMLElement && !targets.includes(node)) {
        targets.push(node);
      }
    }
    if (targets.length === 0) return;

    targets[0].scrollIntoView({ behavior: "smooth", block: "center" });
    for (const t of targets) t.classList.add(HIGHLIGHT_CLASS);
    const timer = setTimeout(() => {
      for (const t of targets) t.classList.remove(HIGHLIGHT_CLASS);
    }, HIGHLIGHT_CLEAR_MS);
    return () => {
      clearTimeout(timer);
      for (const t of targets) t.classList.remove(HIGHLIGHT_CLASS);
    };
  }, [content, highlight]);

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
        <FileUploaderMeta userId={uploadedBy} createdAt={uploadedAt} />
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
            <div
              ref={articleRef}
              className="agent-md text-[15px] leading-relaxed text-gray-800"
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  pre: ({ children }) =>
                    isMermaidPre(children) ? (
                      <>{children}</>
                    ) : (
                      <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13px] leading-relaxed [&_code]:bg-transparent [&_code]:p-0 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-inherit">
                        {children}
                      </pre>
                    ),
                  code: ({ className, children }) =>
                    isMermaidCode(className) ? (
                      <MermaidBlock code={mermaidCodeText(children)} />
                    ) : (
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
