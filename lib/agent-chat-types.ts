/**
 * 通用 Agent（首页）对话协议类型 —— 对齐 agent-server src/runtime/ws_protocol.py
 *
 * 帧协议与 AKS 平台协议同形（docs/ws-protocol.md 对照档）；
 * 差异：start 载荷用 `message` 字段（AKS 为 `query`），新增 `thinking_level`。
 */

/** C→S start 帧载荷 */
/** 会话工作空间附件元数据（agent_session_file 目录行 / 消息 attachments 字段） */
export interface AgentAttachmentMeta {
  file_id: string;
  kind: "file" | "image";
  name: string;
  size: number;
  mime?: string;
}

export interface AgentStartPayload {
  message: string;
  /** 模型 id（/api/v1/models 清单项；不传用后端默认模型） */
  model?: string;
  /** pi 标准思考档位（off/minimal/low/medium/high/xhigh/max） */
  thinking_level?: string;
  /** 会话 id（不传由后端新建；跨轮保持上下文） */
  session_id?: string;
  /** 本轮携带的附件（完整元数据；start 帧只发 file_id/kind，UI 侧全量展示） */
  attachments?: AgentAttachmentMeta[];
}

/** start 帧的 wire 形态（附件只发 file_id/kind，服务端按目录行取全量） */
export type AgentStartFrameData = Omit<AgentStartPayload, "attachments"> & {
  attachments?: Array<{ file_id: string; kind: "file" | "image" }>;
};

export type AgentClientFrame =
  | { type: "start"; data: AgentStartFrameData }
  | { type: "stop" }
  | { type: "ping" };

/** 工具调用轨迹（时间线展示） */
export interface AgentToolCall {
  id: string;
  name: string;
  /** 参数 JSON 累积（流式拼装） */
  argsText: string;
  status: "running" | "done";
  resultBrief?: string;
  timeMs?: number;
}

/** 思考/工具有序段（按发生顺序交错；流式期前端拼装，回放由后端从 items 派生） */
export type AgentSegment =
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string };

/** UI 消息模型 */
export interface UiAgentMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** 本轮用户附件（user 消息气泡的 chip/缩略图渲染来源） */
  attachments?: AgentAttachmentMeta[];
  /** 思考墙钟耗时（首个思考增量 → 首个正文/工具增量） */
  thinkingMs?: number;
  toolCalls: AgentToolCall[];
  /**
   * 有序段：思考与工具调用按实际发生顺序交错（多轮 agent loop 的每段思考
   * 跟在触发它的工具调用之后）。流式期前端按帧序拼装；回放由后端从落库
   * items 派生（无轨迹的纯文本轮为空数组）。
   */
  segments: AgentSegment[];
  /** 本轮 token 用量（turn 级；usage 帧 / 回放行填充；cached 用于命中率） */
  usage?: {
    total_tokens?: number;
    input_tokens?: number;
    cached_tokens?: number;
  } | null;
  /** 本轮是否完成（turn.done 收到） */
  done: boolean;
}

/** S→C 帧载荷（按 type 收窄） */
export type AgentServerFrame =
  | { type: "session.ready"; data: { session_id: string } }
  | { type: "thinking.delta"; data: { text: string } }
  | { type: "content.delta"; data: { text: string } }
  | {
      type: "tool_call.started";
      data: { index?: number; id: string; name: string };
    }
  | {
      type: "tool_call.args_delta";
      data: { index?: number; id: string; text: string };
    }
  | {
      type: "tool_call.completed";
      data: {
        id: string;
        name: string;
        args?: string;
        result_brief?: string;
        time_ms?: number;
      };
    }
  | {
      type: "message.done";
      data: { role?: string; finish_reason?: string; time_ms?: number };
    }
  | {
      type: "turn.done";
      data: { rounds?: number; tool_calls_count?: number; time_ms?: number };
    }
  | {
      type: "usage";
      data: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
        cached_tokens?: number;
      };
    }
  | { type: "error"; data: { phase?: string; error: string; cancelled?: boolean } }
  | { type: "pong"; data: Record<string, never> };

/** 模型清单项（与 agent-server /api/v1/models、AKS ChatModelItem 同形） */
export interface AgentModelItem {
  id: string;
  label: string;
  provider: string;
  supports_thinking?: boolean;
  thinking_levels?: string[];
  default_thinking_level?: string | null;
  supports_multimodal?: boolean;
  max_context?: number | null;
}

// ---------------------------------------------------------------------------
// 会话持久化（agent_session / agent_message，接口形状对齐 AKS /api/chat/sessions）
// ---------------------------------------------------------------------------

/** 会话元信息（GET/POST /api/v1/sessions） */
export interface AgentSessionInfo {
  session_id: string;
  user_id: string;
  title: string;
  model?: string | null;
  thinking_level?: string;
  message_count?: number;
  last_message_at?: string | null;
  create_time?: string | null;
}

export interface AgentSessionListResponse {
  items: AgentSessionInfo[];
  total: number;
  page: number;
  page_size: number;
}

/** 落库的工具调用记录（agent_message.tool_calls JSON 数组项） */
export interface AgentPersistedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result_brief?: string | null;
  time_ms?: number | null;
}

/** 消息行（GET /api/v1/sessions/{id}/messages；一轮 turn = user + assistant 两行） */
export interface AgentMessageItem {
  message_id: string;
  session_id: string;
  role: "user" | "assistant" | "summary";
  content: string;
  attachments?: AgentAttachmentMeta[] | null;
  thinking?: string | null;
  thinking_ms?: number | null;
  tool_calls?: AgentPersistedToolCall[] | null;
  /**
   * 思考/工具交错段（assistant 行；后端从落库 items 有序数组派生）：
   * thinking 段带 text，tool 段的 id 对齐 tool_calls[].id（call_id）。
   * null = 无轨迹可渲染（纯文本轮）。
   */
  segments?: Array<
    { kind: "thinking"; text: string } | { kind: "tool"; id: string; name?: string }
  > | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cached_tokens?: number;
  } | null;
  finish_reason?: string | null;
  create_time?: string | null;
}

export interface AgentMessageListResponse {
  items: AgentMessageItem[];
  total: number;
  page: number;
  page_size: number;
}
