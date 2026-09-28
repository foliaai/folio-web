import { cn } from "@/lib/utils";

interface GenderBadgeProps {
  /** 性别：1=男，2=女；其他值（0/未提供）不渲染 */
  gender?: number | null;
  /** 徽章尺寸（px），默认 22 */
  size?: number;
  className?: string;
}

/**
 * 头像角标式性别标志（男 ♂ / 女 ♀）。
 *
 * lucide-react 0.468 尚无 Mars/Venus 图标，这里内联同风格 SVG
 * （等宽描边 + 圆头笔触），蓝=男、粉=女；hover 提示为文字。
 */
export function GenderBadge({ gender, size = 22, className }: GenderBadgeProps) {
  if (gender !== 1 && gender !== 2) return null;
  const isMale = gender === 1;
  const icon = Math.max(size - 8, 10);

  return (
    <span
      title={isMale ? "男" : "女"}
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-white shadow-sm ring-1",
        isMale ? "text-blue-500 ring-blue-200" : "text-pink-500 ring-pink-200",
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={icon}
        height={icon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {isMale ? (
          <>
            <circle cx="10" cy="14" r="6" />
            <path d="M14.2 9.8 20 4" />
            <path d="M15 4h5v5" />
          </>
        ) : (
          <>
            <circle cx="12" cy="8" r="6" />
            <path d="M12 14v7" />
            <path d="M9 18h6" />
          </>
        )}
      </svg>
    </span>
  );
}
