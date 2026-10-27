"use client";

/**
 * MermaidBlock - mermaid 代码块渲染（flowchart/sequence/gantt 等）
 *
 * 动态 import mermaid（~2MB，不进首屏 bundle），strict 安全模式
 * （SVG 净化，<br/> 等白名单标签可用），语法错误降级为原始代码块。
 * 各 markdown 渲染入口的 code 组件用 isMermaidCode 拦截后改走本组件。
 */

import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

let mermaidPromise: Promise<typeof import("mermaid")> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      m.default.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
      });
      return m;
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
      .then((m) => m.default.render(domId, code))
      .then(({ svg: out }) => {
        if (!cancelled) setSvg(out);
      })
      .catch(() => {
        // 语法错误/渲染失败：降级显示原始代码，不让整页崩
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
