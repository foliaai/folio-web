/**
 * 知识库对话（Chat）模块的前端类型定义。
 *
 * 与后端文档对齐：
 *   - REST：api/schemas/chat/session.py
 *   - WS：src/chat/protocol.py（子协议 aks-chat-v1）
 *   - 设计文档：docs/特殊功能设计/知识库对话设计.md §4 / §5 / §6.2
 */

// ---------------------------------------------------------------------------
// 通用业务对象
// ---------------------------------------------------------------------------

export type ChatRole = "system" | "user" | "assistant" | "tool" | "summary";

export interface Citation {
  chunk_id: string;
  document_id?: string | null;
  knowledge_base_id?: string | null;
  score: number;
  /**
   * Phase A 内联引用扩展字段：
   * - chunk_type: text / table / image（equation 已被切成 text + LaTeX 语法）
   * - page_index: 从 0 开始，UI 展示 +1
   * - section_title: 章节标题（来自 MongoDB section_data.text）
   * - file_id / file_name: 用于跳转 /knowledge/file/<file_id>
   * - preview: 片段正文摘要（截 200 字符）
   *
   * 所有字段都是 Optional：老会话历史里没有这些字段，CitationChip 会按短 hash
   * 降级渲染。
   */
  chunk_type?: string | null;
  page_index?: number | null;
  section_title?: string | null;
  file_id?: string | null;
  file_name?: string | null;
  preview?: string | null;
  /**
   * Phase B：session 级 chunk alias（`c1` / `c2` / `c10` ...）。
   * LLM 输出里的 `[cN]` 通过该字段反查 citation 元数据。
   * 老会话没有 alias 字段（值为 null/undefined），MarkdownAnswer 会回退到
   * 老的真实 chunk_id 匹配路径。
   */
  alias?: string | null;
  /** 图片 chunk 专用：对象存储路径，用于按需请求 presigned URL */
  image_file_path?: string | null;
  bucket_name?: string | null;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result_brief?: string | null;
  items_added: number;
  /**
   * 仅前端使用的可选字段（后端持久化的 ToolCallItem 不返回）。
   * 用于在 WS 流式过程中即时展示"正在调用"的卡片：
   *   - tool_call.started: push 一条 {id, name, inflight:true, argsText:"", index}
   *   - tool_call.args_delta: 按 index 拼接 argsText，并尝试 JSON.parse 实时回填 arguments
   *   - tool_call.completed: 按 id 找到该记录，填入最终 arguments / result_brief / items_added，
   *     清掉 inflight 与 argsText
   */
  inflight?: boolean;
  argsText?: string;
  index?: number;
  /** 检索工具专用：当前检索进度阶段 */
  retrieval_progress?: "planning" | "searching" | "reranking" | null;
  /** 检索工具专用：保存检索结果 chunks，支持点击查看 */
  retrieval_chunks?: RetrievalChunkPreview[];
  /** 检索工具专用：查询参数 */
  retrieval_params?: Record<string, unknown>;
  /** 检索工具专用：召回链路统计（每路 recalled/aligned/final + 融合/rerank 计数 + chunk_id 截断列表），独立于查询参数 */
  recall_stats?: RecallStats;
  /** 工具调用耗时（毫秒） */
  time_ms?: number;
  /** read_image_chunks 等工具内部子阶段（仅流式进行中） */
  execution_stage?: "loading_images" | "calling_vlm" | null;
  /** 工具内部调用的子模型（如 read_image_chunks 的 VLM） */
  execution_model?: string | null;
}

export interface TokenUsageRecord {
  prompt_tokens: number;
  completion_tokens: number;
  thinking_tokens?: number | null;
  total_tokens: number;
  /** 前缀缓存命中数（命中率 = cached/prompt；session 级按 token 加权） */
  cached_tokens?: number;
}

export interface ChatMessage {
  message_id: string;
  session_id: string;
  user_id?: string;
  role: ChatRole;
  content: string;
  thinking?: string | null;
  /** 本轮思考墙钟耗时（毫秒）；历史消息可能缺失 */
  thinking_ms?: number | null;
  tool_calls: ToolCallRecord[];
  citations: Citation[];
  usage?: TokenUsageRecord | null;
  finish_reason?: string | null;
  tool_call_id?: string | null;
  metadata?: Record<string, unknown>;
  create_time?: string;
  update_time?: string;
}

