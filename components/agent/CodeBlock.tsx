"use client";

/**
 * 浅色主题代码块(通用 Agent 正文)
 *
 * 与 ToolResultBox 同风格:浅色卡片(rounded-xl + hairline 边 + gray-50 底)
 * + 头部语言标签与复制按钮 + 等宽小字正文。语法高亮 token 颜色见
 * globals.css 的 .codeblock-light 段(GitHub-light 浅色基调,不用深底)。
 *
 * 折叠:超过 COLLAPSE_THRESHOLD 行的代码块默认收起——头部显示语言与行数,
 * 正文只露出前两行(底部渐隐);点击头部或「展开」任意处切换。复制始终
 * 复制全文(不依赖展开)。流式生成中行数会增长,预览区随增量变化即可。
 */

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

/** 超过此行数默认折叠(≤ 则直接展开,短代码折叠反而多一次点击) */
const COLLAPSE_THRESHOLD = 4;
/** 折叠态预览行数 */
const PREVIEW_LINES = 2;

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in (node as { props?: unknown })) {
    return extractText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function langOf(className?: string): string {
  const m = /language-([\w+-]+)/.exec(className ?? "");
  return m ? m[1] : "";
}

export function CodeBlockPre({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  /** null=未手动干预(跟随默认策略);true/false=用户已定 */
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);

  // react-markdown v9:pre 的第一个子节点是 code(带 language-xxx class)
  let codeEl: ReactNode = children;
  let language = "";
  if (
    typeof codeEl === "object" &&
    codeEl !== null &&
    "props" in (codeEl as { props?: { className?: string; children?: ReactNode } })
  ) {
    const props = (codeEl as { props: { className?: string; children?: ReactNode } }).props;
    language = langOf(props.className);
  }
  const raw = extractText(children);
  const lines = raw ? raw.replace(/\n$/, "").split("\n") : [];
  const lineCount = lines.length;
  const collapsible = lineCount > COLLAPSE_THRESHOLD;
  const open = manualOpen ?? !collapsible;

  const handleCopy = () => {
    void navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const toggle = () => {
    if (collapsible) setManualOpen(!(manualOpen ?? !collapsible));
  };

  return (
    <div className="codeblock-light my-3 overflow-hidden rounded-xl border border-hairline/80 bg-gray-50/80">
      <div
        className={cn(
          "flex items-center justify-between border-b border-hairline/50 px-3 py-1.5",
          collapsible && "cursor-pointer select-none hover:bg-gray-100/70",
        )}
        onClick={toggle}
      >
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] tracking-wide text-muted">
          {collapsible ? (
            open ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-faint" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-faint" aria-hidden="true" />
            )
          ) : null}
          <span className="truncate">{language || "text"}</span>
          {collapsible ? (
            <span className="shrink-0 text-muted-faint">· {lineCount} 行</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleCopy();
          }}
          className="flex items-center gap-1 text-xs text-muted-faint transition-colors hover:text-foreground cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-600" />
              <span className="text-emerald-600">已复制</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>

      {open ? (
        <pre className="overflow-x-auto px-3.5 py-3 text-[12.5px] leading-relaxed text-foreground/90">
          {children}
        </pre>
      ) : (
        <div className="relative cursor-pointer" onClick={toggle}>
          {/* 预览固定渲染两行且不换行,不设 max-h——3.4rem 装不下两行行高会裁掉第二行底部 */}
          <pre className="overflow-hidden px-3.5 py-2.5 text-[12.5px] leading-relaxed text-foreground/90">
            {lines.slice(0, PREVIEW_LINES).join("\n")}
          </pre>
          {/* 底部渐隐 + 展开提示(渐隐盖在预览之上,提示条独立可点) */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-gray-50/95 to-transparent" />
          <div className="relative flex items-center justify-center gap-1 border-t border-hairline/40 bg-gray-50/90 py-1 text-[11px] text-primary transition-colors hover:text-primary-deep select-none">
            展开全部 {lineCount} 行
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </div>
        </div>
      )}
    </div>
  );
}

/** 行内 code:浅绿底胶囊(与主题色同源,不用深色) */
export function InlineCode({ children }: { children?: ReactNode }) {
  return (
    <code className="rounded-md bg-primary/8 px-1.5 py-0.5 font-mono text-[0.85em] text-primary-deep">
      {children}
    </code>
  );
}
