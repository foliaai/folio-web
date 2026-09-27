"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  Code2,
  Github,
  User,
} from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";

function ZhihuIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <rect width="24" height="24" rx="5" fill="currentColor" />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#fff"
        fontSize="13"
        fontWeight="700"
        fontFamily="system-ui, 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans SC', sans-serif"
      >
        知
      </text>
    </svg>
  );
}

const DEVELOPER = {
  name: "蔡雄江",
  englishName: "Jarson Cai",
  title: "全栈开发工程师 · AI 产品设计师",
  bio: "研究兴趣包括 RAG、Agent、LLM 应用、计算机视觉与参数高效微调。希望通过检索、对话和溯源把资料真正用起来，让 AI 成为可核对、可落地的工作助手。",
  github: "https://github.com/foliaai",
  githubHandle: "foliaai",
  personalGithub: "https://github.com/caixiongjiang",
  personalGithubHandle: "caixiongjiang",
  zhihu: "https://www.zhihu.com/people/cai-xiong-jiang",
};

const PROJECTS = [
  {
    name: "folio-web",
    desc: "本站前端。知识库问答、文档预览与 bbox 溯源、技能管理。",
    href: "https://github.com/foliaai/folio-web",
  },
  {
    name: "folio-aks-server",
    desc: "Agentic 知识库后端：多粒度检索、流式对话、引用与索引管线。",
    href: "https://github.com/foliaai/folio-aks-server",
  },
  {
    name: "folio-auth-server",
    desc: "统一认证与系统设置服务：企业 OA / Logto 双上游登录，全系统唯一的本域 JWT 签发方。",
    href: "https://github.com/foliaai/folio-auth-server",
  },
  {
    name: "folio-auth-core",
    desc: "认证验签核心包（verify-only）：各后端经 JWKS 公钥本地验签，消费 folio-auth-server 签发的凭证。",
    href: "https://github.com/foliaai/folio-auth-core",
  },
  {
    name: "folio-skill-server",
    desc: "技能管理独立服务：技能 CRUD、启停、封面存储，对外提供 REST API。",
    href: "https://github.com/foliaai/folio-skill-server",
  },
  {
    name: "folio-skill-core",
    desc: "技能系统核心包：解析、注册表、安全扫描与 MySQL 仓储，供 folio-skill-server 与各后端复用。",
    href: "https://github.com/foliaai/folio-skill-core",
  },
  {
    name: "folio-agent-server",
    desc: "智能体应用平台：会议纪要合规检查等 Agent 应用，与文档解析、文件存储公共服务。",
    href: "https://github.com/foliaai/folio-agent-server",
  },
  {
    name: "folio-infra",
    desc: "Docker 化的支撑基础设施：一键拉起系统依赖的中间件与基础服务。",
    href: "https://github.com/foliaai/folio-infra",
  },
  {
    name: "folio-server",
    desc: "预留的统一服务仓库（暂未启用）。",
    href: "https://github.com/foliaai/folio-server",
  },
];

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-gray-50/50">
      <header className="sticky top-0 z-30 border-b border-gray-200/80 bg-white/80 backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-4 py-3 sm:px-10 sm:py-4">
          <h1 className="text-lg font-bold text-foreground">关于开发者</h1>
          <p className="text-xs text-muted">作者信息与开源项目</p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-10 sm:py-8">
        <section className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <UserAvatar
              userId="caixiongjiang"
              name={DEVELOPER.name}
              size={72}
              shape="rounded-2xl"
              className="shadow-sm ring-1 ring-black/5"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-foreground">{DEVELOPER.name}</h2>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-muted">
                  {DEVELOPER.englishName}
                </span>
              </div>
              <p className="mt-1 text-sm text-primary-deep">{DEVELOPER.title}</p>
              <p className="mt-3 text-sm leading-relaxed text-muted">{DEVELOPER.bio}</p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs">
          <div className="mb-4 flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">联系与主页</h3>
          </div>
          <ul className="space-y-2">
            <li>
              <a
                href={DEVELOPER.github}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-xl border border-gray-200/80 px-3.5 py-2.5 text-sm text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5"
              >
                <span className="inline-flex items-center gap-2">
                  <Github className="h-4 w-4 text-muted" />
                  GitHub · @{DEVELOPER.githubHandle}（组织）
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted" />
              </a>
            </li>
            <li>
              <a
                href={DEVELOPER.personalGithub}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-xl border border-gray-200/80 px-3.5 py-2.5 text-sm text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5"
              >
                <span className="inline-flex items-center gap-2">
                  <Github className="h-4 w-4 text-muted" />
                  GitHub · @{DEVELOPER.personalGithubHandle}（个人）
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted" />
              </a>
            </li>
            <li>
              <a
                href={DEVELOPER.zhihu}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-xl border border-gray-200/80 px-3.5 py-2.5 text-sm text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5"
              >
                <span className="inline-flex items-center gap-2">
                  <ZhihuIcon className="h-5 w-5 shrink-0 text-foreground" />
                  知乎 · 蔡雄江
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 text-muted" />
              </a>
            </li>
          </ul>
        </section>

        <section className="rounded-2xl border border-gray-200/80 bg-white p-6 shadow-xs">
          <div className="mb-1 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">相关开源项目</h3>
          </div>
          <p className="mb-4 text-sm leading-relaxed text-muted">
            FoliaAI 是围绕知识构建的 AI 品牌：把沉淀的资料变成可检索、可对话、可行动的智能，帮助每个人更高效地思考与创造——以知识为源，让效率生长。
          </p>
          <ul className="space-y-2">
            {PROJECTS.map((project) => (
              <li key={project.name}>
                <a
                  href={project.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start justify-between gap-3 rounded-xl border border-gray-200/80 px-3.5 py-2.5 transition-colors hover:border-primary/30 hover:bg-primary/5"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <Code2 className="h-4 w-4 shrink-0 text-primary-deep" />
                      <span className="truncate">{project.name}</span>
                    </span>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{project.desc}</p>
                  </span>
                  <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                </a>
              </li>
            ))}
          </ul>
        </section>

        <p className="px-1 text-center text-[11px] text-muted">
          使用或二次开发请遵守 MIT License。功能问题可在对应仓库提 Issue，或从{" "}
          <Link href="/settings" className="text-primary-deep underline-offset-2 hover:underline">
            设置
          </Link>{" "}
          检查服务连通性。
        </p>
      </main>
    </div>
  );
}
