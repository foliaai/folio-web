"use client";

/**
 * ExcelFileView - xlsx/xls 文件预览（元素流驱动）
 *
 * 数据来自后端 excel-content 端点：page_index=工作表 分组，卡片=元素
 * （table 卡 / image 卡 / 孤立文本行卡）。与 md 的 type_ordinal 分桶
 * 锚定不同，卡片本身带 element_id，chunk 框选直接按 id 匹配——渲染块
 * 与元素流一一对应，零歧义。
 *
 * 窄屏（≤640px）：sheet 标签栏与表格容器各自横向滚动。
 */

import { ImageIcon, Loader2, Sheet, Table2, AlertCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { fetchExcelContent } from "@/lib/api/knowledge";
import type {
  ElementPosition,
  ExcelCardElement,
  ExcelContentResponse,
  KnowledgeFile,
} from "@/lib/knowledge-types";
import { formatBytes } from "@/lib/utils";
import { sanitizeCitationHtml } from "@/components/knowledge/citationPreviewUtils";
import { FileUploaderMeta } from "@/components/knowledge/FileUploaderMeta";

interface ExcelHighlight {
  chunkId: string | null;
  chunkType: string;
  elements: ElementPosition[];
}

interface ExcelFileViewProps {
  file: KnowledgeFile;
  highlight?: ExcelHighlight | null;
}

const HIGHLIGHT_CLASS = "excel-card-highlight";
const HIGHLIGHT_CLEAR_MS = 3200;

export function ExcelFileView({ file, highlight }: ExcelFileViewProps) {
  const [data, setData] = useState<ExcelContentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const cardsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetchExcelContent(file.file_id)
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setActiveSheet(0);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Excel 内容加载失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [file.file_id]);

  // 框选：chunk 关联元素按 element_id 直配卡片；跨 sheet 时先切换标签页
  useEffect(() => {
    if (!data || !highlight) return;
    const ids = new Set(highlight.elements.map((e) => e.element_id));
    const hitSheet = data.sheets.find((s) =>
      s.elements.some((el) => ids.has(el.element_id))
    );
    if (!hitSheet) return;
    if (hitSheet.page_index !== activeSheet) {
      setActiveSheet(hitSheet.page_index);
    }
    const container = cardsRef.current;
    if (!container) return;
    const targets: HTMLElement[] = [];
    for (const node of Array.from(container.children)) {
      if (
        node instanceof HTMLElement &&
        node.dataset.elementId &&
        ids.has(node.dataset.elementId)
      ) {
        targets.push(node);
      }
    }
    if (targets.length === 0) return;
    targets[0].scrollIntoView({ behavior: "smooth", block: "center" });
    for (const t of targets) t.classList.add(HIGHLIGHT_CLASS);
    const timer = setTimeout(() => {
      for (const t of targets) t.classList.remove(HIGHLIGHT_CLASS);
    }, HIGHLIGHT_CLEAR_MS);
    return () => {
      clearTimeout(timer);
      for (const t of targets) t.classList.remove(HIGHLIGHT_CLASS);
    };
    // activeSheet 依赖：切换标签页后 DOM 重建，需重跑匹配
  }, [data, highlight, activeSheet]);

  const sheet = useMemo(
    () => data?.sheets.find((s) => s.page_index === activeSheet),
    [data, activeSheet]
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2.5">
        <Sheet className="h-4 w-4 shrink-0 text-muted" />
        <span className="truncate text-sm text-foreground">{file.file_name}</span>
        {file.file_size ? (
          <span className="shrink-0 text-xs text-muted">
            {formatBytes(file.file_size)}
          </span>
        ) : null}
        <FileUploaderMeta userId={file.user_id} createdAt={file.create_time} />
        <span className="ml-auto shrink-0 text-xs text-muted">
          Excel · {data ? `${data.total_sheets} 个工作表` : ""}
        </span>
      </div>

      {data && data.total_sheets > 1 ? (
        <div className="flex gap-1 overflow-x-auto border-b border-gray-200 bg-gray-50 px-2 py-1.5">
          {data.sheets.map((s) => (
            <button
              key={s.page_index}
              type="button"
              onClick={() => setActiveSheet(s.page_index)}
              className={
                s.page_index === activeSheet
                  ? "shrink-0 rounded-md bg-white px-3 py-1 text-xs font-medium text-primary shadow-sm"
                  : "shrink-0 rounded-md px-3 py-1 text-xs text-muted transition-colors hover:bg-white hover:text-foreground"
              }
            >
              {s.title}
            </button>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto bg-gray-100">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center p-8">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <p className="mt-2 text-sm text-muted">Excel 预览加载失败：{error}</p>
          </div>
        ) : !sheet ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted" />
            <span className="ml-2 text-sm text-muted">正在加载工作簿...</span>
          </div>
        ) : sheet.elements.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            该工作表没有可预览的内容
          </div>
        ) : (
          <div
            ref={cardsRef}
            className="mx-auto w-full max-w-4xl space-y-4 px-3 py-4 md:px-6 md:py-6"
          >
            {sheet.elements.map((el) => (
              <ExcelCard key={el.element_id} element={el} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ExcelCard({ element }: { element: ExcelCardElement }) {
  if (element.type === "table" && element.table_body) {
    return (
      <div
        data-element-id={element.element_id}
        className="excel-card overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
      >
        {element.caption ? (
          <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
            <Table2 className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate text-xs font-medium text-foreground">
              {element.caption}
            </span>
          </div>
        ) : null}
        <div className="overflow-x-auto px-3 py-2.5 text-[13px] text-gray-800 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[13px] [&_td]:border [&_td]:border-gray-200 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_th]:border [&_th]:border-gray-200 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-gray-50 [&_th]:font-medium [&_tr]:break-inside-avoid">
          <div
            dangerouslySetInnerHTML={{
              __html: sanitizeCitationHtml(element.table_body),
            }}
          />
        </div>
        {element.footnote ? (
          <div className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-muted">
            {element.footnote}
          </div>
        ) : null}
      </div>
    );
  }

  if (element.type === "image") {
    return (
      <div
        data-element-id={element.element_id}
        className="excel-card overflow-hidden rounded-xl border border-gray-200 bg-white p-3 shadow-sm"
      >
        <div className="mb-2 flex items-center gap-2">
          <ImageIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate text-xs font-medium text-foreground">
            {element.caption || "插图"}
          </span>
        </div>
        {element.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={element.image_url}
            alt={element.caption || "Excel 插图"}
            loading="lazy"
            className="max-h-96 w-auto max-w-full rounded-lg border border-gray-200"
          />
        ) : (
          <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-4 text-xs text-muted">
            <ImageIcon className="h-4 w-4" />
            图片不可用（上传失败或已过期）
          </div>
        )}
      </div>
    );
  }

  // 孤立文本行（单行表保留形态）
  return (
    <div
      data-element-id={element.element_id}
      className="excel-card rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-800 shadow-sm"
    >
      {element.text}
    </div>
  );
}