export interface ChatSessionInfo {
  session_id: string;
  user_id: string;
  title: string;
  knowledge_base_ids: string[];
  /** 会话绑定的文件夹 ID；NULL=KB scope，非 NULL=folder scope */
  folder_id?: string | null;
  /** folder scope 下是否含子文件夹（仅 folder_id 非空时生效） */
  include_subfolders?: boolean;
  /** 后台 agent / 起标题 / 摘要等仍然走 preset；用户 chat 可被 `model` 覆盖 */
  model_preset: string;
  /**
   * 用户从 `/api/chat/models` 选定的 LiteLLM 模型字符串（如 `openai/gpt-4o-mini`）。
   * `null` / `undefined` 表示用户没有显式选定，此时由 `model_preset` 决定模型。
   */
  model?: string | null;
  mode: string;
  /** 思考强度档位（pi 标准 7 档：off/minimal/low/medium/high/xhigh/max） */
  thinking_level?: string | null;
  enable_multimodal?: boolean;
  system_prompt?: string | null;
  message_count: number;
  last_message_at?: string | null;
  create_time?: string;
  update_time?: string;
}

// ---------------------------------------------------------------------------
// REST 请求/响应
// ---------------------------------------------------------------------------

export interface ChatSessionCreateRequest {
  title?: string;
  knowledge_base_ids: string[];
  /**
   * 可选：会话绑定的文件夹 ID（来自 `workspace_folder.folder_id`）。
   * 传入后启用 folder scope，每轮检索范围限定在该文件夹下文档；
   * 后端会校验 folder 所属 KB 必须 ∈ knowledge_base_ids，违反时返回 422。
   */
  folder_id?: string | null;
  /**
   * folder scope 下是否递归含子文件夹的文档，默认 true；
   * 仅当 `folder_id` 非空时有意义。
   */
  include_subfolders?: boolean;
  model_preset?: string;
  /** 用户选定的 LiteLLM 模型字符串；不传 → 由 `model_preset` 决定 */
  model?: string | null;
  /** 会话交互模式（agent / plan 等）；默认 agent */
  mode?: string;
  /** 思考强度档位（off/minimal/low/medium/high/xhigh/max）；默认 off；不支持思考的模型忽略 */
  thinking_level?: string;
  system_prompt?: string | null;
}

export interface ChatSessionRenameRequest {
  title: string;
}

export interface ChatSessionListResponse {
  items: ChatSessionInfo[];
  total: number;
  page: number;
  page_size: number;
}

export interface ChatMessageListResponse {
  items: ChatMessage[];
  total: number;
  page: number;
  page_size: number;
}

// ---------------------------------------------------------------------------
// WebSocket 帧定义（§4.2 / §4.3）
// ---------------------------------------------------------------------------

/** @ 内联引用（文件或目录）；后端按 kind 解析为 document_ids */
export interface ChatMention {
  kind: "file" | "folder";
  id: string;
}

export interface ChatRequestPayload {
  session_id: string;
  query: string;
  /** 会话交互模式（agent / plan 等）；不传/null 表示沿用 session 默认 */
  mode?: string | null;
  /** 思考强度档位（off/minimal/low/medium/high/xhigh/max）；不传/null 沿用 session 默认 */
  thinking_level?: string | null;
  enable_multimodal?: boolean | null;
  model_preset?: string | null;
  /**
   * 用户在前端选定的 LiteLLM 模型字符串；优先级高于 `model_preset`。
   * 不传 → 沿用会话当前的 `model`（或 `model_preset`）。
   */
  model?: string | null;
  retrieve_top_k?: number | null;
  custom_system_prompt?: string | null;
  skip_retrieval?: boolean | null;
  /** 是否启用智能路由规划（LLM₁）；未传或 false 走 4 路混合检索 */
  enable_route_plan?: boolean | null;
  /**
   * Cursor 式 @ 内联引用（软引用，可多个，文件/目录混选）。
   * 后端解析为「引用资料」块注入 user prompt（小文件全量注入 / 大文件与目录仅提示 document_id）；
   * 不锁死 scope，模型仍可在引用之外检索。file 所属 KB 必须 ∈ session.knowledge_base_ids。
   */
  mentions?: ChatMention[] | null;
  /**
   * 请求级临时覆盖 folder scope；不传/null 表示沿用 session.folder_id。
   * 后端要求：覆盖时 folder 所属 KB 必须 ∈ session.knowledge_base_ids。
   */
  folder_id?: string | null;
  /** 请求级临时覆盖 include_subfolders；不传/null 表示沿用 session 默认 */
  include_subfolders?: boolean | null;
  /** Slash 强制召唤的技能名列表 */
  forced_skill_names?: string[] | null;
}

