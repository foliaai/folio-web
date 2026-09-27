"use client";

import { useEffect, useMemo, useState } from "react";
import { generateInitialData } from "@/lib/identicon";
import { cn } from "@/lib/utils";

export interface UserAvatarProps {
  userId?: string | null;
  avatarUrl?: string | null;
  name?: string | null;
  size?: number | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  shape?: "rounded" | "rounded-lg" | "rounded-xl" | "rounded-2xl" | "rounded-full";
  className?: string;
  alt?: string;
}

const SIZE_MAP: Record<string, number> = {
  xs: 20,
  sm: 28,
  md: 32,
  lg: 40,
  xl: 56,
  "2xl": 72,
};

export function UserAvatar({
  userId,
  avatarUrl,
  name,
  size = "md",
  shape = "rounded-xl",
  className,
  alt,
}: UserAvatarProps) {
  const [imageError, setImageError] = useState(false);
  const targetUserId = userId || "default_user";
  const pixelSize = typeof size === "number" ? size : SIZE_MAP[size] || 32;

  // 头像 URL 变化（上传新头像带新时间戳）时重置错误态：
  // 否则一次瞬时加载失败会永久锁存，只能靠组件重挂载（刷新页面）恢复
  useEffect(() => {
    setImageError(false);
  }, [avatarUrl]);

  // 计算 Initials 品牌渐变徽章数据
  const initialData = useMemo(() => {
    return generateInitialData(targetUserId, name);
  }, [targetUserId, name]);

  const shapeClass = {
    rounded: "rounded-md",
    "rounded-lg": "rounded-lg",
    "rounded-xl": "rounded-xl",
    "rounded-2xl": "rounded-2xl",
    "rounded-full": "rounded-full",
  }[shape];

  const hasCustomAvatar = Boolean(avatarUrl) && !imageError;
  const fontSize = Math.max(11, Math.round(pixelSize * 0.44));

  return (
    <div
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden transition-transform",
        shapeClass,
        className
      )}
      style={{
        width: `${pixelSize}px`,
        height: `${pixelSize}px`,
      }}
      title={name || targetUserId}
    >
      {hasCustomAvatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl!}
          alt={alt || name || `User avatar for ${targetUserId}`}
          className={cn("h-full w-full object-cover", shapeClass)}
          onError={() => setImageError(true)}
          loading="lazy"
        />
      ) : (
        /* Initials 品牌微渐变字符徽章 */
        <div
          className={cn(
            "flex h-full w-full items-center justify-center font-bold text-white shadow-xs",
            shapeClass
          )}
          style={{
            background: `linear-gradient(135deg, ${initialData.gradient.from} 0%, ${initialData.gradient.to} 100%)`,
            fontSize: `${fontSize}px`,
            lineHeight: 1,
            textShadow: "0 1px 2px rgba(0, 0, 0, 0.15)",
          }}
        >
          <span className="translate-y-[0.5px]">{initialData.char}</span>
        </div>
      )}
    </div>
  );
}
