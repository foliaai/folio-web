/**
 * Document Compliance Agent API
 * 文稿检查助手 API 封装
 */

import { DocumentCheckResponse, CheckRule, CheckField, MeetingRecord } from "@/lib/types";
import { authFetch } from "@/lib/api/http";
import { API_CONFIG, getCommonHeaders, getCurrentUserId } from "@/lib/config";

// ========== 类型映射 ==========

/**
 * 后端规则配置模型（对应 OpenAPI 中的 RuleConfigModel）
 */
interface BackendRuleConfig {
  rule_id: string;
  rule_name: string;
  user_id: string;
  category: "completeness" | "logic" | "format" | "content";
  description?: string | null;
  enabled: boolean;
  severity: "error" | "warning" | "info";
  parameters: Record<string, any>;
  validator_function: string;
  error_message_template: string;
  display_order: number;
  group_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * 将前端 CheckRule 转换为后端 RuleConfigModel
 */
function toBackendRule(rule: CheckRule): Omit<BackendRuleConfig, "rule_id" | "user_id" | "created_at" | "updated_at"> {
  // 将前端的 fields 转换为后端的 parameters
  const parameters: Record<string, any> = {
    fields: rule.fields.map(field => ({
      id: field.id,
      name: field.name,
      key: field.key,
      type: field.type,
      required: field.required,
      validation: field.validation,
    })),
  };

  return {
    rule_name: rule.name,
    category: "completeness", // 默认类别，可以根据业务调整
    description: rule.description || null,
    enabled: true,
    severity: "error",
    parameters,
    validator_function: "validate_custom_fields",
    error_message_template: `{field} 不符合要求`,
    display_order: 0,
    group_name: rule.name,
  };
}

/**
 * 将后端 RuleConfigModel 转换为前端 CheckRule
 */
function fromBackendRule(backendRule: BackendRuleConfig): CheckRule {
  // 从 parameters 中提取 fields
  const fields: CheckField[] = backendRule.parameters?.fields || [];

  return {
    id: backendRule.rule_id,
    name: backendRule.rule_name,
    description: backendRule.description || undefined,
    fields,
  };
}

/**
 * 获取用户的检查规则配置
 * @returns 用户的检查规则列表
 */
export async function fetchUserCheckRules(): Promise<CheckRule[]> {
  try {
    const response = await authFetch(
      `${API_CONFIG.BASE_URL}${API_CONFIG.VERSION}/apps/document-compliance/config/rules?enabled_only=false`,
      {
        method: "GET",
        headers: getCommonHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    // 将后端的 RuleListResponse 转换为前端的 CheckRule[]
    const backendRules: BackendRuleConfig[] = data.rules || [];
    return backendRules.map(fromBackendRule);
  } catch (error) {
    console.error("Fetch check rules failed:", error);
    // 返回空数组，让用户创建新规则
    return [];
  }
}

/**
 * 创建新的检查规则
 * @param rule 检查规则
 * @returns 创建的检查规则（包含服务器生成的ID）
 */
export async function createCheckRule(rule: Omit<CheckRule, "id">): Promise<CheckRule> {
  try {
    const backendRuleData = toBackendRule({ ...rule, id: "" } as CheckRule);
    
    const response = await authFetch(
      `${API_CONFIG.BASE_URL}${API_CONFIG.VERSION}/apps/document-compliance/config/rules`,
      {
        method: "POST",
        headers: getCommonHeaders(),
        body: JSON.stringify(backendRuleData),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: "创建检查规则失败",
      }));
      throw new Error(error.detail || `HTTP error! status: ${response.status}`);
    }

    const backendRule: BackendRuleConfig = await response.json();
    return fromBackendRule(backendRule);
  } catch (error) {
    console.error("Create check rule failed:", error);
    throw new Error(error instanceof Error ? error.message : "创建检查规则失败");
  }
}

/**
 * 更新检查规则
 * @param rule 检查规则
 * @returns 更新后的检查规则
 */
export async function updateCheckRule(rule: CheckRule): Promise<CheckRule> {
  try {
    const backendRuleData = toBackendRule(rule);
    
    const response = await authFetch(
      `${API_CONFIG.BASE_URL}${API_CONFIG.VERSION}/apps/document-compliance/config/rules/${rule.id}`,
      {
        method: "PUT",
        headers: getCommonHeaders(),
        body: JSON.stringify(backendRuleData),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: "更新检查规则失败",
      }));
      throw new Error(error.detail || `HTTP error! status: ${response.status}`);
    }

