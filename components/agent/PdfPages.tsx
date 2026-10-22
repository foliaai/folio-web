"use client";

/**
 * PdfPages - 工作区 PDF 原文查看（PDF.js 连续页渲染）
 *
 * 不用 iframe/浏览器原生 PDF 视图（形态不可控、小屏体验差）：react-pdf 逐页
 * canvas 渲染，页宽撑满容器（占满原文页），纵向连续滚动。文本层保留可选中
 * 复制；注解层关闭（外链/表单不属于工作区预览诉求）。
 * 底部浮动页码胶囊：当前页随滚动自动跟踪，支持输入页码跳转与上下翻页。
 * worker 配置与知识库 DocumentView 同款（重复赋值幂等）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export function PdfPages({ url }: { url: string }) {
  const [numPages, setNumPages] = useState(0);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState(1);
  const [draft, setDraft] = useState("1");
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pageEls = useRef<Map<number, HTMLDivElement>>(new Map());
  const [pageWidth, setPageWidth] = useState(0);

  // 页宽 = 容器内宽（左右各留 12px 呼吸边）；容器尺寸变化时重算重渲染
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth) - 24;
      setPageWidth(w > 0 ? w : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 滚动跟踪当前页：视口上沿 30% 探针线所在页即当前页。
  // 不用 rAF 节流——该 webview 的 requestAnimationFrame 不执行，直接计算
  // （O(页数) 极轻，滚动事件本身已被浏览器按帧节流）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || numPages <= 0) return;
    const onScroll = () => {
      const hostTop = el.getBoundingClientRect().top;
      const probe = el.scrollTop + el.clientHeight * 0.3;
      let cur = 1;
      for (let i = 1; i <= numPages; i++) {
        const node = pageEls.current.get(i);
        if (!node) continue;
        const nodeTop = node.getBoundingClientRect().top - hostTop + el.scrollTop;
        if (nodeTop <= probe) cur = i;
      }
      setCurrent((prev) => {
        if (prev !== cur && document.activeElement !== inputRef.current) {
          setDraft(String(cur));
        }
        return cur;
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [numPages]);

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setFailed(false);
    setCurrent(1);
    setDraft("1");
  }, []);

  const jumpTo = useCallback(
    (raw: number) => {
      const n = Math.min(Math.max(1, Math.round(raw)), Math.max(numPages, 1));
      const host = wrapRef.current;
      const node = pageEls.current.get(n);
      // 直接驱动滚动宿主（scrollIntoView 会联动页面级祖先滚动，行为不可控；
      // 且该 webview 的 behavior:"smooth" 不生效，用瞬时滚动保证落位）
      if (host && node) {
        const top = node.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop;
        host.scrollTo(0, Math.max(0, top - 8));
        setCurrent(n);
        setDraft(String(n));
      }
    },
    [numPages],
  );

  const commitDraft = () => {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n)) jumpTo(n);
    else setDraft(String(current));
  };

  if (failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <AlertCircle className="h-6 w-6 text-red-400" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground/80">PDF 渲染失败</p>
        <p className="text-xs text-muted">可尝试下载后本地打开，或用工具栏按钮在新窗口查看。</p>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div ref={wrapRef} className="h-full overflow-y-auto bg-gray-100/70 px-3 py-3">
        <Document
          file={url}
          onLoadSuccess={onLoadSuccess}
          onLoadError={() => setFailed(true)}
          loading={
            <div className="flex h-40 items-center justify-center gap-2 text-xs text-muted">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-hairline border-t-primary" aria-hidden="true" />
              文档加载中…
            </div>
          }
        >
          {pageWidth > 0
            ? Array.from({ length: numPages }, (_, i) => (
                <div
                  key={i + 1}
                  ref={(node) => {
                    if (node) pageEls.current.set(i + 1, node);
                    else pageEls.current.delete(i + 1);
                  }}
                  className="mb-3 shadow-sm"
                >
                  <Page
                    pageNumber={i + 1}
                    width={pageWidth}
                    renderAnnotationLayer={false}
                    loading={
                      <div className="flex h-40 items-center justify-center bg-white text-xs text-muted-faint">
                        第 {i + 1} 页…
                      </div>
                    }
                  />
                </div>
              ))
            : null}
        </Document>
      </div>

      {/* 页码胶囊：上一页 / 第 x / N 页（输入跳转）/ 下一页 */}
      {numPages > 1 ? (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-hairline bg-white/95 px-1.5 py-1 shadow-md backdrop-blur-sm">
          <button
            type="button"
            onClick={() => jumpTo(current - 1)}
            disabled={current <= 1}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full transition-colors cursor-pointer",
              current <= 1 ? "text-muted-faint/60" : "text-muted hover:bg-gray-100 hover:text-foreground",
            )}
            title="上一页"
            aria-label="上一页"
          >
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <span className="px-0.5 text-[11px] text-muted">第</span>
          <input
            ref={inputRef}
            value={draft}
            inputMode="numeric"
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitDraft();
                inputRef.current?.blur();
              }
            }}
            onBlur={commitDraft}
            onFocus={(e) => e.target.select()}
            className="w-9 rounded-md border border-hairline bg-white px-1 py-0.5 text-center text-[11px] text-foreground outline-none focus:border-primary/50"
            aria-label="跳转到页码"
          />
          <span className="px-0.5 text-[11px] text-muted">/ {numPages} 页</span>
          <button
            type="button"
            onClick={() => jumpTo(current + 1)}
            disabled={current >= numPages}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full transition-colors cursor-pointer",
              current >= numPages ? "text-muted-faint/60" : "text-muted hover:bg-gray-100 hover:text-foreground",
            )}
            title="下一页"
            aria-label="下一页"
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
