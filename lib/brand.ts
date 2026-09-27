/**
 * 部署品牌配置
 *
 * 同一份代码两处部署，品牌随 AUTH_PROVIDER 走：
 * - oa   → 企业内网部署（捷配 192.168.19.x，捷配 OA 登录）：捷配品牌
 * - logto → 公网部署（hijarson.com，自建 Logto）：FoliaAI 品牌
 *
 * 样式共用，仅文案不同；新增品牌相关文案一律加到这里，不要写死在页面里。
 */
import { getAuthProviderName } from "./auth-providers";

export interface BrandConfig {
  /** 产品名（左上角品牌、欢迎语中的产品指代） */
  name: string;
  /** 大标题两行（第一行轻字重、第二行粗字重） */
  headline: [string, string];
  /** 一句话产品定位 */
  description: string;
  /** 左侧卖点列表 */
  points: string[];
  /** 登录身份源名称（按钮与欢迎语用，覆盖通用 provider label） */
  idpLabel: string;
  /** 左下角版权行 */
  copyright: string;
  /** IT 支持邮箱（企业内网部署配置）；公网部署留空，落版改用帮助中心链接 */
  supportEmail?: string;
  /** 品牌 Logo 图片（public/ 下路径）；留空回退为通用图形图标 */
  logoUrl?: string;
}

const JIEPEI_BRAND: BrandConfig = {
  name: "捷配 AI Studio",
  headline: ["企业级", "AI 使用底座"],
  description: "统一入口、可管控、可审计的内部 AI 使用平台，保障数据安全合规。",
  points: [
    "OA 账号统一登录，无需注册",
    "RBAC 权限控制，角色化模型授权",
    "共享配额账本，Chat 与 API 统一治理",
    "全链路审计日志，安全合规可追溯",
  ],
  idpLabel: "捷配 OA",
  copyright: "捷配科技 © 2026 · 捷配 AI Studio MVP v0.1",
  supportEmail: "it-support@jiepei.com",
};

const FOLIA_BRAND: BrandConfig = {
  name: "FoliaAI",
  headline: ["统一入口", "AI 知识底座"],
  description:
    "知识库、技能与 Agent 的统一使用入口，可管控、可审计，保障数据安全合规。",
  points: [
    "统一身份登录，无需注册",
    "知识库统一管理，文档检索与智能问答",
    "技能中心，可复用的 AI 能力编排",
    "RBAC 角色权限，全链路登录审计",
  ],
  idpLabel: "Logto",
  copyright: "FoliaAI © 2026 · AI 知识与技能平台 MVP v0.1",
  // GitHub 组织头像原图（256px），本地化存放避免外链
  logoUrl: "/brand/foliaai.png",
};

export function getBrandConfig(): BrandConfig {
  return getAuthProviderName() === "oa" ? JIEPEI_BRAND : FOLIA_BRAND;
}
