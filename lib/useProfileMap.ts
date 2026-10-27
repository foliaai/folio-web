"use client";

/**
 * 用户档案（显示名/头像）批量解析 hook，带模块级缓存。
 *
 * 文件上传者、成员名单等多处需要 user_id → 显示名；auth 的
 * /users/profiles 批量接口按 id 查询，这里加进程内 Map 缓存 +
 * 在途去重，跨组件共享，避免列表页反复请求。
 * 查不到的 id 静默缺席，调用方按工号回退显示。
 */

import { useEffect, useState } from "react";
import { getProfilesBatch, type UserProfileBrief } from "@/lib/api/user";

const profileCache = new Map<string, UserProfileBrief>();
const inflightBatch = new Map<string, Promise<void>>();

function fetchMissing(userIds: string[]): Promise<void> {
  const missing = userIds.filter((id) => id && !profileCache.has(id));
  if (missing.length === 0) return Promise.resolve();

  const key = [...missing].sort().join(",");
  const existing = inflightBatch.get(key);
  if (existing) return existing;

  const task = (async () => {
    const map = await getProfilesBatch(missing);
    missing.forEach((id) => {
      const profile = map[id];
      if (profile) profileCache.set(id, profile);
      else if (!profileCache.has(id)) profileCache.set(id, { user_id: id, display_name: id });
    });
  })().finally(() => inflightBatch.delete(key));

  inflightBatch.set(key, task);
  return task;
}

/** 单个用户显示名（同步取缓存；供非 hook 场景的回退渲染） */
export function getCachedDisplayName(userId?: string | null): string | null {
  if (!userId) return null;
  return profileCache.get(userId)?.display_name ?? null;
}

/**
 * 传入 user_id 列表，返回已解析的档案映射（缓存命中即时返回，
 * 缺失部分后台补齐后触发重渲染）。
 */
export function useProfileMap(userIds: string[]): Record<string, UserProfileBrief> {
  const [map, setMap] = useState<Record<string, UserProfileBrief>>(() =>
    Object.fromEntries(
      userIds
        .filter((id) => id && profileCache.has(id))
        .map((id) => [id, profileCache.get(id)!])
    )
  );

  useEffect(() => {
    let cancelled = false;
    const missing = userIds.filter((id) => id && !profileCache.has(id));
    if (missing.length === 0) {
      // 全量命中缓存：同步对齐一次，避免列表变化后 map 过期
      setMap(
        Object.fromEntries(
          userIds.filter((id) => id).map((id) => [id, profileCache.get(id)!])
        )
      );
      return;
    }
    void fetchMissing(userIds).then(() => {
      if (cancelled) return;
      setMap(
        Object.fromEntries(
          userIds.filter((id) => profileCache.has(id)).map((id) => [id, profileCache.get(id)!])
        )
      );
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [[...userIds].sort().join(",")]);

  return map;
}
