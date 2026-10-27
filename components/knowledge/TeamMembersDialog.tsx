"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addTeamMembers,
  fetchTeamDetail,
  removeTeamMember,
  transferTeamOwner,
  updateTeamMemberRole,
  type TeamDetail,
} from "@/lib/api/team";
import { getOrgMembers, getProfilesBatch, getUserProfile, searchUsers } from "@/lib/api/user";
import type {
  UserDepartmentItem,
  UserProfileBrief,
  UserSearchItem,
} from "@/lib/api/user";
import { ConfirmModal, type ConfirmAction } from "@/components/knowledge/ConfirmModal";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { cn } from "@/lib/utils";
import {
  Check,
  Crown,
  Loader2,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";

/**
 * 共享知识库的成员管理面板（"团队"是纯后端授权实现，UI 不出现该概念，D12）。
 *
 * 交互：
 * - 任何成员可查看名单；负责人/管理员可邀请与移除（管理员移管理员需负责人）
 * - 负责人可设/撤「管理员」、转让负责人（转让后自己降为管理员）
 * - JP 快速邀请：主部门未入队成员一键加入（数据驱动：无 departments 不出现）
 * - 成员组随库创建、删库自动回收——面板内没有解散/改名等团队级操作
 */

const ROLE_LABEL: Record<string, string> = {
  owner: "负责人",
  admin: "管理员",
  member: "成员",
};

export function TeamMembersDialog({
  teamId,
  kbName,
  onClose,
  onChanged,
}: {
  teamId: string;
  kbName: string;
  onClose: () => void;
  /** 成员/团队有变化时回调（刷新外层无必要，仅透传提示） */
  onChanged?: (message: string) => void;
}) {
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);

  // 邀请搜人（防抖）
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimer = useRef<number | null>(null);

  // JP 快速邀请（主部门）
  const [mainDept, setMainDept] = useState<UserDepartmentItem | null>(null);
  const [quickInviting, setQuickInviting] = useState(false);

  // 成员档案（显示名 + 头像；查不到时按工号回退渲染）
  const [profileMap, setProfileMap] = useState<Record<string, UserProfileBrief>>({});

  const notify = useCallback((message: string) => {
    setNotice(message);
    onChanged?.(message);
  }, [onChanged]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await fetchTeamDetail(teamId));
    } catch (err) {
      // 网络层失败（TypeError: Failed to fetch）给友好文案；服务端 detail 透传
      setError(
        err instanceof TypeError
          ? "成员信息加载失败，请检查网络后重试"
          : err instanceof Error
            ? err.message
            : "加载成员信息失败"
      );
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 成员名单到位后批量拉档案（渲染显示名 + 头像；接口缺席/失败静默回退工号）
  useEffect(() => {
    const ids = detail?.members.map((m) => m.user_id) ?? [];
    if (ids.length === 0) return;
    let cancelled = false;
    void getProfilesBatch(ids).then((map) => {
      if (!cancelled) setProfileMap(map);
    });
    return () => {
      cancelled = true;
    };
  }, [detail]);

  useEffect(() => {
    // JP：取主部门（is_main 优先）供快速邀请；prd 无 departments 自然不出现
    void getUserProfile().then((profile) => {
      const depts = profile?.departments?.filter((d) => d?.id != null) ?? [];
      setMainDept(
        depts.find((d) => d.is_main) ?? depts[0] ?? null
      );
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const keyword = query.trim();
    if (keyword.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = window.setTimeout(async () => {
      const items = await searchUsers(keyword);
      setResults(items);
      setSearching(false);
      setShowResults(true);
    }, 300);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [query]);

  const myRole = detail?.my_role ?? "member";
  const isOwner = myRole === "owner";
  const isManager = isOwner || myRole === "admin";
  const memberIds = useMemo(
    () => new Set(detail?.members.map((m) => m.user_id) ?? []),
    [detail]
  );

  const handleAddMember = async (user: UserSearchItem) => {
    if (!detail) return;
    try {
      await addTeamMembers(detail.team_id, [user.user_id]);
      notify(`已邀请：${user.display_name}（${user.user_id}）`);
      setQuery("");
      setShowResults(false);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "邀请失败");
    }
  };

  /** JP 快速邀请：主部门未入队成员一键加入 */
  const handleQuickInvite = async () => {
    if (!detail || !mainDept) return;
    setQuickInviting(true);
    try {
      const data = await getOrgMembers(mainDept.id);
      const toAdd = (data?.members ?? [])
        .map((m) => m.user_id)
        .filter((uid) => !memberIds.has(uid));
      if (toAdd.length === 0) {
        notify(`「${mainDept.name}」的同事都已在成员列表中`);
      } else {
        await addTeamMembers(detail.team_id, toAdd);
        notify(`已从「${mainDept.name}」邀请 ${toAdd.length} 名成员加入`);
        await load();
      }
    } catch {
      notify("快速邀请失败，请稍后重试");
    } finally {
      setQuickInviting(false);
    }
  };

  const handleRemoveMember = (userId: string, role: string) => {
    if (!detail) return;
    setConfirm({
      kind: "danger",
      title: "移除成员",
      description: `确定移除 ${userId}？其将失去知识库「${kbName}」的访问权。`,
      confirmLabel: "移除",
      onConfirm: async () => {
        await removeTeamMember(detail.team_id, userId);
        notify(`已移除成员：${userId}`);
        await load();
      },
    });
    void role;
  };

  const handleToggleRole = async (userId: string, role: string) => {
    if (!detail) return;
    const next = role === "admin" ? "member" : "admin";
    try {
      await updateTeamMemberRole(detail.team_id, userId, next);
      notify(
        next === "admin"
          ? `已将 ${userId} 设为管理员`
          : `已将 ${userId} 降为普通成员`
      );
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : "调整角色失败");
    }
  };

  /** 转让负责人：确认后调用，原负责人（自己）降为管理员 */
  const handleTransferOwner = (userId: string, displayName: string) => {
    if (!detail) return;
    setConfirm({
      kind: "default",
      title: "转让负责人",
      description: `确定将知识库「${kbName}」的负责人转让给 ${displayName}？转让后对方可管理成员与角色，你将变为管理员。`,
      confirmLabel: "转让",
      onConfirm: async () => {
        await transferTeamOwner(detail.team_id, userId);
        notify(`负责人已转让给：${displayName}`);
        await load();
      },
    });
  };

  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/30 px-4 pb-4 backdrop-blur-sm sm:items-center sm:pb-0">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`成员管理：${kbName}`}
        className="flex max-h-[86vh] w-full max-w-lg flex-col rounded-2xl border border-gray-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-medium text-foreground">
              成员管理
            </h2>
            <p className="mt-0.5 truncate text-xs text-muted">
              知识库「{kbName}」的共享成员
              {detail ? ` · ${detail.members.length} 人` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-muted transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
            aria-label="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {notice ? (
            <p
              className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-foreground"
              role="status"
            >
              {notice}
            </p>
          ) : null}
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              加载中…
            </div>
          ) : error || !detail ? (
            <p className="py-6 text-center text-sm text-red-600" role="alert">
              {error ?? "成员信息不可用"}
            </p>
          ) : (
            <>
              {/* 邀请区（负责人/管理员） */}
              {isManager ? (
                <div className="space-y-2.5">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-faint" aria-hidden="true" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onFocus={() => results.length > 0 && setShowResults(true)}
                      onBlur={() => window.setTimeout(() => setShowResults(false), 150)}
                      placeholder="搜索用户邀请（姓名 / 工号）"
                      aria-label="搜索用户邀请"
                      className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                    {showResults ? (
                      <div className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-52 overflow-y-auto rounded-xl border border-gray-200 bg-white shadow-lg">
                        {searching ? (
                          <p className="flex items-center px-3.5 py-3 text-xs text-muted">
                            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden="true" />
                            搜索中…
                          </p>
                        ) : results.length === 0 ? (
                          <p className="px-3.5 py-3 text-xs text-muted">
                            没有找到相关用户，试试其他关键字
                          </p>
                        ) : (
                          results.map((user) => {
                            const already = memberIds.has(user.user_id);
                            return (
                              <button
                                key={user.user_id}
                                type="button"
                                disabled={already}
                                onClick={() => void handleAddMember(user)}
                                className={cn(
                                  "flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
                                  already
                                    ? "cursor-not-allowed opacity-50"
                                    : "hover:bg-primary/[0.04] cursor-pointer"
                                )}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-foreground">
                                    {user.display_name}
                                  </span>
                                  <span className="block truncate text-xs text-muted">
                                    {user.user_id}
                                  </span>
                                </span>
                                {already ? (
                                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
                                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                    已加入
                                  </span>
                                ) : (
                                  <UserPlus className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    ) : null}
                  </div>

                  {/* JP 快速邀请（数据驱动：无部门信息不出现） */}
                  {mainDept ? (
                    <button
                      type="button"
                      onClick={() => void handleQuickInvite()}
                      disabled={quickInviting}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-primary/30 bg-primary/[0.04] px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                    >
                      {quickInviting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      邀请「{mainDept.name}」的同部门成员
                    </button>
                  ) : null}
                </div>
              ) : null}

              {/* 成员列表 */}
              <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                {detail.members.map((member) => {
                  const profile = profileMap[member.user_id];
                  return (
                    <li
                      key={member.user_id}
                      className="flex items-center justify-between gap-2 px-3.5 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <UserAvatar
                          userId={member.user_id}
                          avatarUrl={profile?.avatar_url ?? null}
                          name={profile?.display_name ?? member.user_id}
                          size="sm"
                          shape="rounded-full"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm text-foreground">
                            {profile?.display_name ?? member.user_id}
                          </p>
                          <p className="text-xs text-muted">
                            {ROLE_LABEL[member.role] ?? member.role}
                            {member.joined_time
                              ? ` · ${member.joined_time.slice(0, 10)} 加入`
                              : ""}
                          </p>
                        </div>
                        {member.role === "admin" ? (
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                        ) : null}
                      </div>
                      {isOwner && member.role !== "owner" ? (
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => void handleToggleRole(member.user_id, member.role)}
                            title={member.role === "admin" ? "降为普通成员" : "设为管理员"}
                            aria-label={`${member.role === "admin" ? "降为普通成员" : "设为管理员"} ${profile?.display_name ?? member.user_id}`}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-gray-100 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
                          >
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleTransferOwner(
                                member.user_id,
                                profile?.display_name ?? member.user_id
                              )
                            }
                            title="转让负责人（自己降为管理员）"
                            aria-label={`转让负责人给 ${profile?.display_name ?? member.user_id}`}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-gray-100 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary cursor-pointer"
                          >
                            <Crown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(member.user_id, member.role)}
                            title="移除成员"
                            aria-label={`移除成员 ${profile?.display_name ?? member.user_id}`}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-50 hover:text-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : isManager &&
                        member.role === "member" ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(member.user_id, member.role)}
                          title="移除成员"
                          aria-label={`移除成员 ${profile?.display_name ?? member.user_id}`}
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-red-50 hover:text-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              {/* 我的角色（成员组随库生灭，无团队级操作） */}
              <p className="text-center text-xs text-muted-faint">
                我的角色：{ROLE_LABEL[myRole] ?? myRole}
              </p>
            </>
          )}
        </div>
      </div>

      <ConfirmModal action={confirm} busy={false} onCancel={() => setConfirm(null)} />
    </div>
  );
}
