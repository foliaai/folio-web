"use client";

import { useEffect, useState } from "react";
import { MessageSquareText, Loader2, X } from "lucide-react";
import { DocumentView } from "@/components/knowledge/DocumentView";
import { KnowledgeChatPanel } from "@/components/knowledge/KnowledgeChatPanel";
import { buildFileRawUrl, fetchFilePreview } from "@/lib/api/knowledge";
import type { KnowledgeFile } from "@/lib/knowledge-types";

/**
 * 页内文件预览覆盖层：在当前页上全屏呈现预览（DocumentView）+
 * 可选「文件问答」侧栏，ESC/返回关闭，列表状态保留在下层。
 *
 * 两种进入方式：
 * - 调用方持有完整文件对象（文件列表点击）→ 直传 file 立即渲染；
 * - 仅有 fileId（对话引用跳转）→ 经 /preview API 懒加载元信息。
 */
export function FilePreviewOverlay({
  file: initialFile,
  fileId,
  kbName,
  onClose,
  highlightChunkId,
}: {
  /** 完整文件对象（快速路径） */
  file?: KnowledgeFile;
  /** 仅文件 ID 时走 /preview 懒加载 */
  fileId?: string;
  kbName?: string;
  onClose: () => void;
  /** 对话引用跳转时的 chunk 高亮 */
  highlightChunkId?: string | null;
}) {
  const targetId = initialFile?.file_id ?? fileId ?? "";
  const [lazyFile, setLazyFile] = useState<KnowledgeFile | null>(null);
  const [lazyError, setLazyError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const file = initialFile ?? lazyFile;
  const previewUrl = targetId ? buildFileRawUrl(targetId) : "";

  useEffect(() => {
    if (initialFile || !fileId) return;
    let cancelled = false;
    setLazyFile(null);
    setLazyError(null);
    fetchFilePreview(fileId)
      .then((data) => {
        if (cancelled) return;
        setLazyFile({
          file_id: data.file_id,
          file_name: data.file_name,
          mime_type: data.mime_type ?? null,
          file_size: data.file_size ?? null,
          knowledge_base_id: undefined,
          render_as: data.render_as ?? null,
          preview_mime_type: data.preview_mime_type ?? null,
          has_converted_pdf: data.has_converted_pdf ?? false,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setLazyError(err instanceof Error ? err.message : "获取文件信息失败");
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, initialFile]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !chatOpen) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, chatOpen]);

  const chatDisabled = file ? file.index_status !== "success" : true;

  return (
    <div className="fixed inset-0 z-[1000] flex bg-white">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted transition-colors hover:bg-gray-100 hover:text-foreground cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
            关闭预览
          </button>

          {lazyError ? (
            <span className="text-xs text-amber-600">预览加载失败：{lazyError}</span>
          ) : null}

          <button
            type="button"
            onClick={() => setChatOpen(!chatOpen)}
            disabled={!file}
            className={
              chatOpen
                ? "inline-flex items-center gap-1.5 rounded-lg bg-primary/15 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/20 cursor-pointer"
                : "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted transition-colors hover:bg-gray-100 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            }
          >
            <MessageSquareText className="h-3.5 w-3.5" />
            文件问答
          </button>
        </div>

        <div className="min-h-0 flex-1">
          {file ? (
            <DocumentView
              file={file}
              kbName={kbName || "当前知识库"}
              previewUrl={previewUrl}
              isLoadingPreview={!previewUrl}
              highlightChunkId={highlightChunkId ?? null}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted" />
              <span className="ml-2 text-sm text-muted">正在加载文件信息...</span>
            </div>
          )}
        </div>
      </div>

      {chatOpen && file ? (
        <aside className="fixed inset-0 z-50 flex w-full flex-col bg-white md:relative md:z-auto md:w-[380px] md:shrink-0 md:border-l md:border-gray-200 md:bg-gray-50">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2">
            <span className="text-xs font-medium text-foreground">文件问答</span>
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-gray-200 hover:text-foreground cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <KnowledgeChatPanel
              knowledgeBaseId={file.knowledge_base_id ?? null}
              knowledgeBaseName={kbName}
              selectedFolderName={file.file_name}
              disabled={chatDisabled}
              disabledReason={
                chatDisabled
                  ? "文件还在处理中，处理完成后可开始问答。"
                  : undefined
              }
              enabled
              compact
              className="h-full rounded-none border-0 shadow-none"
            />
          </div>
        </aside>
      ) : null}
    </div>
  );
}
