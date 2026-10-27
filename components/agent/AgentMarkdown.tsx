"use client";

/**
 * 通用 Agent 正文 Markdown 渲染
 *
 * 管道与知识库 MarkdownAnswer 同源(remark-gfm / math / katex),差异:
 * - 无内联引用 chip(agent 消息无 citations)
 * - 代码块走浅色主题 CodeBlock(卡片 + 语法高亮 + 复制),行内 code 浅绿胶囊
 *   —— 不使用知识库正文的 prose-pre 深色底
 * - 额外开 rehype-raw + rehype-sanitize:MinerU 的解析产物里表格是内嵌
 *   HTML(<html><body><table>…)而非 GFM 管道表,不开 raw 会当纯文本吐源码;
 *   sanitize 用 GitHub 基线白名单(表格标签在内),模型输出里的原生 HTML
 *   同样先解析后消毒,无 XSS 面
 */

import { useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypePrism from "rehype-prism-plus";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import {
  MermaidBlock,
  isMermaidCode,
  isMermaidPre,
  mermaidCodeText,
} from "@/components/ui/MermaidBlock";

import { CodeBlockPre, InlineCode } from "@/components/agent/CodeBlock";

/** 消毒白名单:GitHub 基线 + 允许 class(catalog 类装饰)与表格对齐属性 */
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "className"],
  },
};

/** 是否"像 LaTeX"：含任一公式特征字符。过滤货币（"$5 和 $10"）等误配 */
function looksLikeLatex(s: string): boolean {
  return /[\\^_{}]/.test(s);
}

/** hast math code 元素（rehype-katex 的识别形态） */
function makeMathNode(latex: string, display: boolean) {
  return {
    type: "element" as const,
    tagName: "code",
    properties: { className: ["language-math", display ? "math-display" : "math-inline"] },
    children: [{ type: "text" as const, value: latex }],
  };
}

/**
 * 把一个文本节点拆成 [文本 | math 元素] 序列。
 * display（$$..$$，可跨行）优先；inline（$..$，单行）只取未被 display 覆盖
 * 的区间；不像公式的片段原样保留。
 */
function splitLatexText(value: string): Array<Record<string, unknown>> {
  type Span = { start: number; end: number; latex: string; display: boolean };
  const spans: Span[] = [];
  const displayRe = /\$\$([\s\S]+?)\$\$/g;
  const inlineRe = /\$([^\n$]+?)\$/g;
  let m: RegExpExecArray | null;
  while ((m = displayRe.exec(value)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length, latex: m[1], display: true });
  }
  while ((m = inlineRe.exec(value)) !== null) {
    if (spans.some((s) => m!.index >= s.start && m!.index < s.end)) continue;
    spans.push({ start: m.index, end: m.index + m[0].length, latex: m[1], display: false });
  }
  if (spans.length === 0) return [{ type: "text", value }];
  spans.sort((a, b) => a.start - b.start);
  const parts: Array<Record<string, unknown>> = [];
  let last = 0;
  for (const s of spans) {
    if (s.start > last) parts.push({ type: "text", value: value.slice(last, s.start) });
    const latex = s.latex.trim();
    if (latex && looksLikeLatex(latex)) {
      parts.push(makeMathNode(latex, s.display));
    } else {
      // 不像公式（货币/普通文本）：原样保留定界符
      parts.push({ type: "text", value: value.slice(s.start, s.end) });
    }
    last = s.end;
  }
  if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
  return parts;
}

/**
 * rehype 插件：文本节点中的 $$..$$ / $..$ → code.math 元素（rehype-katex 渲染）。
 * markdown 层的公式已由 remark-math 处理成元素、不再是文本节点；这里兜的是
 * raw HTML 内的公式——MinerU 表格单元格（后端 rebuild 转换的兜底层）与
 * direct_md 直传 .md（唯一转换层）。不进入 code/pre（代码块里的 $ 是 shell 等
 * 语义，不做转换）。
 */
function rehypeLatexText() {
  const walk = (node: Record<string, unknown>) => {
    const children = node.children as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(children)) return;
    const next: Array<Record<string, unknown>> = [];
    for (const child of children) {
      if (child.tagName === "code" || child.tagName === "pre") {
        next.push(child);
        continue;
      }
      if (child.type === "text" && typeof child.value === "string" && child.value.includes("$")) {
        next.push(...splitLatexText(child.value));
      } else {
        walk(child);
        next.push(child);
      }
    }
    node.children = next;
  };
  return (tree: Record<string, unknown>) => walk(tree);
}

export function AgentMarkdown({
  content,
  inflight,
}: {
  content: string;
  inflight?: boolean;
}) {
  const components = useMemo(
    () => ({
      pre: ({ children }: { children?: ReactNode }) =>
        isMermaidPre(children) ? (
          <>{children}</>
        ) : (
          <CodeBlockPre>{children}</CodeBlockPre>
        ),
      code: ({
        className,
        children,
      }: {
        className?: string;
        children?: ReactNode;
      }) => {
        // mermaid 围栏改走 MermaidBlock（pre 壳已脱）。
        // 块级 code(有无语言标注)由 pre 壳渲染,原样透传保住 prism class;
        // 行内 code 套浅绿胶囊。区分依据是 className:rehype-prism-plus 对所有
        // pre>code 都会加 class(language-xxx 和/或 code-highlight),行内 code
        // 则永远没有 class —— 若按 language- 判断,无语言围栏会误入行内胶囊,
        // 展开态正文多出 6px 内边距且字号缩到 0.85em,与折叠预览错位。
        if (isMermaidCode(className)) {
          return <MermaidBlock code={mermaidCodeText(children)} />;
        }
        if (className) {
          return <code className={className}>{children}</code>;
        }
        return <InlineCode>{children}</InlineCode>;
      },
    }),
    [],
  );

  return (
    <div className={inflight ? "agent-md agent-md--inflight" : "agent-md"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, SANITIZE_SCHEMA],
          rehypeLatexText,
          rehypeKatex,
          [rehypePrism, { ignoreMissing: true }],
        ]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
