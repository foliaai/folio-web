<div align="center">

# AI-site: Agentic Knowledge Base Frontend

<p align="center"><b>Knowledge Base Q&amp;A&nbsp; ◦ &nbsp;PDF + Office Preview&nbsp; ◦ &nbsp;Bbox Source Tracing&nbsp; ◦ &nbsp;Streaming Chat with Citations&nbsp; ◦ &nbsp;Skills</b></p>

<h4 align="center">
  <a href="#-quick-start">🚀 Quick Start</a>&nbsp; • &nbsp;
  <a href="#-features">🎯 Features</a>&nbsp; • &nbsp;
  <a href="#-project-structure">🌲 Structure</a>&nbsp; • &nbsp;
  <a href="#-tech-stack">🧭 Tech Stack</a>
</h4>

</div>

---

# 📑 Introduction

`AI-site` 是 [agentic_knowledge_system](https://github.com/foliaai/folio-aks-server)（AKS）的 Web 前端，把后端的多粒度检索、Agentic 对话与 bbox 溯源能力以可视化方式呈现出来：在一个三栏式工作区里，左侧管理知识库 / 文件夹 / 文件，中间用 `react-pdf` 渲染文档（原生 PDF 与 Word/PPT 转换 PDF），右侧与知识库对话，回答带引用 chip，点击即可在 PDF 上**按 MinerU 坐标叠加高亮框**并跳转到对应页。

当前已落地：**知识库管理、文件上传与索引、文档预览与 bbox 溯源、知识库对话、技能管理**。首页与 Agent 应用中心为锁定状态（敬请期待）。

### 🎯 Features

> 一个把 AKS 的“检索—对话—溯源”串成完整体验的 Next.js 前端。

- **知识库工作区**：知识库 / 文件夹 / 文件单列树管理，网格 + 详情视图，删除即永久删除（同时清理索引数据），索引进度实时刷新。
- **多格式预览**：PDF 原生渲染；Word / PPT 经后端转换 PDF 后同样用 `react-pdf` 渲染（`isPdfPreviewableFile` 统一判定），非可渲染格式降级占位。
- **bbox 源溯源**：对话引用 → `chunk/{id}/position` 取元素 bbox → 按 0~1000 归一化坐标在对应页 canvas 上叠加高亮框，并自动跳页。
- **流式对话**：WebSocket 流式输出，支持工具调用、引用、图片 chunk 预览、Markdown + KaTeX 渲染；带 `@文件` 提及与召回流程图。
- **技能管理**：技能列表 / 详情 / 编辑器，对话中通过 `@skill` 调用。
- **可切换登录**：`NEXT_PUBLIC_AUTH_PROVIDER` 选择 Logto（公网 PKCE）或企业 OA（内部授权码），同一份代码、不同部署配置。
- **设计系统**：Tailwind，主色 `#00B36B → #00D980`，系统字体栈，Lucide 图标。

### 🛠️ Deployment Options

- **本地开发**：`npm run dev`（端口 4001），通过 `NEXT_PUBLIC_API_URL` 指向本地 AKS（默认 `http://localhost:8000`）。
- **生产**：`npm run build && npm start`，环境变量见 `.env.production`。

---

# 🌲 Project Structure

```
AI-site/
├── app/                         # Next.js App Router
│   ├── page.tsx                # 首页（锁定）
│   ├── knowledge/
│   │   ├── page.tsx            # 知识库工作区（主入口）
│   │   └── file/[fileId]/page.tsx  # 文件预览 + bbox 溯源
│   ├── skills/page.tsx        # 技能管理（list / detail / editor）
│   ├── agents/                 # Agent 应用中心（锁定）
│   ├── callback/page.tsx      # Logto 回调
│   ├── login · settings · help
│   └── layout.tsx              # 根布局
├── components/
│   ├── knowledge/              # DocumentView / KnowledgeChatPanel / RecallFlowChart /
│   │                           # FileGrid / KnowledgeTree / CitationChip / MarkdownAnswer / MentionComposer …
│   ├── agents/                 # AgentCard / ChatPanel / document-compliance …
│   ├── skills/                 # SkillList / SkillDetail / SkillEditor / SlashSkillMenu
│   ├── layout/                 # AppShell / Sidebar / ProfileDrawer
│   ├── home/ · auth/ · common/
├── lib/
│   ├── api/                    # knowledge.ts · chat.ts · skills.ts · agents/
│   ├── knowledge-types.ts     # KnowledgeFile / ChunkPositionResponse / FilePreviewResponse …
│   ├── knowledge-viewer.ts    # isPdfPreviewableFile + 视图缓存
│   ├── chat/ · actions/ · hooks/
│   ├── auth-providers/        # 登录方式抽象：logto.ts（公网）/ oa.ts（内部 OA）
│   ├── auth.ts · config.ts
├── next.config.mjs             # /skill-api → Skill Service 反向代理
├── tailwind.config.ts
└── package.json
```

<details>
<summary>知识库预览 + 溯源数据流</summary>

```
KnowledgeFile → fetchFilePreview(fileId) → preview_url + render_as
  ↓
DocumentView: isPdfPreviewableFile(file)?
  ├─ react-pdf 渲染 /raw?token=… (Word/PPT 默认取转换 PDF)
  └─ highlightChunkId → fetchChunkPosition(chunkId)
        → elements[].page_position (bbox, 0~coord_range)
        → ElementBBoxOverlay 按 canvas 实际尺寸换算并叠加高亮
```

</details>

---

# ⚙️ Quick Start

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境

```bash
cp .env.example .env.local
# 必填：NEXT_PUBLIC_API_URL（AKS 后端地址，默认 http://localhost:8000）
# 可选：Logto / Skill Service 相关变量
```

<details>
<summary>环境变量一览</summary>

```bash
NEXT_PUBLIC_API_URL=http://localhost:8000     # AKS 后端
NEXT_PUBLIC_API_VERSION=api/v1                # API 版本前缀
NEXT_PUBLIC_MOCK_USER_ID=user_demo_001         # 未登录时的 mock 用户

# 登录方式：logto（公网，默认）| oa（内部企业 OA）
NEXT_PUBLIC_AUTH_PROVIDER=logto

# 企业 OA 登录（NEXT_PUBLIC_AUTH_PROVIDER=oa 时使用）
NEXT_PUBLIC_OA_SSO_AUTHORIZE_URL=https://oasso.jiepei.com/connect/authorize
NEXT_PUBLIC_OA_AGENT_ID=your_oa_agent_id
NEXT_PUBLIC_OA_REDIRECT_URI=http://localhost:4000/callback

# Logto（NEXT_PUBLIC_AUTH_PROVIDER=logto 时使用）
NEXT_PUBLIC_APP_URL=http://localhost:4000
NEXT_PUBLIC_LOGTO_ENDPOINT=http://localhost:3001
NEXT_PUBLIC_LOGTO_APP_ID=your_logto_app_id
NEXT_PUBLIC_LOGTO_REDIRECT_URI=http://localhost:4000/callback
NEXT_PUBLIC_LOGTO_POST_LOGOUT_REDIRECT_URI=http://localhost:4000
NEXT_PUBLIC_LOGTO_SCOPES=openid profile email offline_access

# Skill Service（默认走同源 /skill-api 代理，一般无需改）
SKILL_SERVICE_URL=http://localhost:8001
```

</details>

### 3. 启动开发服务器

```bash
npm run dev
# 打开 http://localhost:4001
```

### 4. 构建生产版本

```bash
npm run build
npm start
```

> 前端依赖 AKS 后端提供数据与转换 PDF；请先启动 [agentic_knowledge_system](https://github.com/foliaai/folio-aks-server) 的 API 与 Workers。

---

# 🚀 Knowledge Base Q&A: An Example

1. 在 `/knowledge` 创建知识库 → 上传 PDF / Word / PPT → 触发索引构建（进度条实时刷新）。
2. 索引完成后打开文件 → 中栏 `react-pdf` 渲染，Word/PPT 自动走转换 PDF。
3. 右栏 `KnowledgeChatPanel` 提问 → WebSocket 流式返回答案 + 引用 chip。
4. 点击引用 → 跳转到对应页，按 MinerU bbox 叠加高亮框（源溯源）。

---

# 🧭 Tech Stack

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16（App Router · Turbopack）· React 19 |
| 语言 | TypeScript（严格模式） |
| 样式 | Tailwind CSS 3 · tailwind-merge · clsx |
| 图标 | Lucide React |
| PDF | react-pdf（PDF.js） |
| Markdown | react-markdown · remark-gfm · remark-math · rehype-katex |
| 认证 | Logto（PKCE，公网）/ 企业 OA（授权码，内部） |
| 后端 | agentic_knowledge_system（FastAPI :8000） |
| 通信 | REST + WebSocket（流式对话） |

---

## 作者

蔡雄江 - 全栈开发工程师 · AI 产品设计师

## 许可证

MIT License
