/**
 * 用户个人资料与头像相关 API 客户端
 *
 * 资料读写走 folio-auth-server（/auth-api rewrite）；
 * 头像上传/删除暂仍走 AKS（依赖 MinIO 存储服务，待其迁入 auth-server 后切换）。
 */

import { authApiUrl, getCommonHeaders } from "@/lib/config";

/** 所属组织条目（auth-server organization 表，扁平无层级） */
export interface UserDepartmentItem {
  id: number;
  name: string;
  is_main: boolean;
}

export interface UserProfileData {
  user_id: string;
  nickname?: string | null;
  role?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  /** 性别：1=男，2=女，0/null=未知（OA 身份属性，每次登录以 OA 刷新） */
  gender?: number | null;
  /** 所属组织（主部门在前；公网 Logto 用户为空数组） */
  departments?: UserDepartmentItem[] | null;
  custom_data?: Record<string, any> | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** 性别展示文案（0/null 未知返回 null，调用方隐藏） */
export function genderText(gender?: number | null): string | null {
  if (gender === 1) return "男";
  if (gender === 2) return "女";
  return null;
}

/** 部门成员条目（建团队「从部门导入」用，auth-server /api/orgs） */
export interface OrgMemberItem {
  user_id: string;
  is_main: boolean;
}

export interface OrgMembersData {
  department_id: number;
  department_name: string;
  members: OrgMemberItem[];
}

/** 用户搜索结果条目（邀请成员用，auth-server /api/users/search） */
export interface UserSearchItem {
  user_id: string;
  display_name: string;
}

/**
 * 按部门拉成员列表（JP 建团队导入快照；走 authApiUrl）。
 * 组织不存在（含 prd 无组织数据）返回 null，调用方按数据驱动隐藏入口。
 */
export async function getOrgMembers(
  departmentId: number
): Promise<OrgMembersData | null> {
  try {
    const url = authApiUrl(
      `/orgs/${encodeURIComponent(departmentId)}/members`
    );
    const res = await fetch(url, { method: "GET", headers: getCommonHeaders() });
    if (!res.ok) return null;
    const json = { code: 0, message: "", ...(await res.json()) } as {
      data?: OrgMembersData;
    };
    return json.data ?? null;
  } catch (err) {
    console.error("[getOrgMembers] 异常:", err);
    return null;
  }
}

/**
 * 搜索用户（邀请成员，昵称/用户ID 模糊匹配；防枚举：关键词 ≥2 字符、上限 20 条）。
 * 关键词过短由后端 400，这里直接返回空数组避免无谓请求。
 */
export async function searchUsers(q: string): Promise<UserSearchItem[]> {
  const keyword = q.trim();
  if (keyword.length < 2) return [];
  try {
    const url = authApiUrl(
      `/users/search?q=${encodeURIComponent(keyword)}&limit=20`
    );
    const res = await fetch(url, { method: "GET", headers: getCommonHeaders() });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { users?: UserSearchItem[] } };
    return json.data?.users ?? [];
  } catch (err) {
    console.error("[searchUsers] 异常:", err);
    return [];
  }
}

export interface UserProfileResponse {
  code: number;
  message: string;
  data: UserProfileData;
}

export interface AvatarUploadResponse {
  code: number;
  message: string;
  data: {
    user_id: string;
    avatar_url: string;
    message?: string;
  };
}


/**
 * 获取当前登录用户的个人资料与头像配置（folio-auth-server）
 */
export async function getUserProfile(): Promise<UserProfileData | null> {
  try {
    const url = authApiUrl("/user/profile");
    const headers = getCommonHeaders();

    const res = await fetch(url, {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      console.warn(`[getUserProfile] 请求失败 status=${res.status}`);
      return null;
    }

    const json: UserProfileResponse = await res.json();
    return json.data;
  } catch (err) {
    console.error("[getUserProfile] 异常:", err);
    return null;
  }
}

/**
 * 更新用户个人资料（昵称、个人简介等，folio-auth-server）
 */
export async function updateUserProfile(payload: {
  nickname?: string | null;
  bio?: string | null;
  custom_data?: Record<string, any> | null;
}): Promise<UserProfileData | null> {
  const url = authApiUrl("/user/profile");
  const headers = getCommonHeaders();

  const res = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`更新资料失败 (${res.status}): ${errText}`);
  }

  const json: UserProfileResponse = await res.json();
  return json.data;
}

/**
 * 上传自定义头像（folio-auth-server：MinIO + avatar_url）
 * 上传成功会自动替换旧头像（MinIO 旧对象同步清理），无独立"恢复默认"入口。
 */
export async function uploadUserAvatar(file: File): Promise<string> {
  const url = authApiUrl("/user/avatar");
  const defaultHeaders = getCommonHeaders();
  
  // 必须使用 FormData，且不能显式设置 Content-Type 让浏览器自动设置 multipart boundary
  const headers: Record<string, string> = {};
  if (defaultHeaders.Authorization) {
    headers.Authorization = defaultHeaders.Authorization;
  }

  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({ detail: "上传失败" }));
    throw new Error(errJson.detail || errJson.message || `上传头像失败 (${res.status})`);
  }

  const json: AvatarUploadResponse = await res.json();
  return json.data.avatar_url;
}
