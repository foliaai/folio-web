/**
 * 团队 API 客户端（授权客体，folio-aks-server /api/team）
 *
 * 团队是团队知识库（visibility=team）的归属对象：owner 管理成员与信息，
 * member 对绑定团队的知识库读写同权。JP 的「从部门导入」不是专属端点：
 * 前端先经 lib/api/user.getOrgMembers 拉部门成员 user_id 列表，
 * 随 createTeam 的 member_user_ids 带入（创建即快照）。
 */

import { authFetch } from "@/lib/api/http";
import { API_CONFIG, getCommonHeaders } from "@/lib/config";
import type { ApiResponse } from "@/lib/knowledge-types";

const TEAM_API_PATH = "/api/team";

function buildTeamUrl(path: string): string {
  return `${API_CONFIG.BASE_URL}${TEAM_API_PATH}${path}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...getCommonHeaders(),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (init?.body && !(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await authFetch(buildTeamUrl(path), { ...init, headers });
  if (!response.ok) {
    const error = await response.json().catch(() => ({
      detail: "团队接口请求失败",
    }));
    throw new Error(error.detail || error.message || `HTTP ${response.status}`);
  }
  const payload = (await response.json()) as ApiResponse<T>;
  return payload.data;
}

export interface TeamInfo {
  team_id: string;
  name: string;
  description?: string | null;
  /** 当前用户在团队中的角色：owner=创建者 / member=成员 */
  my_role: string;
  member_count: number;
  create_time?: string | null;
}

export interface TeamMemberInfo {
  user_id: string;
  role: string;
  joined_time?: string | null;
}

export interface TeamDetail {
  team_id: string;
  name: string;
  description?: string | null;
  my_role: string;
  members: TeamMemberInfo[];
}

/** 创建团队；JP 从部门导入时把部门成员 user_id 填入 memberUserIds */
export async function createTeam(input: {
  name: string;
  description?: string;
  member_user_ids?: string[];
}): Promise<TeamInfo> {
  return requestJson<TeamInfo>("", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 我相关的团队（own 的 + 加入的） */
export async function fetchMyTeams(): Promise<TeamInfo[]> {
  const data = await requestJson<{ teams: TeamInfo[]; total: number }>("/list", {
    method: "GET",
  });
  return data.teams ?? [];
}

export async function fetchTeamDetail(teamId: string): Promise<TeamDetail> {
  return requestJson<TeamDetail>(`/${encodeURIComponent(teamId)}`, {
    method: "GET",
  });
}

export async function updateTeam(
  teamId: string,
  input: { name?: string; description?: string }
): Promise<TeamInfo> {
  return requestJson<TeamInfo>(`/${encodeURIComponent(teamId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** 解散团队；仍有知识库绑定时后端返回 409 */
export async function deleteTeam(teamId: string): Promise<void> {
  await requestJson<null>(`/${encodeURIComponent(teamId)}`, { method: "DELETE" });
}

export async function addTeamMembers(
  teamId: string,
  userIds: string[]
): Promise<void> {
  await requestJson<null>(`/${encodeURIComponent(teamId)}/members`, {
    method: "POST",
    body: JSON.stringify({ user_ids: userIds }),
  });
}

export async function removeTeamMember(
  teamId: string,
  userId: string
): Promise<void> {
  await requestJson<null>(
    `/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" }
  );
}

/** 调整成员角色（仅团队长）：admin=设为管理员 / member=降为普通成员 */
export async function updateTeamMemberRole(
  teamId: string,
  userId: string,
  role: "admin" | "member"
): Promise<void> {
  await requestJson<null>(
    `/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}/role`,
    { method: "PUT", body: JSON.stringify({ role }) }
  );
}
