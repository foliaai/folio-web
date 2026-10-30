/**
 * 页内文件预览的事件总线。
 *
 * 所有"打开文件预览"入口（文件列表点击、对话引用 chip、引用列表、
 * 调研报告 iframe 内锚点）统一发事件，由页面挂载的 FilePreviewHost
 * 接收并在当前页渲染覆盖层——不再新开标签页。
 * Host 挂载点：/knowledge 页与 agent 首页（app/page.tsx）。
 */

import type { KnowledgeFile } from "@/lib/knowledge-types";

export const FILE_PREVIEW_EVENT = "folio:file-preview";

export interface FilePreviewRequest {
  fileId: string;
  /** 引用跳转时的 chunk 定位高亮 */
  chunkId?: string | null;
  /** 调用方已持有完整文件对象时直传，Host 免拉 API */
  file?: KnowledgeFile;
  /** 展示用库名（缺席时 Host 按文件归属兜底） */
  kbName?: string | null;
}

/** 发起页内文件预览（无 Host 监听的页面不生效） */
export function openFilePreview(req: FilePreviewRequest): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<FilePreviewRequest>(FILE_PREVIEW_EVENT, { detail: req })
  );
}

/** ReportViewer iframe（opaque origin）经 postMessage 送来的请求：字段白名单化 */
export function parsePreviewMessage(data: unknown): FilePreviewRequest | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const fileId = typeof d.fileId === "string" ? d.fileId : "";
  if (!fileId) return null;
  const chunkId = typeof d.chunkId === "string" ? d.chunkId : null;
  return { fileId, chunkId };
}