// 客户端 → 服务端
export type ClientFrame =
  | { type: "start"; data: ChatRequestPayload }
  | { type: "stop" }
  | { type: "ping" };

// retrieval.done 中的 chunks 预览
// Phase A 方案 B：种子 chunks 在 retrieval.done 帧里就带上 enrich 后的渲染字段，
// 前端可以直接预填到当前 user 消息或下一条 inflight assistant 的 citations 上，
// 这样 LLM 一吐出 [chunk-xxx] 就能直接渲染彩色 chip。
export interface RetrievalChunkPreview {
  chunk_id: string;
  document_id?: string | null;
  knowledge_base_id?: string | null;
  score: number;
  preview?: string | null;
  chunk_type?: string | null;
  page_index?: number | null;
  section_title?: string | null;
  file_id?: string | null;
  file_name?: string | null;
  /** Phase B：session 级短 alias（cN）。retrieval.done 帧提前下发供 alias chip 渲染。 */
  alias?: string | null;
  /** 图片 chunk 专用：对象存储路径，用于按需请求 presigned URL */
  image_file_path?: string | null;
  bucket_name?: string | null;
}

// ---------------------------------------------------------------------------
// 召回链路统计（v1.1：与后端 src/retrieve/pipeline/types.py 的 RecallStats 对齐）
// 由 search_knowledge_base 工具结果 params.recall_stats 带出，供「全部来源」面板
// 中间的「召回链路」栏目渲染：每路召回 → 对齐 → 融合 → rerank 各阶段计数 + chunk_id 截断列表。
// ---------------------------------------------------------------------------

export interface RouteRecallStat {
  route: string;
  top_k: number;
  /** Phase 2 该路原始召回 item 数 */
  recalled_count: number;
  /** Phase 3 跨粒度对齐后 chunk 数（section/qa/summary 路由展开后会变） */
  aligned_count?: number | null;
  /** Phase 5 rerank 后最终结果中该路贡献的 chunk 数（按 source_routes 归属，sum ≥ rerank_count） */
  final_count?: number | null;
  execution_time_ms?: number;
  /** 该路召回的前 N 个 chunk_id（截断展示） */
  sample_chunk_ids?: string[];
}

export interface RecallStats {
  routes: RouteRecallStat[];
  /** Phase 4 融合去重后候选数 */
  fused_count: number;
  /** 融合后候选 chunk_id（截断） */
  fused_chunk_ids?: string[];
  /** Phase 5 rerank 后数量 */
  rerank_count: number;
  /** 最终返回的 chunk_id（按分数降序，截断） */
  final_chunk_ids?: string[];
  /** Phase 5.5 精排后阈值过滤掉的数量 */
  dropped_by_threshold?: number;
  /** qa_dense 高置信置顶：对齐 / 融合 / rerank 仍已执行 */
  qa_pinned?: boolean;
}

// 服务端 → 客户端
export type ServerFrame =
  | {
      type: "ready";
      data: { subprotocol: string; user_id: string };
    }
  | { type: "pong"; data: Record<string, never> }
  | {
      type: "session.ready";
      data: {
        session_id: string;
        user_message_id: string;
        mode: string;
        model_preset: string;
        /** 本轮最终生效的 LiteLLM 模型字符串；为 null 表示由 model_preset 决定 */
        model?: string | null;
      };
    }
  | {
      type: "retrieval.started";
      data: { query: string; top_k: number };
    }
  | {
      type: "retrieval.progress";
      data: { stage: "planning" | "searching" | "reranking"; tool_call_id?: string };
    }
  | {
      type: "retrieval.done";
      data: {
        hit_count: number;
        time_ms: number;
        chunks: RetrievalChunkPreview[];
        params?: Record<string, unknown>;
      };
    }
  | { type: "thinking.delta"; data: { text: string } }
  | { type: "content.delta"; data: { text: string } }
  | {
      type: "tool_call.started";
      data: { index: number; id: string; name: string };
    }
  | {
      type: "tool_call.args_delta";
      data: { index: number; text: string };
    }
  | {
      type: "tool.progress";
      data: {
        stage: "loading_images" | "calling_vlm";
        tool_call_id: string;
        model?: string | null;
      };
    }
  | {
      type: "tool_call.completed";
      data: {
        id: string;
        name: string;
        args: Record<string, unknown>;
        result_brief?: string | null;
        items_added: number;
        time_ms?: number;
        /** 检索工具专用：检索结果 chunks */
        retrieval_chunks?: RetrievalChunkPreview[];
        /** 检索工具专用：查询参数 */
        retrieval_params?: Record<string, unknown>;
        /** 检索工具专用：召回链路统计（独立于查询参数） */
        recall_stats?: RecallStats;
        /** 工具内部调用的子模型（如 read_image_chunks 的 VLM） */
        execution_model?: string | null;
      };
    }
  | {
      type: "tool_round.done";
      data: {
        round: number;
        tool_calls: ToolCallRecord[];
      };
    }
  | {
      type: "message.done";
      data: {
        message_id: string;
        role: ChatRole;
        round: number | "final";
        finish_reason?: string | null;
        tool_calls_count: number;
        citations_count: number;
        /**
         * Phase A：本轮 assistant 的完整 citations（已含 enrich 字段）。
         * 直接挂到对应 UiChatMessage.citations，前端 CitationChip 即可渲染。
         */
        citations?: Citation[];
        /** 本轮思考墙钟耗时（毫秒） */
        thinking_ms?: number | null;
        usage?: TokenUsageRecord | null;
      };
    }
  | {
      type: "turn.done";
      data: {
        rounds: number;
        tool_calls_count: number;
        time_ms: number;
        user_message_id: string;
        assistant_message_ids: string[];
        citations_count?: number;
      };
    }
  | {
      type: "error";
      data: {
        phase: string;
        error: string;
        cancelled?: boolean;
        [key: string]: unknown;
      };
    };

