import type { ComponentType } from "react";

/**
 * FoliaAI 品牌叶子图标（lucide 线条风格手绘版）。
 *
 * 与浏览器标签页 favicon 同源的"网络叶子"图案：斜置叶片 + 主叶脉 +
 * 分支侧脉 + 节点圆点。stroke 跟随 currentColor，与侧边栏其余 lucide
 * 图标同样随激活态变色；线条粗细 / 圆角端点也对齐 lucide 默认风格。
 * 公网与 OA 两个部署分支的「首页」统一使用。
 */
export const FoliaLeafIcon: ComponentType<{ className?: string }> = ({
  className,
}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {/* 叶片轮廓（叶尖朝右上，柄朝左下；上下缘弧线充分外鼓保证叶宽） */}
    <path d="M4 20C2.5 9.5 8.5 2.5 20 4c1.5 10.5-5.5 18-16 16Z" />
    {/* 主叶脉 */}
    <path d="M5 19 19 5" />
    {/* 分支侧脉（垂直于主脉，交替向叶缘两侧分出） */}
    <path d="M8 16 6.2 14.2" />
    <path d="M10 14l2.2 2.2" />
    <path d="M11.5 12.5 9.3 10.3" />
    <path d="M13.5 10.5l2.2 2.2" />
    <path d="M15.5 8.5 13.3 6.3" />
    {/* 网络节点圆点 */}
    <circle cx="5.6" cy="13.6" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="12.8" cy="16.8" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="8.7" cy="9.7" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="16.3" cy="13.3" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="12.7" cy="5.7" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="5" cy="18.6" r="1.05" fill="currentColor" stroke="none" />
  </svg>
);
