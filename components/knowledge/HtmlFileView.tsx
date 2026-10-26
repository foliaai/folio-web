"use client";

/**
 * HtmlFileView - HTML 文件预览
 *
 * 拉取 /raw 原文，iframe sandbox 渲染。sandbox="" 全限制（禁脚本/表单/
 * 弹窗/同源凭证访问），原样式与布局完整保留，XSS 面收敛在沙箱内——
 * HTML 不能像 md 那样直接注入文档流 DOM。
 *
 * 已知限制（与 md 预览一致）：相对路径图片/样式无 base URL 不加载；
 * data: URI 内嵌图正常显示。chunk 定位高亮不适用（预览的是原始文件
 * 而非解析元素流，序号锚定无对应渲染块）。
 */

import { AlertCircle, FileCode2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { formatBytes } from "@/lib/utils";

interface HtmlFileViewProps {
  fileName: string;
  fileSize?: number | null;
  previewUrl: string;
}

export function HtmlFileView({ fileName, fileSize, previewUrl }: HtmlFileViewProps) {
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
          setError(err instanceof Error ? err.message : "HTML 原文加载失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [previewUrl]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2.5">
        <FileCode2 className="h-4 w-4 shrink-0 text-muted" />
        <span className="truncate text-sm text-foreground">{fileName}</span>
        {fileSize ? (
          <span className="shrink-0 text-xs text-muted">{formatBytes(fileSize)}</span>
        ) : null}
        <span className="ml-auto shrink-0 text-xs text-muted">HTML · 沙箱预览</span>
      </div>

      <div className="min-h-0 flex-1 bg-gray-100">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center p-8">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <p className="mt-2 text-sm text-muted">HTML 预览加载失败：{error}</p>
          </div>
        ) : content === null ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
            <span className="ml-2 text-sm text-muted">正在加载文档...</span>
          </div>
        ) : (
          // sandbox=""：无 allow-* 任何能力——脚本/表单/弹窗/同源全禁，
          // 样式与图片渲染不受影响
          <iframe
            title={fileName}
            sandbox=""
            srcDoc={content}
            className="h-full w-full border-0 bg-white"
          />
        )}
      </div>
    </div>
  );
}
