"use client";

/**
 * CitationChip - 内联引用 chip
 *
 * - 浮层通过 createPortal 挂到 document.body，避免落在 markdown 的 <p> 内触发非法嵌套与 hydration 报错；
 * - 表格 preview：table_caption / table_body(HTML) / table_footnote，表体区域固定 max-height + 双向滚动；
 * - 图片 preview：image_* 分段或 Markdown 图片，标题/脚注 + 原图（安全 src 白名单）；
 * - 其余 preview：GFM + KaTeX（CitationPreviewMarkdown）；
 * - 点击在有 file_id 时打开原文档。
 */

import {
  AlignJustify,
  AlertTriangle,
  FileText,
  Image as ImageIcon,
  Table as TableIcon,
} from "lucide-react";
import {
  type ComponentType,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Citation } from "@/lib/chat-types";
import { buildChunkImageRawUrl } from "@/lib/api/knowledge";
import { openFilePreview } from "@/lib/file-preview";
import { CitationPreviewMarkdown } from "@/components/knowledge/CitationPreviewMarkdown";
import { cn } from "@/lib/utils";
import {
  normalizeCitationAnnotation,
  parseImagePreviewPreview,
  parseTablePreviewPreview,
  sanitizeCitationHtml,
  sanitizeCitationImageSrc,
} from "@/components/knowledge/citationPreviewUtils";

export interface CitationChipProps {
  index: number | "?";
  citation?: Citation;
  rawChunkId: string;
}

const CHUNK_TYPE_ICON: Record<
  string,
  ComponentType<{ className?: string }>
> = {
  table: TableIcon,
  image: ImageIcon,
  text: AlignJustify,
};

const CHUNK_TYPE_LABEL: Record<string, string> = {
  table: "表格",
  image: "图片",
  text: "文本",
};

function shortHash(chunkId: string): string {
  const m = chunkId.match(/^chunk-([0-9a-f]{6,12})/i);
  return m ? m[1] : chunkId.slice(0, 8);
}

const POPOVER_W = 288;
const VIEW_PAD = 8;
const HOVER_CLOSE_MS = 160;

// 全局单例管理器：确保同一时刻整个页面最多只有一个 CitationChip 浮层处于打开状态
// 当鼠标在相邻引用芯片之间移动时，瞬时切换，消除多浮层叠加的残影 (Issue #25)
type ActivePopoverListener = (activeId: string | null) => void;
const activeListeners = new Set<ActivePopoverListener>();
let currentActivePopoverId: string | null = null;

function setActivePopover(id: string | null) {
  currentActivePopoverId = id;
  for (const listener of activeListeners) {
    listener(id);
  }
}

function usePopoverPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popRef: RefObject<HTMLDivElement | null>,
  positionKey: string,
) {
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const pop = popRef.current;
    if (!anchor || !pop) return;

    const place = () => {
      const a = anchor.getBoundingClientRect();
      const p = pop.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = a.bottom + 6;
      let left = a.left;
      if (top + p.height > vh - VIEW_PAD) {
        top = Math.max(VIEW_PAD, a.top - p.height - 6);
      }
      if (left + p.width > vw - VIEW_PAD) {
        left = vw - p.width - VIEW_PAD;
      }
      if (left < VIEW_PAD) left = VIEW_PAD;
      if (top < VIEW_PAD) top = VIEW_PAD;
      pop.style.top = `${top}px`;
      pop.style.left = `${left}px`;
    };

    place();

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(place);
      ro.observe(pop);
    }
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      ro?.disconnect();
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, positionKey, anchorRef, popRef]);
}

/**
 * 从中文格式的 preview 中解析图片标题和脚注
 * 格式：[图片]\n标题：xxx\n脚注：xxx
 */
function parseChineseImagePreview(raw: string): { caption: string; footnote: string } | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const caption =
    normalizeCitationAnnotation(
      s.match(/标题[：:]\s*(.+?)(?:\n|$)/)?.[1]?.trim() ?? ""
    ) ?? "";
  const footnote =
    normalizeCitationAnnotation(
      s.match(/脚注[：:]\s*(.+?)(?:\n|$)/)?.[1]?.trim() ?? ""
    ) ?? "";
  if (!caption && !footnote) return null;
  return { caption, footnote };
}

