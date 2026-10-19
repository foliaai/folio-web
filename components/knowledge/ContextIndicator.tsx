"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ContextRing } from "@/components/ui/ContextRing";
import type { ContextStatusReport } from "@/lib/chat-types";

function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

function formatCompactionTime(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
      ` ${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  } catch {
    return iso;
  }
}

/** 分项配色对齐 Cursor 的上下文用量面板（构成分段） */
const SEGMENT_COLORS = {
  system: "#6b7280",
  tools: "#7b7fe3",
  skills: "#a16207",
  summary: "#c2405a",
  conversation: "#d1441f",
} as const;

export function ContextIndicator({
  report,
  cacheRate,
  className,
}: {
  report: ContextStatusReport | null;
  /** session 缓存命中率（0–1，token 加权）；null=暂无数据 */
  cacheRate?: number | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // 浮层以按钮中心居中锚定（CSS left-1/2 -translate-x-1/2）。小屏上按钮不在
  // 屏幕中线，居中后可能单侧出屏——不做位移（位移会破坏"圈在浮层下沿正中"），
  // 而是按按钮到两侧视口边的可用空间收缩宽度
  useLayoutEffect(() => {
    if (!open || !popupRef.current || !rootRef.current) return;
    const el = popupRef.current;
    el.style.width = "";
    const r = rootRef.current.getBoundingClientRect();
    const center = r.left + r.width / 2;
    const avail = Math.floor(2 * Math.min(center - 8, window.innerWidth - center - 8));
    const width = el.getBoundingClientRect().width;
    if (width > avail) el.style.width = `${Math.max(avail, 240)}px`;
  }, [open]);

  // 移动端没有 hover：点开后点外面要能收起，否则面板会一直压着对话
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // 口径与 Cursor 一致：满窗口做分母（输出预留不计入已用）
  const pct = useMemo(() => {
    if (!report || report.max_context <= 0) return 0;
    const raw = (report.used_tokens / report.max_context) * 100;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }, [report]);

  const segments = useMemo(() => {
    if (!report) return [];
    const b = report.breakdown;
    return [
      { key: "system", label: "系统提示", value: b.system, color: SEGMENT_COLORS.system },
      { key: "tools", label: "工具定义", value: b.tools_schema, color: SEGMENT_COLORS.tools },
      { key: "skills", label: "技能", value: b.skills ?? 0, color: SEGMENT_COLORS.skills },
      { key: "summary", label: "历史摘要", value: b.summary ?? 0, color: SEGMENT_COLORS.summary },
      // 当轮 user 输入（含 @ 引用块）与历史同属对话，合并展示
      { key: "conversation", label: "对话历史", value: b.history + b.user, color: SEGMENT_COLORS.conversation },
    ];
  }, [report]);

  const visibleSegments = useMemo(() => {
    return segments.filter((s) => s.value > 0);
  }, [segments]);

  const nearLimit =
    !!report && report.will_compact_at > 0 && report.used_tokens >= report.will_compact_at;

  const cachePct =
    cacheRate != null && Number.isFinite(cacheRate) ? Math.round(cacheRate * 100) : null;

  // 小圈 = session 缓存命中率（ZCode 风格 ring）；无数据时不占位
  if (!report) {
    return (
      <span
        className={cn(
          "inline-flex h-6 w-6 items-center justify-center rounded-full text-gray-300",
          className
        )}
        title="上下文用量暂不可用"
      >
        <ContextRing pct={0} size={14} title="上下文用量暂不可用" />
      </span>
    );
  }

  const denom = Math.max(report.max_context, 1);

  return (
    // 控件位于 composer 底栏：浮层必须向上弹（bottom-full），向下会被屏幕底边裁掉
    <div
      ref={rootRef}
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          // 裸圈形态：无胶囊壳，仅 hover 轻底色；预警态由圈色表达（nearLimit 文本浮层提示）
          "inline-flex h-6 w-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-gray-100 hover:text-foreground cursor-pointer",
          open && "bg-gray-100 text-foreground",
        )}
        title={`上下文 ${pct}% · ${formatTokens(report.used_tokens)} / ${formatTokens(report.max_context)}${cachePct != null ? ` · 缓存命中 ${cachePct}%` : ""}`}
        aria-expanded={open}
        aria-label="上下文与缓存命中"
      >
        {/* 小圈 = 上下文使用比例（不显数字；缓存命中看浮层行） */}
        <ContextRing pct={pct} size={14} title={`上下文 ${pct}% · 缓存命中 ${cachePct ?? 0}%`} />
      </button>

      {open ? (
        <div
          ref={popupRef}
          className={cn(
            // 圈圈恒在浮层下沿中点：居中锚定；小屏出屏由 effect 收缩宽度（不位移）
            "absolute bottom-full left-1/2 z-30 mb-1.5 max-h-[min(70vh,28rem)] w-80 max-w-[calc(100vw-1rem)] -translate-x-1/2 overflow-y-auto",
            "rounded-xl border border-gray-200 bg-white p-3 text-[11px] shadow-2xl ring-1 ring-black/5"
          )}
        >
          {/* 小三角：浮层底缘中点指向圈圈 */}
          <span
            aria-hidden
            className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-gray-200 bg-white"
          />

          <div className="mb-2 flex items-center justify-between text-foreground">
            <span className="font-medium">上下文用量</span>
            <span className="text-muted">{report.counting}</span>
          </div>

          <div className="mb-1.5 flex items-baseline justify-between">
            <span className={cn("text-[13px] font-medium", nearLimit ? "text-amber-700" : "text-foreground")}>
              已用 {pct}%
            </span>
            <span className="text-muted">
              ~{formatTokens(report.used_tokens)} / {formatTokens(report.max_context)} tokens
            </span>
          </div>

          {/* 分段用量条：段序与下方图例一致 */}
          <div className="mb-3 flex h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
            {visibleSegments.map((s) => (
              <span
                key={s.key}
                style={{
                  width: `${(s.value / denom) * 100}%`,
                  // 极小占比也要留得住颜色，否则 4% 时几乎看不到这一段
                  minWidth: 3,
                  backgroundColor: s.color,
                }}
                title={`${s.label} ${formatTokens(s.value)}`}
              />
            ))}
          </div>

          <div className="space-y-1">
            {visibleSegments.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                  <span
                    className="h-2 w-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: s.color }}
                    aria-hidden
                  />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className="shrink-0 text-muted">{formatTokens(s.value)}</span>
              </div>
            ))}
          </div>

          {/* 缓存命中（与构成同板展示；小圈即此数据的图形化） */}
          {cachePct != null ? (
            <div className="mt-2 flex items-center justify-between gap-3 border-t border-gray-100 pt-2">
              <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                <ContextRing pct={cachePct} size={12} />
                <span className="truncate" title="本会话前缀缓存平均命中率（按 token 加权）">
                  缓存命中
                </span>
              </span>
              <span className="shrink-0 text-muted">{cachePct}%</span>
            </div>
          ) : null}

          <div className="mt-2 space-y-1 border-t border-gray-100 pt-2 text-muted">
            <div className="flex justify-between">
              <span>输出预留</span>
              <span>{formatTokens(report.reserved_output)}</span>
            </div>
            <div className="flex justify-between">
              <span>自动压缩阈值</span>
              <span>{formatTokens(report.will_compact_at)}</span>
            </div>
          </div>

          {nearLimit ? <p className="mt-2 text-amber-700">接近上限，将自动压缩</p> : null}

          {report.last_compaction ? (
            <p className="mt-2 border-t border-gray-100 pt-2 text-muted">
              上次压缩：{formatCompactionTime(report.last_compaction.at)}
              {report.last_compaction.input_tokens != null &&
              report.last_compaction.summary_tokens != null
                ? ` · ${formatTokens(report.last_compaction.input_tokens)} → ${formatTokens(report.last_compaction.summary_tokens)}`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
