"use client";

/**
 * DocumentView - 文件预览组件（PDF.js 渲染）
 *
 * 使用 react-pdf 渲染 PDF / Word / PPT（后两者走后端转换 PDF）：
 * - 页码跳转（通过 chunkId 定位）
 * - 图片/表格/文本 chunk：按关联 element 的 MinerU bbox 叠加高亮矩形框
 * - 非 PDF 可渲染格式：降级为占位提示
 */

import { KnowledgeFile } from "@/lib/knowledge-types";
import { isPdfPreviewableFile } from "@/lib/knowledge-viewer";
import { formatBytes } from "@/lib/utils";
import { AlertCircle, FileText, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { fetchChunkPosition } from "@/lib/api/knowledge";
import type { ElementPosition } from "@/lib/knowledge-types";
import { MarkdownFileView } from "@/components/knowledge/MarkdownFileView";

// PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const DEFAULT_MINERU_COORD_RANGE = 1000;

interface DocumentViewProps {
  file: KnowledgeFile;
  kbName: string;
  previewUrl: string;
  isLoadingPreview?: boolean;
  highlightChunkId?: string | null;
}

interface HighlightInfo {
  pageIndex: number;
  chunkType: string;
  elements: ElementPosition[];
  coordRange: number;
}

/** 每页记录 canvas 实际渲染尺寸，用于 MinerU 坐标换算 */
interface PageRenderDims {
  renderedWidth: number;
  renderedHeight: number;
}

export const DocumentView = ({
  file,
  previewUrl,
  isLoadingPreview,
  highlightChunkId,
}: DocumentViewProps) => {
  // PDF 原生文件，以及 Word/PPT（后端 /raw 默认返回转换 PDF）
  const isPdf = isPdfPreviewableFile(file);
  const isMarkdown = (() => {
    const name = (file.file_name || "").toLowerCase();
    return name.endsWith(".md") || name.endsWith(".markdown");
  })();
  const isOfficeConvertedPreview = (() => {
    const name = file.file_name.toLowerCase();
    return (
      name.endsWith(".doc") ||
      name.endsWith(".docx") ||
      name.endsWith(".ppt") ||
      name.endsWith(".pptx")
    );
  })();

  const [numPages, setNumPages] = useState<number>(0);
  const [highlight, setHighlight] = useState<HighlightInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const highlightBoxRef = useRef<HTMLDivElement | null>(null);
  const [pageDimsMap, setPageDimsMap] = useState<Map<number, PageRenderDims>>(new Map());

  // 自适应尺寸：宽度不超过容器，高度不超过容器（确保至少一页完整可见）
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      setContainerSize({
        w: Math.floor(el.clientWidth),
        h: Math.floor(el.clientHeight),
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 加载 chunk 定位信息
  useEffect(() => {
    if (!highlightChunkId) {
      setHighlight(null);
      return;
    }
    let cancelled = false;
    fetchChunkPosition(highlightChunkId)
      .then((res) => {
        if (cancelled) return;
        highlightBoxRef.current = null;
        setHighlight({
          pageIndex: res.page_index ?? 0,
          chunkType: res.chunk_type ?? "unknown",
          elements: res.elements,
          coordRange: res.coord_range ?? DEFAULT_MINERU_COORD_RANGE,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [highlightChunkId]);

  const onDocumentLoadSuccess = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
    },
    []
  );

  // Page 渲染完成 — 记录 canvas 实际渲染尺寸
  const onPageRenderSuccess = useCallback(
    (pageIndex: number) => () => {
      const pageEl = document.querySelector(
        `.react-pdf__Page[data-page-number="${pageIndex + 1}"]`
      );
      const canvas = pageEl?.querySelector("canvas") as HTMLCanvasElement | null;
      if (!canvas) return;
      setPageDimsMap((prev) => {
        const next = new Map(prev);
        next.set(pageIndex, {
          renderedWidth: canvas.clientWidth,
          renderedHeight: canvas.clientHeight,
        });
        return next;
      });
    },
    []
  );

  // 滚动到目标页：优先把高亮框本身居中，回退到整页居中
  useEffect(() => {
    if (!highlight || numPages === 0) return;
    const container = containerRef.current;
    if (!container) return;

    const scrollToHighlight = () => {
      const box = highlightBoxRef.current;
      const pageEl = pageRefs.current.get(highlight.pageIndex);
      if (!pageEl) return;

      // 优先：以高亮框中心对齐视口中心
      if (box) {
        const boxRect = box.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const boxCenterInContainer =
          boxRect.top - containerRect.top + container.scrollTop + boxRect.height / 2;
        const target = boxCenterInContainer - containerRect.height / 2;
        container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
        return;
      }

      // 回退：整页居中
      const pageRect = pageEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const pageCenterInContainer =
        pageRect.top - containerRect.top + container.scrollTop + pageRect.height / 2;
      const target = pageCenterInContainer - containerRect.height / 2;
      container.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    };

    // 高亮框依赖 canvas 渲染完成 + overlay 挂载，给足时间
    const timer = setTimeout(scrollToHighlight, 600);
    return () => clearTimeout(timer);
  }, [highlight, numPages, pageDimsMap]);

  const setPageRef = useCallback(
    (pageIndex: number, el: HTMLDivElement | null) => {
      if (el) pageRefs.current.set(pageIndex, el);
      else pageRefs.current.delete(pageIndex);
    },
    []
  );

  // Markdown：拉 /raw 原文走 react-markdown 渲染（无 bbox，不做 chunk 高亮）
  if (isMarkdown && previewUrl) {
    return (
      <MarkdownFileView
        fileName={file.file_name}
        fileSize={file.file_size}
        previewUrl={previewUrl}
      />
    );
  }

  if (!isPdf) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-white">
        <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2.5">
          <FileText className="h-4 w-4 shrink-0 text-muted" />
          <span className="truncate text-sm text-foreground">{file.file_name}</span>
          <span className="text-xs text-muted">{formatBytes(file.file_size)}</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-muted">
            <AlertCircle className="h-3.5 w-3.5" />
            暂不支持内嵌预览
          </div>
          <div className="mt-4 text-lg text-foreground">{file.file_name}</div>
          <p className="mt-2 max-w-md text-center text-sm text-muted">
            当前文件格式不支持内嵌预览。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2.5">
        <FileText className="h-4 w-4 shrink-0 text-muted" />
        <span className="truncate text-sm text-foreground">{file.file_name}</span>
        <span className="text-xs text-muted">{formatBytes(file.file_size)}</span>
        {numPages > 0 ? (
          <span className="text-xs text-muted">共 {numPages} 页</span>
        ) : null}
      </div>

      <div ref={containerRef} className="flex-1 overflow-auto bg-gray-100">
        {isLoadingPreview ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
            <span className="ml-2 text-sm text-muted">正在加载预览...</span>
          </div>
        ) : previewUrl ? (
          <Document
            file={previewUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted" />
                <span className="ml-2 text-sm text-muted">正在加载文档...</span>
              </div>
            }
            error={
              <div className="flex h-full flex-col items-center justify-center p-8">
                <AlertCircle className="h-5 w-5 text-red-400" />
                <p className="mt-2 text-sm text-muted">
                  {isOfficeConvertedPreview
                    ? "文档预览加载失败（可能尚未生成转换 PDF，请等待索引完成）"
                    : "PDF 加载失败"}
                </p>
              </div>
            }
          >
            {Array.from(new Array(numPages), (_el, index) => (
              <div
                key={`page_${index}`}
                ref={(el) => setPageRef(index, el)}
                className="mx-auto mb-2 w-fit"
              >
                <Page
                  pageNumber={index + 1}
                  width={Math.min(containerSize.w - 4, 900)}
                  onRenderSuccess={onPageRenderSuccess(index)}
                  renderTextLayer
                  renderAnnotationLayer
                >
                  {(() => {
                    if (!highlight) return null;
                    // 文本 chunk 可能跨页：按元素各自的 page_index 渲染高亮框，
                    // 缺失时回退到 chunk 目标页，避免整块画错页。
                    const pageElements = highlight.elements.filter(
                      (e) =>
                        (e.page_index ?? highlight.pageIndex) === index
                    );
                    if (!hasPositionedElements(pageElements)) return null;
                    return (
                      <ElementBBoxOverlay
                        elements={pageElements}
                        pageDims={pageDimsMap.get(index)}
                        coordRange={highlight.coordRange}
                        variant={
                          highlight.chunkType === "text" ? "text" : "media"
                        }
                        boxRef={
                          index === highlight.pageIndex
                            ? highlightBoxRef
                            : undefined
                        }
                      />
                    );
                  })()}
                </Page>
              </div>
            ))}
          </Document>
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-sm text-muted">无法获取预览地址</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// 高亮子组件
// ============================================================

function hasPositionedElements(elements: ElementPosition[]): boolean {
  return elements.some(
    (el) => el.page_position && el.page_position.length >= 4
  );
}

/**
 * 按 element bbox 叠加高亮矩形框（文本 / 图片 / 表格共用）
 *
 * page_position：MinerU bbox [x0, y0, x1, y1]
 * - 左上角原点，x 向右，y 向下
 * - 各轴映射到 0~coordRange（默认 1000）
 */
function ElementBBoxOverlay({
  elements,
  pageDims,
  coordRange,
  variant = "media",
  boxRef,
}: {
  elements: ElementPosition[];
  pageDims?: PageRenderDims;
  coordRange: number;
  variant?: "text" | "media";
  /** 第一个有效高亮矩形的 ref，供外层做"高亮居中"滚动 */
  boxRef?: React.RefObject<HTMLDivElement | null>;
}) {
  if (!pageDims || pageDims.renderedWidth === 0 || coordRange <= 0) return null;

  const scaleX = pageDims.renderedWidth / coordRange;
  const scaleY = pageDims.renderedHeight / coordRange;
  const boxClass =
    variant === "text"
      ? "border-2 border-amber-500 bg-amber-400/30"
      : "border-2 border-red-500 bg-red-500/20";

  let refAssigned = false;

  return (
    <>
      {elements.map((el) => {
        if (!el.page_position || el.page_position.length < 4) return null;
        const [x0, y0, x1, y1] = el.page_position;
        const width = (x1 - x0) * scaleX;
        const height = (y1 - y0) * scaleY;
        if (width <= 0 || height <= 0) return null;
        // 只把第一个有效矩形挂到 boxRef，作为居中锚点
        const shouldRef = !refAssigned && boxRef;
        if (shouldRef) refAssigned = true;
        return (
          <div
            key={el.element_id}
            ref={shouldRef ? boxRef : undefined}
            className={`pointer-events-none absolute ${boxClass}`}
            style={{
              left: `${x0 * scaleX}px`,
              top: `${y0 * scaleY}px`,
              width: `${width}px`,
              height: `${height}px`,
            }}
          />
        );
      })}
    </>
  );
}
