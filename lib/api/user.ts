/**
 * 用户个人资料与头像相关 API 客户端
 *
 * 资料读写走 folio-auth-server（/auth-api rewrite）；
 * 头像上传/删除暂仍走 AKS（依赖 MinIO 存储服务，待其迁入 auth-server 后切换）。
 */

import { API_CONFIG, authApiUrl, getCommonHeaders } from "@/lib/config";

export interface UserProfileData {
  user_id: string;
  nickname?: string | null;
  role?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  custom_data?: Record<string, any> | null;
  created_at?: string | null;
  updated_at?: string | null;
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

/**
 * 删除自定义头像（重置为默认 Identicon）
 */
export async function deleteUserAvatar(): Promise<void> {
  const url = authApiUrl("/user/avatar");
  const headers = getCommonHeaders();

  const res = await fetch(url, {
    method: "DELETE",
    headers,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`删除头像失败 (${res.status}): ${errText}`);
  }
}
