export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface KnowledgeBaseInfo {
  knowledge_base_id: string;
  knowledge_base_name: string;
  parent_knowledge_base_id?: string | null;
  knowledge_type?: string;
  description?: string | null;
  /** 可见性：private=个人（默认）/ team=团队 / public=公共 */
  visibility?: string;
  /** visibility=team 时绑定的团队ID */
  team_id?: string | null;
  /** 团队名称（visibility=team 时后端返回） */
  team_name?: string | null;
  /** 归属用户ID（private 的 owner / 共享库的创建者） */
  owner_user_id?: string;
}

/** 知识库列表附带的能力位（前端据此显隐公共库创建入口） */
export interface KnowledgeBaseListPermissions {
  can_create_public: boolean;
}

export interface FolderInfo {
  folder_id: string;
  folder_name: string;
  full_path: string;
  parent_folder_id?: string | null;
  depth: number;
  is_default?: number;
  knowledge_base_id?: string;
  description?: string | null;
}

export interface FileInfo {
  file_id: string;
  file_name: string;
  folder_id?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  status?: number | null;
  knowledge_base_id?: string;
  description?: string | null;
}

export type FileIndexStatus = "pending" | "processing" | "success" | "failed";

export interface FileProgress {
  file_id: string;
  file_name: string;
  progress: number;
  status: FileIndexStatus;
  stage?: string | null;
  message?: string | null;
}

export interface FolderDeleteResponse {
  folder_id: string;
  deleted_folder_count: number;
  deleted_file_count: number;
}

export interface KnowledgeFile extends FileInfo {
  updated_at?: string;
  index_status?: FileIndexStatus;
  progress?: number;
  /** 预览渲染提示（来自 /preview；Word/PPT 转 PDF 时为 pdf） */
  render_as?: "pdf" | "original" | string | null;
  preview_mime_type?: string | null;
  has_converted_pdf?: boolean;
}

export interface FilePreviewResponse {
  file_id: string;
  file_name: string;
  mime_type?: string | null;
  file_size?: number | null;
  preview_url: string;
  expires_in: number;
  /** pdf：用 PDF.js 渲染（含原生 PDF / Word·PPT 转换 PDF）；original：原文件 */
  render_as?: "pdf" | "original" | string | null;
  /** 实际预览 MIME；Office 转 PDF 时为 application/pdf */
  preview_mime_type?: string | null;
  /** Word/PPT 是否已持久化转换 PDF */
  has_converted_pdf?: boolean;
}

export interface ChunkImagePreviewResponse {
  chunk_id: string;
  preview_url: string;
  expires_in: number;
  file_name?: string | null;
}

export interface ElementPosition {
  element_id: string;
  element_type: string;
  /** 元素所在页码（从 0 开始）；文本 chunk 可能跨页，需逐元素渲染高亮 */
  page_index?: number | null;
  page_position?: number[] | null;
  /**
   * 该元素在文档内全部同类型元素中的序号（0 起）。
   * 无 bbox 的解析来源（markdown/html）用它做序号锚定：
   * 前端数渲染结果里第 N 个 table/pre/img 定位高亮。
   */
  type_ordinal?: number | null;
}

/** MinerU pipeline bbox 坐标空间：各轴 0~coord_range，左上角原点 */
export type ChunkCoordSpace = "mineru-normalized-1000";

export interface ChunkPositionResponse {
  chunk_id: string;
  chunk_type?: string | null;
  page_index?: number | null;
  /** page_position 使用的坐标空间，默认 mineru-normalized-1000 */
  coord_space?: ChunkCoordSpace | string | null;
  /** 归一化坐标轴最大值，默认 1000 */
  coord_range?: number | null;
  elements: ElementPosition[];
}
