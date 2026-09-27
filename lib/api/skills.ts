/**
 * 技能 REST API 客户端
 * 调用 skill-service 的 /skills 端点
 */
import { getCommonHeaders } from "@/lib/config";

/**
 * 技能 API 基址：
 * - 默认走同源 `/skill-api`（由 next.config rewrites 代理到 skill-service:8001，避免跨域 Failed to fetch）
 * - 部署时可设 NEXT_PUBLIC_SKILL_SERVICE_URL 直连独立域名
 */
const SKILL_API_PREFIX = process.env.NEXT_PUBLIC_SKILL_API_PREFIX ?? "/skill-api";
const SKILL_SERVICE_URL = process.env.NEXT_PUBLIC_SKILL_SERVICE_URL?.replace(/\/+$/, "");

function skillApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (SKILL_SERVICE_URL) {
    return `${SKILL_SERVICE_URL}${normalizedPath}`;
  }
  return `${SKILL_API_PREFIX}${normalizedPath}`;
}

function appendSearchParams(
  url: string,
  params: Record<string, string | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillDescriptor {
  name: string;
  description: string;
  category: string;
  tags: string[];
  version: string;
  requires_tools: string[];
  fallback_for_tools: string[];
  source: "builtin" | "custom";
  enabled: boolean;
  deletable: boolean;
  /** 自定义封面相对路径；为空则使用算法生成封面 */
  cover_url?: string | null;
}

export interface SkillDetail {
  descriptor: SkillDescriptor;
  body: string;
  files: string[];
}

interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function fetchSkills(params?: {
  q?: string;
  enabledOnly?: boolean;
}): Promise<SkillDescriptor[]> {
  const url = appendSearchParams(skillApiUrl("/skills"), {
    q: params?.q,
    enabled_only:
      params?.enabledOnly !== undefined
        ? String(params.enabledOnly)
        : undefined,
  });

  const resp = await fetch(url, {
    headers: getCommonHeaders(),
  }).catch((err: unknown) => {
    throw new Error(
      "无法连接技能服务，请确认 skill-service 已启动且 Next.js 已配置 /skill-api 代理",
      { cause: err }
    );
  });
  if (!resp.ok) throw new Error(`fetchSkills failed: ${resp.status}`);
  const json: ApiResponse<SkillDescriptor[]> = await resp.json();
  return json.data ?? [];
}

export async function fetchSkillDetail(
  name: string
): Promise<SkillDetail> {
  const resp = await fetch(skillApiUrl(`/skills/${encodeURIComponent(name)}`), {
    headers: getCommonHeaders(),
  });
  if (!resp.ok) throw new Error(`fetchSkillDetail failed: ${resp.status}`);
  const json: ApiResponse<SkillDetail> = await resp.json();
  if (!json.data) throw new Error("empty data");
  return json.data;
}

export async function createSkill(body: string): Promise<SkillDescriptor> {
  const resp = await fetch(skillApiUrl("/skills"), {
    method: "POST",
    headers: getCommonHeaders(),
    body: JSON.stringify({ body }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `createSkill failed: ${resp.status}`);
  }
  const json: ApiResponse<SkillDescriptor> = await resp.json();
  if (!json.data) throw new Error("empty data");
  return json.data;
}

export async function updateSkill(
  name: string,
  body: string
): Promise<SkillDescriptor> {
  const resp = await fetch(
    skillApiUrl(`/skills/${encodeURIComponent(name)}`),
    {
      method: "PUT",
      headers: getCommonHeaders(),
      body: JSON.stringify({ body }),
    }
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || `updateSkill failed: ${resp.status}`);
  }
  const json: ApiResponse<SkillDescriptor> = await resp.json();
  if (!json.data) throw new Error("empty data");
  return json.data;
}

export async function setSkillEnabled(
  name: string,
  enabled: boolean
): Promise<void> {
  const resp = await fetch(
    skillApiUrl(`/skills/${encodeURIComponent(name)}/enabled`),
    {
      method: "PATCH",
      headers: getCommonHeaders(),
      body: JSON.stringify({ enabled }),
    }
  );
  if (!resp.ok) throw new Error(`setSkillEnabled failed: ${resp.status}`);
}

export function resolveSkillCoverUrl(
  coverUrl?: string | null
): string | null {
  if (!coverUrl) return null;
  if (/^(https?:|blob:|data:)/i.test(coverUrl)) return coverUrl;
  return skillApiUrl(coverUrl);
}

export async function uploadSkillCover(
  name: string,
  file: File
): Promise<SkillDescriptor> {
  const url = skillApiUrl(`/skills/${encodeURIComponent(name)}/cover`);
  const headers = getCommonHeaders();
  const nextHeaders: Record<string, string> = {};
  if (headers.Authorization) nextHeaders.Authorization = headers.Authorization;

  const formData = new FormData();
  formData.append("file", file);

  const resp = await fetch(url, {
    method: "POST",
    headers: nextHeaders,
    body: formData,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(
      err.detail || err.message || `uploadSkillCover failed: ${resp.status}`
    );
  }
  const json: ApiResponse<SkillDescriptor> = await resp.json();
  if (!json.data) throw new Error("empty data");
  return json.data;
}

export async function deleteSkillCover(name: string): Promise<void> {
  const resp = await fetch(
    skillApiUrl(`/skills/${encodeURIComponent(name)}/cover`),
    {
      method: "DELETE",
      headers: getCommonHeaders(),
    }
  );
  if (!resp.ok) throw new Error(`deleteSkillCover failed: ${resp.status}`);
}

export async function deleteSkill(name: string): Promise<void> {
  const resp = await fetch(
    skillApiUrl(`/skills/${encodeURIComponent(name)}`),
    {
      method: "DELETE",
      headers: getCommonHeaders(),
    }
  );
  if (!resp.ok) throw new Error(`deleteSkill failed: ${resp.status}`);
}
