"use client";

/**
 * MarkdownAnswer - 助手消息正文渲染
 *
 * 在 react-markdown 之上叠加两件事：
 *   1. LaTeX：通过 `remark-math` + `rehype-katex` 支持 $...$ 与 $$...$$
 *      （equation 类型的 chunk 在后端被切成 text + LaTeX 语法，这里就能渲染）。
 *   2. 内联引用：扫描所有文本节点中的引用占位符，替换为 `<CitationChip />`。
 *
 * 引用占位符单一格式：`[cN]` 短 alias（如 `[c1]` `[c12]`）。后端 prompt 强制
 * LLM 用这种形式；alias 在每条 message.citations 里通过 `citation.alias` 字段
 * 携带。alias 是模型/落库/回放的统一口径——不再识别 `[chunk-<uuid>]` 完整 id
 * 形式（历史 Phase A 兼容路径已删除，口径见 folio-aks 单口径决策）。
 *
 * 设计要点：
 * - 渲染期间用 useMemo 预建查表：alias→citation。
 * - 不在 markdown AST 上做 plugin，而是在 react-markdown 的 components 钩子
 *   里拦截子节点字符串（更直接、对常见 markdown 结构都生效：段落、列表、
 *   表格单元格、强调等）。
 * - 查不到的引用号 chip 显示降级灰色"?"占位 + console.warn。
 */

import { Children, useMemo } from "react";
import type { ReactNode } from "react";
import type { PluggableList } from "unified";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { CitationChip } from "@/components/knowledge/CitationChip";
import {
  MermaidBlock,
  isMermaidCode,
  isMermaidPre,
  mermaidCodeText,
} from "@/components/ui/MermaidBlock";
import type { Citation } from "@/lib/chat-types";

// 匹配 `[cN]`（c + 1-6 位纯数字）
const CHUNK_REF_RE = /\[c\d{1,6}\]/gi;

interface MarkdownAnswerProps {
  content: string;
  citations?: Citation[];
  inflight?: boolean;
}

interface CitationLookup {
  byAlias: Map<string, { index: number; citation: Citation }>;
}

/**
 * 字符串切片：把 `[cN]` 替换为 CitationChip。
 * 同时把"陌生引用号"（在 citations 列表里查不到）也尝试渲染为降级 chip，
 * 这样 LLM 引用了一个 message.citations 里没有的引用号也不会显示原始裸文本。
 */
function splitTextToChips(
  text: string,
  lookup: CitationLookup,
  warnedUnknown: Set<string>
): ReactNode {
  if (!text || !text.includes("[")) return text;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  CHUNK_REF_RE.lastIndex = 0;

  while ((match = CHUNK_REF_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const raw = match[0].slice(1, -1); // 去掉 [ ]
    const key = raw.toLowerCase();

    const known = lookup.byAlias.get(key);

    let index: number | "?";
    let citation: Citation | undefined;
    if (known) {
      index = known.index;
      citation = known.citation;
    } else {
      index = "?";
      citation = undefined;
      if (!warnedUnknown.has(key)) {
        warnedUnknown.add(key);
        if (typeof window !== "undefined") {
          // eslint-disable-next-line no-console
          console.warn(
            "[citation] LLM 引用了 message.citations 里没有的引用号:",
            raw,
            `（citations 已有 ${lookup.byAlias.size} 条）`
          );
        }
      }
    }
    parts.push(
      <CitationChip
        key={`${raw}-${match.index}`}
        index={index}
        citation={citation}
        rawChunkId={citation?.chunk_id ?? raw}
      />
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length === 1 ? parts[0] : parts;
}

/** 递归把 children 中的字符串节点转换为 chip 混合数组 */
function mapChildren(
  children: ReactNode,
  lookup: CitationLookup,
  warnedUnknown: Set<string>
): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return splitTextToChips(child, lookup, warnedUnknown);
    }
    if (typeof child === "number") {
      return child;
    }
    return child;
  });
}

export function MarkdownAnswer({
  content,
  citations,
  inflight,
}: MarkdownAnswerProps) {
  const lookup = useMemo<CitationLookup>(() => {
    const byAlias = new Map<string, { index: number; citation: Citation }>();
    (citations ?? []).forEach((c, i) => {
      // 优先使用 alias 编号（如 "c7" → 7），与 ReferencesSidePanel 保持一致
      let idx = i + 1;
      if (c?.alias) {
        const m = /^c(\d+)$/i.exec(c.alias);
        if (m) idx = Number(m[1]);
      }
      if (c?.alias) byAlias.set(c.alias.toLowerCase(), { index: idx, citation: c });
    });
    return { byAlias };
  }, [citations]);

  // 仅用于去重 console.warn；不参与渲染序号
  const warnedUnknown = useMemo(() => new Set<string>(), [lookup]);

  // 流式公式缓冲（方案1）：inflight 期间半截 LaTeX 触发 KaTeX ParseError 时，
  // rehype-katex 默认把公式渲染成红色（#cc0000）原始文本——红色"错误"语义在
  // 流式中间态是误导（内容只是还没写完，不是真错误）。这里仅在流式期间把
  // errorColor 换成灰色（gray-400），生成结束后恢复 KaTeX 默认红色，保留
  // "最终态红色 = 真错误"的语义。插件数组随 inflight 变化重建，代价可忽略
  //（流式收尾只切换一次）。
  const rehypePlugins = useMemo(
    () =>
      inflight
        ? ([[rehypeKatex, { errorColor: "#9ca3af" }]] as PluggableList)
        : ([[rehypeKatex, { errorColor: "#cc0000" }]] as PluggableList),
    [inflight],
  );

  // react-markdown 的 components 钩子；这里覆盖所有可能携带文本的容器。
  // 注意 `code` / `pre` 不拦截（代码里出现的 [cN] 不应被替换）。
  const components = useMemo(() => {
    const makeTransform = (Tag: React.ElementType) => {
      const Component = (props: Record<string, unknown>) => {
        const { node: _node, children, ...rest } = props as {
          node?: unknown;
          children?: ReactNode;
        } & Record<string, unknown>;
        const transformed = mapChildren(children, lookup, warnedUnknown);
        return <Tag {...rest}>{transformed}</Tag>;
      };
      return Component;
    };

    return {
      p: makeTransform("p"),
      li: makeTransform("li"),
      td: makeTransform("td"),
      th: makeTransform("th"),
      strong: makeTransform("strong"),
      em: makeTransform("em"),
      span: makeTransform("span"),
      h1: makeTransform("h1"),
      h2: makeTransform("h2"),
      h3: makeTransform("h3"),
      h4: makeTransform("h4"),
      h5: makeTransform("h5"),
      h6: makeTransform("h6"),
      // code/pre 不参与引用替换（代码里的 [cN] 不应被换），仅拦截 mermaid
      code: ({ className, children }: { className?: string; children?: ReactNode }) =>
        isMermaidCode(className) ? (
          <MermaidBlock code={mermaidCodeText(children)} />
        ) : (
          <code className={className}>{children}</code>
        ),
      pre: ({ children }: { children?: ReactNode }) =>
        isMermaidPre(children) ? <>{children}</> : <pre>{children}</pre>,
    } as Record<string, React.ComponentType<Record<string, unknown>>>;
  }, [lookup, warnedUnknown]);

  return (
    <div className="relative">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
      {inflight ? (
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-1.5 ml-1 rounded-[1px] bg-primary animate-pulse align-middle"
        />
      ) : null}
    </div>
  );
}
