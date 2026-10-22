import type { ComponentType } from "react";
import { Bot, Library, Sparkle } from "lucide-react";
import { FoliaLeafIcon } from "@/lib/icons";

export type FeatureKey = "home" | "agents" | "knowledge" | "skills" | "teams";

export interface FeatureConfig {
  key: FeatureKey;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * 始终锁定（敬请期待），与登录态无关。
   * 登录前后都不可进入：未登录点击直跳登录页，登录后点击无动作（不弹窗）。
   */
  locked?: boolean;
  /**
   * 需要登录才能访问。登录前点击直跳登录页（带 next 回跳）。
   * locked 优先级高于 requiresAuth。
   */
  requiresAuth?: boolean;
}

/**
 * 侧栏导航特性清单（唯一事实源）。
 *
 * 当前开放策略：
 *   - 首页：通用智能体（M2 上线），登录后解锁
 *   - 知识库 / 技能：登录前锁定，登录后解锁
 *   - 智能体：始终锁定（DIY 属 M3，敬请期待）
 *
 * 团队不占一级导航：团队管理内嵌在知识库工作台（团队库行内「成员」入口），
 * FeatureKey 保留 "teams" 仅为类型兼容。
 * 顺序与移动端底栏一致（首页/知识库/技能/智能体）；label 两端部署统一，不随品牌变化。
 */
export const FEATURES: FeatureConfig[] = [
  { key: "home", label: "首页", href: "/", icon: FoliaLeafIcon, requiresAuth: true },
  { key: "knowledge", label: "知识库", href: "/knowledge", icon: Library, requiresAuth: true },
  { key: "skills", label: "技能", href: "/skills", icon: Sparkle, requiresAuth: true },
  { key: "agents", label: "智能体", href: "/agents", icon: Bot, locked: true },
];

export function isFeatureAccessible(
  feature: FeatureConfig,
  isAuthenticated: boolean,
): boolean {
  if (feature.locked) return false;
  if (feature.requiresAuth && !isAuthenticated) return false;
  return true;
}
