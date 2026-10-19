import { cn } from "@/lib/utils";

/**
 * FoliaAI 品牌头像：对话区助手身份标识（智能体助手 / 知识库助手）。
 *
 * 直接使用品牌头像图（白底 PNG，public/brand/foliaai.png），两个部署分支
 * 统一同图；白底芯片 + 内边距 + 细描边。尺寸与圆角由调用处 className
 * 指定（twMerge 下后写的覆盖默认），默认 rounded-lg。
 */
export function BrandAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-gray-200/80 shadow-xs select-none",
        className,
      )}
    >
      <img
        src="/brand/foliaai.png"
        alt=""
        className="h-full w-full object-contain p-[10%]"
      />
    </div>
  );
}
