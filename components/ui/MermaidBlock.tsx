"use client";

/**
 * MermaidBlock - mermaid 代码块渲染（flowchart/sequence/gantt 等）
 *
 * mermaid 以 UMD 单文件形态放 public/vendor/（scripts/copy-mermaid.mjs 从
 * node_modules 拷贝，postinstall 自动执行），运行时动态 script 标签加载
 * window.mermaid——**不进 bundler**：直接 import 会让 Turbopack 构建内存
 * 峰值暴涨，CI runner OOM（进程被 Killed）。
 *
 * strict 安全模式（SVG 净化，<br/> 等白名单标签可用），语法错误降级为
 * 原始代码块。各 markdown 渲染入口的 code 组件用 isMermaidCode 拦截后
 * 改走本组件。
 */

import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

/** mermaid default export 的实例类型（纯类型引用，不产生运行时导入） */
type Mermaid = typeof import("mermaid")["default"];

declare global {
  interface Window {
    mermaid?: Mermaid;
  }
}

const MERMAID_SRC = "/vendor/mermaid.min.js";
let mermaidPromise: Promise<Mermaid> | null = null;

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = new Promise<Mermaid>((resolve, reject) => {
      const existing = window.document.querySelector<HTMLScriptElement>(
        `script[src="${MERMAID_SRC}"]`
      );
      const script = existing ?? window.document.createElement("script");
      const onload = () => {
        const m = window.mermaid;
        if (!m) {
          reject(new Error("mermaid.min.js 加载后 window.mermaid 缺失"));
          return;
        }
        m.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
        });
        resolve(m);
      };
      script.addEventListener("load", onload, { once: true });
      script.addEventListener(
        "error",
        () => reject(new Error(`mermaid.min.js 加载失败: ${MERMAID_SRC}`)),
        { once: true }
      );
      if (!existing) {
        script.src = MERMAID_SRC;
        window.document.head.appendChild(script);
      }
    });
    mermaidPromise.catch(() => {
      mermaidPromise = null; // 失败后允许重试
    });
  }
  return mermaidPromise;
}

/** code 组件的 className 是否为 mermaid 围栏（```mermaid） */
export function isMermaidCode(className?: string | null): boolean {
  return /(?:^|\s)language-mermaid(?:\s|$)/.test(className || "");
}

/** 取 code 子节点的纯文本（react-markdown 代码块子节点为字符串） */
export function mermaidCodeText(children: React.ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(mermaidCodeText).join("");
  return String(children ?? "");
}

/**
 * pre 的子节点是否为 mermaid 代码块——是则 pre 组件应脱壳直通
 * （MermaidBlock 渲染 div/SVG，不能包在 <pre> 里）。
 */
export function isMermaidPre(children: React.ReactNode): boolean {
  if (Array.isArray(children)) return children.some(isMermaidPre);
  if (typeof children === "object" && children !== null && "props" in children) {
    const el = children as React.ReactElement<{ className?: string }>;
    return isMermaidCode(el.props?.className);
  }
  return false;
}

export function MermaidBlock({ code }: { code: string }) {
  const domId = "mmd" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);
    loadMermaid()
      .then((m) => m.render(domId, code))
      .then(({ svg: out }) => {
        if (!cancelled) setSvg(out);
      })
      .catch(() => {
        // 语法错误/脚本加载失败：降级显示原始代码，不让整页崩
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code, domId]);

  if (failed) {
    return (
      <pre className="my-3 overflow-x-auto rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-gray-700">
        <code>{code}</code>
      </pre>
    );
  }
  if (!svg) {
    return (
      <div className="my-3 flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 px-3 py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted" />
        <span className="ml-2 text-xs text-muted">流程图渲染中...</span>
      </div>
    );
  }
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-gray-200 bg-white px-3 py-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full">
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
