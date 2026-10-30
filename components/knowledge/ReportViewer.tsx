"use client";

/**
 * ReportViewer — 调研报告 HTML 渲染模态框
 *
 * 用 iframe 渲染 LLM 生成的 HTML 报告，隔离样式。
 * 支持下载 HTML 文件和全屏查看。
 *
 * 引用链接重写：报告里的 `<a class="citation" href="#ref-cN">` 原本是页内锚点
 * （跳到参考文献区）。这里根据传入的 citations 把它重写为预览标记 hash
 * `#folio-preview:{fileId}:{chunkId}`，点击后经 postMessage 通知外层在
 * 当前页内打开预览覆盖层——与对话里的 CitationChip 行为一致。
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { X, Download, Maximize2 } from "lucide-react";
import type { Citation } from "@/lib/chat-types";
import { openFilePreview, parsePreviewMessage } from "@/lib/file-preview";

interface ReportViewerProps {
  /** HTML 字符串内容 */
  htmlContent: string;
  /** 报告所属消息的 citations，用于把 [cN] 锚点重写为页内预览链接 */
  citations?: Citation[];
  /** 关闭回调 */
  onClose: () => void;
}

/** 构建 alias(cN) → 预览标记 hash 的查表（iframe 拦截脚本识别后 postMessage 外层） */
function buildCitationUrlMap(
  citations: Citation[] | undefined
): Map<string, string> {
  const map = new Map<string, string>();
  if (!citations || citations.length === 0) return map;
  citations.forEach((c, i) => {
    // alias 优先（如 "c7"）；没有 alias 时回退到序号 c{i+1}
    const key = (c.alias ?? `c${i + 1}`).toLowerCase();
    if (!c.file_id) return;
    const parts = [c.file_id, c.chunk_id ?? ""];
    map.set(key, `#folio-preview:${parts.join(":")}`);
  });
  return map;
}

export function ReportViewer({ htmlContent, citations, onClose }: ReportViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const citationUrlMap = useMemo(() => buildCitationUrlMap(citations), [citations]);

  // 1) 重写引用锚点为预览标记 hash；
  // 2) 注入点击拦截脚本：页内 hash 锚点（#section-N 等）改用 scrollIntoView，
  //    避免在 opaque-origin iframe 内触发导航卡在"检查登录状态"；
  //    #folio-preview: 前缀经 postMessage 送外层页内打开；其余外链交给浏览器新标签。
  const safeSrcDoc = useMemo(() => {
    if (!htmlContent) return htmlContent;

    let doc = htmlContent;

    // 重写 <a class="citation" href="#ref-cN"> → 预览标记 hash
    if (citationUrlMap.size > 0) {
      doc = doc.replace(
        /<a([^>]*?)class="([^"]*\bcitation\b[^"]*)"([^>]*?)href="#ref-(c\d+)"([^>]*)>/gi,
        (whole, pre: string, cls: string, mid: string, alias: string, post: string) => {
          const url = citationUrlMap.get(alias.toLowerCase());
          if (!url) return whole;
          return `<a${pre}class="${cls}"${mid}href="${url}"${post}>`;
        }
      );
    }

    // 注入点击拦截脚本（放在 </body> 前；无 body 则追加到末尾）
    const interceptScript = `<script>
(function(){
  document.addEventListener('click', function(e){
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var hash = '';
    var hashIdx = href.indexOf('#');
    if (hashIdx >= 0) hash = href.slice(hashIdx + 1);
    if (hash.indexOf('folio-preview:') === 0) {
      e.preventDefault();
      var payload = hash.slice('folio-preview:'.length).split(':');
      try {
        window.parent.postMessage({ fileId: payload[0] || '', chunkId: payload[1] || null }, '*');
      } catch (_) {}
      return;
    }
    if (hash) {
      var el = document.getElementById(hash);
      if (el) {
        e.preventDefault();
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    // 非页内跳转：阻止 iframe 内导航，改在新标签打开
    if (href && !/^(#|javascript:|mailto:|tel:)/i.test(href)) {
      e.preventDefault();
      try { window.open(a.href, '_blank', 'noopener'); } catch (_) {}
    }
  }, true);
})();
<\/script>`;

    if (/<\/body>/i.test(doc)) {
      doc = doc.replace(/<\/body>/i, `${interceptScript}</body>`);
    } else {
      doc = `${doc}${interceptScript}`;
    }

    return doc;
  }, [htmlContent, citationUrlMap]);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // iframe（opaque origin）里点引用 → postMessage 转发为页内预览事件
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const req = parsePreviewMessage(e.data);
      if (req) openFilePreview(req);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // 下载 HTML 文件（下载原始报告，不含重写后的链接）
  const handleDownload = useCallback(() => {
    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `调研报告_${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [htmlContent]);

  // 全屏切换
  const handleFullscreen = useCallback(() => {
    const el = iframeRef.current?.closest(".report-viewer-modal");
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }, []);

  return (
    <div className="report-viewer-modal fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative flex h-[90vh] w-[90vw] max-w-[1200px] flex-col rounded-2xl bg-white shadow-2xl">
        {/* 顶部工具栏 */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-700">调研报告</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100"
              title="下载 HTML 文件"
            >
              <Download className="h-3.5 w-3.5" />
              下载
            </button>
            <button
              onClick={handleFullscreen}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100"
              title="全屏"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100"
              title="关闭 (Esc)"
            >
              <X className="h-3.5 w-3.5" />
              关闭
            </button>
          </div>
        </div>

        {/* iframe 渲染区
            sandbox 不给 allow-same-origin：让 iframe 成为独立 opaque origin，
            不共享外站 cookie / 登录态。这样报告里任何链接/资源请求都不会触发
            站内的登录检查并卡住；脚本与弹窗仍允许，保证报告内交互正常。 */}
        <iframe
          ref={iframeRef}
          className="flex-1 rounded-b-2xl"
          srcDoc={safeSrcDoc}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          title="调研报告"
          style={{ border: "none", width: "100%", height: "100%" }}
        />
      </div>
    </div>
  );
}
