/**
 * 部署品牌配置
 *
 * 同一份代码两处部署，品牌随 AUTH_PROVIDER 走：
 * - oa   → 企业内网部署（捷配 192.168.19.x，捷配 OA 登录）：捷配白标品牌
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
  /** 左侧卖点列表（能力名 + 简述；未上线的标注「规划中」） */
  points: string[];
  /** 登录身份源名称（按钮与欢迎语用） */
  idpLabel: string;
  /** 按钮下方信任行 */
  trustLine: string;
  /** 左下角版权行 */
  copyright: string;
  /** 品牌 Logo 图片（public/ 下路径）；留空回退为通用图形图标 */
  logoUrl?: string;
  /**
   * Logo 呈现方式：
   * - chip：白底圆角芯片 + 内边距（适合白底 PNG，如 FoliaAI 组织头像）
   * - raw ：图片自带完整底色方块，直接裸放（如捷配青绿方标），加细描边提亮
   */
  logoStyle?: "chip" | "raw";
  /** 品牌标语（品牌行下方小字；留空不显示） */
  slogan?: string;
}

const JIEPEI_BRAND: BrandConfig = {
  name: "捷配 AI 工作台",
  headline: ["面向捷配全员的", "AI 能力工作台"],
  description:
    "知识、技能与 Agent 汇于一个入口：企业知识可沉淀，AI 能力可复用，专属 Agent 可定制。",
  points: [
    "知识库：上传文档建立索引，围绕私有资料检索与问答",
    "技能中心：开箱即用的 AI 能力单元，持续沉淀复用",
    "通用智能体（规划中）：以知识库为记忆底座，首页即开即用的 AI 助手",
    "定制 Agent（规划中）：面向岗位与流程编排专属智能体",
  ],
  idpLabel: "捷配 OA",
  trustLine: "会话加密传输，符合企业安全合规要求",
  copyright: "捷配科技 © 2026 · 捷配 AI 工作台",
  // 无极系统同款方标（青绿 #00989D 自带圆角方块），裸放于深绿面板
  logoUrl: "/brand/jiepei.png",
  logoStyle: "raw",
  slogan: "让产业更高效，让生活更美好！",
};

const FOLIA_BRAND: BrandConfig = {
  name: "FoliaAI",
  headline: ["一站式", "AI 知识与智能体平台"],
  description:
    "私有知识可检索可问答，AI 能力可组合可编排——知识库、技能与定制 Agent 的统一入口。",
  points: [
    "知识系统：文档统一管理、语义检索与智能问答",
    "技能（Skill）：可复用的 AI 能力，自由组合调用",
    "通用智能体（规划中）：打通个人知识库，检索、推理与执行一站完成",
    "定制 Agent（规划中）：按需编排个人与团队专属智能体",
  ],
  idpLabel: "Logto",
  trustLine: "登录会话加密传输，保障账号与数据安全",
  copyright: "FoliaAI © 2026",
  // GitHub 组织头像原图（256px，白底），本地化存放避免外链
  logoUrl: "/brand/foliaai.png",
  logoStyle: "chip",
};

export function getBrandConfig(): BrandConfig {
  return getAuthProviderName() === "oa" ? JIEPEI_BRAND : FOLIA_BRAND;
}