    const backendRule: BackendRuleConfig = await response.json();
    return fromBackendRule(backendRule);
  } catch (error) {
    console.error("Update check rule failed:", error);
    throw new Error(error instanceof Error ? error.message : "更新检查规则失败");
  }
}

/**
 * 删除检查规则
 * @param ruleId 规则ID
 */
export async function deleteCheckRule(ruleId: string): Promise<void> {
  try {
    const response = await authFetch(
      `${API_CONFIG.BASE_URL}${API_CONFIG.VERSION}/apps/document-compliance/config/rules/${ruleId}`,
      {
        method: "DELETE",
        headers: getCommonHeaders(),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: "删除检查规则失败",
      }));
      throw new Error(error.detail || `HTTP error! status: ${response.status}`);
    }
  } catch (error) {
    console.error("Delete check rule failed:", error);
    throw new Error(error instanceof Error ? error.message : "删除检查规则失败");
  }
}

export interface CheckDocumentParams {
  files: File[]; // 支持多文件
  save_to_kb?: boolean;
  session_id?: string;
}

/**
 * 上传文件到 Storage Service
 * @param file 文件
 * @param sessionId 会话ID
 * @returns 文件ID
 */
async function uploadFileToStorage(file: File, sessionId?: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("category", "session");
  formData.append("agent_type", "document_compliance");
  if (sessionId) {
    formData.append("session_id", sessionId);
  }
  formData.append("user_id", getCurrentUserId());

  try {
    const headers = getCommonHeaders();
    delete headers["Content-Type"];

    const response = await authFetch(
      `${API_CONFIG.BASE_URL}${API_CONFIG.VERSION}/common/storage/upload`,
      {
        method: "POST",
        headers,
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status}`);
    }

    const data = await response.json();
    return data.file_id;
  } catch (error) {
    console.error("File upload failed:", error);
    throw new Error("文件上传失败");
  }
}

/**
 * 检查文档合规性
 * @param params 检查参数
 * @returns 检查结果
 */
export async function checkDocument(
  params: CheckDocumentParams
): Promise<DocumentCheckResponse> {
  try {
    // 1. 上传文件到 Storage Service（暂时只支持单文件）
    if (params.files.length === 0) {
      throw new Error("请至少选择一个文件");
    }

    const fileId = await uploadFileToStorage(params.files[0], params.session_id);

    // 2. 调用检查接口
    const response = await authFetch(
      `${API_CONFIG.BASE_URL}${API_CONFIG.VERSION}/apps/document-compliance/check`,
      {
        method: "POST",
        headers: getCommonHeaders(),
        body: JSON.stringify({
          file_id: fileId,
          save_to_kb: params.save_to_kb ?? false,
          session_id: params.session_id,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: "检查失败",
      }));
      throw new Error(error.detail || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    // 将后端响应转换为前端格式
    return {
      success: data.status === "completed",
      record: data.meeting_record || {},
      validation_results: data.validation_results || [],
      prompt: undefined, // 如果需要提示词，需要另外调用 export-prompt 接口
      error: data.status === "failed" ? data.message : undefined,
    };
  } catch (error) {
    console.error("Document check failed:", error);
    throw error;
  }
}

/**
 * 导出 AI 提示词
 * @param checkId 检查任务ID
 * @param templateName 提示词模板名称
 * @returns 生成的提示词
 */
export async function exportPrompt(
  checkId: string,
  templateName: string = "default"
): Promise<string> {
  try {
    const response = await authFetch(
      `${API_CONFIG.BASE_URL}${API_CONFIG.VERSION}/apps/document-compliance/export-prompt`,
      {
        method: "POST",
        headers: getCommonHeaders(),
        body: JSON.stringify({
          check_id: checkId,
          template_name: templateName,
          include_raw_data: false,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        detail: "导出提示词失败",
      }));
      throw new Error(error.detail || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.prompt;
  } catch (error) {
    console.error("Export prompt failed:", error);
    throw error;
  }
}