/** 按 chunk_id 直读后端 /raw-image 流式端点的图片组件 */
function CitationImageLoader({
  chunkId,
  caption,
  footnote,
}: {
  chunkId: string;
  caption?: string;
  footnote?: string;
}) {
  // 直读后端 /raw-image 流式端点（公网域名 + query token 鉴权），
  // 不再走 MinIO 预签名 URL（内网域名 + http，浏览器不可用）。
  const [error, setError] = useState<string | null>(null);
  const rawUrl = buildChunkImageRawUrl(chunkId);

  return (
    <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 text-left">
      {/* 图片 */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-md border border-gray-200 bg-gray-50/80 p-1.5">
        {error ? (
          <div className="flex items-center justify-center gap-1.5 py-6 text-[11px] text-red-500">
            <AlertTriangle className="h-3.5 w-3.5" />
            {error}
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={rawUrl}
            alt={caption || "引用图片"}
            className="mx-auto max-h-[min(55vh,20rem)] w-auto max-w-full object-contain"
            loading="lazy"
            onError={() => setError("图片加载失败")}
          />
        )}
      </div>
      {/* 标题（支持 LaTeX） */}
      {caption ? (
        <div className="shrink-0 px-1 text-[11px] text-gray-700">
          <CitationPreviewMarkdown content={caption} />
        </div>
      ) : null}
      {/* 脚注 */}
      {footnote ? (
        <div className="shrink-0 px-1 text-[10px] text-gray-500">
          <CitationPreviewMarkdown content={footnote} />
        </div>
      ) : null}
    </div>
  );
}

export function CitationPreviewBody({
  preview,
  chunkType,
  chunkId,
}: {
  preview: string;
  chunkType?: string | null;
  /** 图片 chunk ID，用于按需加载图片 URL */
  chunkId?: string | null;
}) {
  const table = useMemo(() => parseTablePreviewPreview(preview), [preview]);
  const imageParts = useMemo(() => parseImagePreviewPreview(preview), [preview]);

  // 当英文 key 解析失败但 chunk_type 是 image 时，尝试中文格式
  const chineseImageParts = useMemo(() => {
    if (imageParts || chunkType !== "image") return null;
    return parseChineseImagePreview(preview);
  }, [imageParts, chunkType, preview]);

  // 必须由 chunk 类型决定是否加载原图：PPT 的 MinerU 预览常只有「[图片]」，
  // 没有 image_caption / 标题字段，不能因此退化成纯文本预览。
  const useImageLayout =
    chunkType === "image" ||
    Boolean(
      imageParts &&
        (/image_(caption|footnote|body)\s*:/i.test(preview) ||
          imageParts.imageUrl)
    );

  if (table) {
    // 表体两种形态：MinerU 系存 HTML（<table>/<tr> 标签）走 innerHTML；
    // markdown 系存 GFM 管道原文（| 引脚 | …），须走 remark-gfm 渲染，
    // 注入 innerHTML 只会得到裸文本管道
    const isHtmlTable = /<(table|tr|td|th)\b/i.test(table.bodyHtml);
    return (
      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 text-left">
        {table.caption ? (
          <div className="shrink-0 rounded-md bg-gray-50 px-2 py-1.5 text-[11px] font-medium text-gray-900">
            <CitationPreviewMarkdown content={table.caption} />
          </div>
        ) : null}
        <div
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain rounded-md border border-gray-200 bg-white",
            "citation-preview-table text-[10px] leading-tight text-gray-900",
            "[&_table]:min-w-full [&_table]:border-collapse",
            "[&_td]:border [&_td]:border-gray-200 [&_td]:px-1.5 [&_td]:py-1",
            "[&_th]:border [&_th]:border-gray-200 [&_th]:bg-gray-50 [&_th]:px-1.5 [&_th]:py-1"
          )}
        >
          {isHtmlTable ? (
            <div
              dangerouslySetInnerHTML={{
                __html: sanitizeCitationHtml(table.bodyHtml),
              }}
            />
          ) : (
            <CitationPreviewMarkdown content={table.bodyHtml} />
          )}
        </div>
        {table.footnote ? (
          <div className="shrink-0 rounded-md bg-gray-50 px-2 py-1.5 text-[10px] text-gray-600">
            <CitationPreviewMarkdown content={table.footnote} />
          </div>
        ) : null}
      </div>
    );
  }

  if (useImageLayout) {
    // 优先使用英文 key 解析结果，其次中文格式
    const caption = imageParts?.caption || chineseImageParts?.caption || "";
    const footnote = imageParts?.footnote || chineseImageParts?.footnote || "";
    const imageUrl = imageParts?.imageUrl ?? null;
    const safeSrc = imageUrl ? sanitizeCitationImageSrc(imageUrl) : null;

    // 如果有图片 URL（来自 read_image_chunks 工具结果），直接渲染
    if (safeSrc) {
      return (
        <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 text-left">
          {/* 图片 */}
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-md border border-gray-200 bg-gray-50/80 p-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={safeSrc}
              alt={caption || "引用图片"}
              className="mx-auto max-h-[min(55vh,20rem)] w-auto max-w-full object-contain"
              loading="lazy"
            />
          </div>
          {/* 标题（支持 LaTeX） */}
          {caption ? (
            <div className="shrink-0 px-1 text-[11px] text-gray-700">
              <CitationPreviewMarkdown content={caption} />
            </div>
          ) : null}
          {/* 脚注 */}
          {footnote ? (
            <div className="shrink-0 px-1 text-[10px] text-gray-500">
              <CitationPreviewMarkdown content={footnote} />
            </div>
          ) : null}
        </div>
      );
    }

    // 没有图片 URL：如果有 chunkId，按需加载；否则显示占位
    if (chunkId) {
      return (
        <CitationImageLoader
          chunkId={chunkId}
          caption={caption}
          footnote={footnote}
        />
      );
    }

    return (
      <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 text-left">
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-md border border-gray-200 bg-gray-50/80 p-1.5">
          <div className="px-2 py-6 text-center text-[11px] text-muted">
            （预览中无可用图片链接）
          </div>
        </div>
        {caption ? (
          <div className="shrink-0 px-1 text-[11px] text-gray-700">
            <CitationPreviewMarkdown content={caption} />
          </div>
        ) : null}
        {footnote ? (
          <div className="shrink-0 px-1 text-[10px] text-gray-500">
            <CitationPreviewMarkdown content={footnote} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5 text-left">
      <CitationPreviewMarkdown content={preview} />
    </div>
  );
}

export function CitationChip({
  index,
  citation,
  rawChunkId,
}: CitationChipProps) {
  const chipId = useId();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => {
      setOpen(false);
      if (currentActivePopoverId === chipId) {
        setActivePopover(null);
      }
    }, HOVER_CLOSE_MS);
  }, [cancelScheduledClose, chipId]);

  const handleOpen = useCallback(() => {
    cancelScheduledClose();
    // 激活当前浮层并瞬时关闭其他已打开的 CitationChip，避免重叠残影
    setActivePopover(chipId);
    setOpen(true);
  }, [cancelScheduledClose, chipId]);

  // 监听全局 active popover 变更：若其他 chip 被激活，当前 chip 立即无延迟关闭并清理定时器
  useEffect(() => {
    const onActiveChange: ActivePopoverListener = (activeId) => {
      if (activeId !== chipId) {
        cancelScheduledClose();
        setOpen(false);
      }
    };
    activeListeners.add(onActiveChange);
    return () => {
      activeListeners.delete(onActiveChange);
      cancelScheduledClose();
      if (currentActivePopoverId === chipId) {
        currentActivePopoverId = null;
      }
    };
  }, [cancelScheduledClose, chipId]);

  const hasFullMeta = Boolean(citation?.file_id || citation?.file_name);
  const ChunkIcon =
    (citation?.chunk_type && CHUNK_TYPE_ICON[citation.chunk_type]) || FileText;
  const typeLabel =
    (citation?.chunk_type && CHUNK_TYPE_LABEL[citation.chunk_type]) || "片段";

  const fileName = citation?.file_name || "未知文件";
  const pageText =
    typeof citation?.page_index === "number"
      ? `p.${citation.page_index + 1}`
      : null;
  const sectionTitle = citation?.section_title || null;
  const preview = citation?.preview || null;

  const positionKey = `${preview ?? ""}|${citation?.chunk_type ?? ""}|${citation?.chunk_id ?? ""}`;

  usePopoverPosition(open, anchorRef, popRef, positionKey);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const fileId = citation?.file_id;
    if (!fileId) return;
    openFilePreview({ fileId, chunkId: citation?.chunk_id ?? null });
  };

  const popoverEl =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popRef}
            role="tooltip"
            onMouseEnter={cancelScheduledClose}
            onMouseLeave={scheduleClose}
            className={cn(
              "fixed z-[100] flex flex-col rounded-xl border border-gray-200 bg-white p-3 text-left shadow-xl",
              "max-h-[min(80vh,28rem)] max-w-[min(288px,calc(100vw-16px))] overflow-hidden",
            )}
            style={{
              pointerEvents: "auto",
              top: 0,
              left: 0,
              width: POPOVER_W,
            }}
          >
            <div className="shrink-0 space-y-0.5 border-b border-gray-100 pb-2">
              <div className="flex items-center gap-1.5 text-[11px] text-blue-700">
                <ChunkIcon className="h-3 w-3 shrink-0" />
                <span className="font-medium">{typeLabel}</span>
              </div>
              <div className="truncate text-[12px] font-medium leading-snug text-foreground">
                {fileName}
                {pageText ? (
                  <span className="ml-1 font-normal text-muted">· {pageText}</span>
                ) : null}
              </div>
              {sectionTitle ? (
                <div className="truncate text-[11px] leading-snug text-muted">
                  {sectionTitle}
                </div>
              ) : null}
            </div>
            {preview ? (
              <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden">
                <CitationPreviewBody
                  preview={preview}
                  chunkType={citation?.chunk_type}
                  chunkId={citation?.chunk_id}
                />
              </div>
            ) : (
              <div className="mt-2 text-[11px] text-muted">（暂无预览）</div>
            )}
            {!hasFullMeta ? (
              <div className="mt-2 text-[10px] text-amber-600">
                元数据不完整（id: {shortHash(rawChunkId)}）
              </div>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <span className="relative inline-block align-baseline">
      <button
        ref={anchorRef}
        type="button"
        onClick={handleClick}
        onMouseEnter={handleOpen}
        onMouseLeave={scheduleClose}
        disabled={!citation?.file_id}
        className={cn(
          "inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium leading-none align-middle mx-0.5 transition-colors",
          hasFullMeta
            ? "bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer ring-1 ring-primary/20"
            : "bg-gray-100 text-gray-500 ring-1 ring-gray-200 cursor-default"
        )}
        title={hasFullMeta ? "点击打开原文档" : "引用片段（无法跳转）"}
      >
        <ChunkIcon className="h-3 w-3" />
        <span>{index}</span>
      </button>
      {popoverEl}
    </span>
  );
}
