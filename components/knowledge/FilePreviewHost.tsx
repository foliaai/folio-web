"use client";

import { useEffect, useState } from "react";
import { FilePreviewOverlay } from "@/components/knowledge/FilePreviewOverlay";
import {
  FILE_PREVIEW_EVENT,
  type FilePreviewRequest,
} from "@/lib/file-preview";

/**
 * 页内文件预览宿主：监听 openFilePreview 事件并渲染覆盖层。
 * 挂载在 /knowledge 页与 agent 首页——覆盖层内的对话面板再点引用，
 * 会再次触发事件，Host 原地换目标文件（不叠层）。
 */
export function FilePreviewHost() {
  const [target, setTarget] = useState<FilePreviewRequest | null>(null);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<FilePreviewRequest>).detail;
      if (detail?.fileId) setTarget(detail);
    };
    window.addEventListener(FILE_PREVIEW_EVENT, onOpen);
    return () => window.removeEventListener(FILE_PREVIEW_EVENT, onOpen);
  }, []);

  if (!target) return null;

  return (
    <FilePreviewOverlay
      file={target.file}
      fileId={target.file ? undefined : target.fileId}
      kbName={target.kbName ?? undefined}
      highlightChunkId={target.chunkId}
      onClose={() => setTarget(null)}
    />
  );
}
