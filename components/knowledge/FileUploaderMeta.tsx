"use client";

import { useProfileMap } from "@/lib/useProfileMap";
import { formatDate } from "@/lib/utils";

/**
 * 文件视图头部的「上传者 + 上传时间」元信息。
 *
 * 共享库内不同成员上传的文件混排，头部标注上传人；
 * 个人库 uploader 恒为本人，仅显示上传时间。
 * user_id 缺席（接口未返回/旧数据）时对应片段不渲染，
 * 显示名走 useProfileMap 进程缓存，查不到按工号回退。
 */
export function FileUploaderMeta({
  userId,
  createdAt,
}: {
  userId?: string | null;
  createdAt?: string | null;
}) {
  const profiles = useProfileMap(userId ? [userId] : []);
  if (!userId && !createdAt) return null;

  const uploaderName = userId
    ? profiles[userId]?.display_name ?? userId
    : null;

  return (
    <>
      {uploaderName ? (
        <span
          className="max-w-[8rem] shrink-0 truncate text-xs text-muted"
          title={`上传者：${uploaderName}`}
        >
          {uploaderName} 上传
        </span>
      ) : null}
      {createdAt ? (
        <span
          className="shrink-0 text-xs text-muted"
          title={`上传时间：${createdAt.slice(0, 19).replace("T", " ")}`}
        >
          {formatDate(createdAt)}
        </span>
      ) : null}
    </>
  );
}
