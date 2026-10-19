"use client";

/**
 * 对话栏上下文小圈（参考 ZCode composer 的 ring 指示器）。
 *
 * 语义：圆环填充 = 上下文使用比例（used/max_context）。
 * 颜色分级（占用预警）：<70% 主色（正常）、70–90% 琥珀（接近压缩阈值）、
 * ≥90% 红（将触发自动压缩）。缓存命中率不经圈展示，在浮层文字行里。
 */
export function ContextRing({
  pct,
  size = 16,
  stroke = 2.5,
  title,
}: {
  /** 0–100；<0 或非数按 0 处理 */
  pct: number;
  size?: number;
  stroke?: number;
  title?: string;
}) {
  const clamped = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = (clamped / 100) * c;
  const colorClass =
    clamped >= 90 ? "text-red-500" : clamped >= 70 ? "text-amber-500" : "text-primary";

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`${colorClass} shrink-0`}
      role="img"
    >
      {title ? <title>{title}</title> : null}
      {/* 轨道 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-gray-200"
        opacity={0.9}
      />
      {/* 命中弧：从 12 点方向顺时针 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${filled} ${c - filled}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