export type ServerFrameType = ServerFrame["type"];

// ---------------------------------------------------------------------------
// 前端 UI 专用累积态
// ---------------------------------------------------------------------------

/** Chat 面板里渲染的一条消息（含进行中累积态） */
export interface UiChatMessage {
  /** 用 `chatmsg_*` 或本地 `local_*` 前缀；流式中先用临时 id，message.done 后换为后端 id */
  id: string;
  role: ChatRole;
  content: string;
  thinking?: string;
  /** 本轮思考开始的本地时间戳，仅用于计算 thinking_ms */
  thinking_started_at?: number;
  /** 思考耗时（毫秒），流式结束后固化 */
  thinking_ms?: number;
  tool_calls: ToolCallRecord[];
  citations: Citation[];
  usage?: TokenUsageRecord | null;
  finish_reason?: string | null;
  /** 是否是当前轮还在流式累积中的临时消息 */
  inflight?: boolean;
  /** 是否被用户 stop 中断（不写入后端但前端展示 chip） */
  cancelled?: boolean;
  /** 关联的检索状态（仅 user 消息触发的那一轮挂在 user 上） */
  retrieval?: {
    state: "started" | "done" | "failed";
    /** 检索进度阶段（仅 state=started 时有值） */
    stage?: "planning" | "searching" | "reranking";
    hit_count?: number;
    time_ms?: number;
    chunks?: RetrievalChunkPreview[];
    error?: string;
    /** 查询参数（query_text, filters, route_plan 等），用于审计展示 */
    params?: Record<string, unknown>;
  };
  /** 仅本地展示用的时间戳 */
  created_at?: string;
}

/** tool_call 流式累积条目 */
export interface UiToolCall {
  index: number;
  id?: string;
  name?: string;
  argsText: string;
  args?: Record<string, unknown>;
  result_brief?: string | null;
  items_added?: number;
  completed: boolean;
}

export type ChatPhase =
  | "idle"
  | "connecting"
  | "ready"
  | "running"
  | "stopped"
  | "error"
  | "disconnected";


/** GET /api/chat/sessions/{id}/context-status */
export interface ContextStatusBreakdown {
  system: number;
  /** 技能索引（已从 system 中扣除）；旧后端未下发时为 undefined */
  skills?: number;
  tools_schema: number;
  /** 持久化上下文摘要（已从 history 中扣除）；旧后端未下发时为 undefined */
  summary?: number;
  history: number;
  user: number;
  reserved_output: number;
}

export interface ContextCompactionInfo {
  at?: string | null;
  trigger?: string | null;
  input_tokens?: number | null;
  summary_tokens?: number | null;
}

export interface ContextStatusReport {
  session_id: string;
  model?: string | null;
  max_context: number;
  reserved_output: number;
  used_tokens: number;
  soft_limit: number;
  ratio: number;
  threshold_ratio: number;
  will_compact_at: number;
  counting: string;
  breakdown: ContextStatusBreakdown;
  last_compaction?: ContextCompactionInfo | null;
  summary_count: number;
}
