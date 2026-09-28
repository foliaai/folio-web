"use client";

import { useCallback, useEffect, useState } from "react";
import { getCurrentUserId } from "@/lib/config";
import {
  getUserProfile,
  updateUserProfile,
  uploadUserAvatar,
  type UserProfileData,
} from "@/lib/api/user";

// 全局监听器实现跨组件实时同步（如 ProfileDrawer 上传头像，Sidebar 瞬间更新）
type ProfileListener = (profile: UserProfileData | null) => void;
const listeners = new Set<ProfileListener>();
let globalProfileCache: Record<string, UserProfileData | null> = {};

function notifyListeners(profile: UserProfileData | null) {
  if (profile) {
    globalProfileCache[profile.user_id] = profile;
    try {
      localStorage.setItem(`user_profile_${profile.user_id}`, JSON.stringify(profile));
    } catch {
      // 忽略存储异常
    }
  }
  for (const listener of listeners) {
    listener(profile);
  }
}

export function useUserProfile() {
  const userId = getCurrentUserId();
  const [profile, setProfile] = useState<UserProfileData | null>(() => {
    if (typeof window === "undefined") return null;
    if (globalProfileCache[userId] !== undefined) return globalProfileCache[userId];
    try {
      const cached = localStorage.getItem(`user_profile_${userId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        globalProfileCache[userId] = parsed;
        return parsed;
      }
    } catch {
      // 忽略缓存解析异常
    }
    return null;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 刷新用户资料
  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getUserProfile();
      if (data) {
        setProfile(data);
        notifyListeners(data);
      }
    } catch (err: any) {
      setError(err?.message || "获取资料失败");
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  // 监听全局同步事件
  useEffect(() => {
    const listener: ProfileListener = (newProfile) => {
      if (newProfile && newProfile.user_id === userId) {
        setProfile(newProfile);
      } else if (!newProfile) {
        setProfile(null);
      }
    };
    listeners.add(listener);

    // 首次挂载时拉取最新后端数据
    refreshProfile();

    return () => {
      listeners.delete(listener);
    };
  }, [userId, refreshProfile]);

  // 上传头像
  const handleUploadAvatar = useCallback(
    async (file: File) => {
      setIsLoading(true);
      setError(null);
      try {
        const avatarUrl = await uploadUserAvatar(file);
        const updated: UserProfileData = {
          ...(profile || { user_id: userId }),
          avatar_url: avatarUrl,
          updated_at: new Date().toISOString(),
        };
        setProfile(updated);
        notifyListeners(updated);
        return avatarUrl;
      } catch (err: any) {
        const msg = err?.message || "上传头像失败";
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [profile, userId]
  );

  // 更新资料（昵称、简介）
  const handleUpdateProfile = useCallback(
    async (data: { nickname?: string; bio?: string }) => {
      setIsLoading(true);
      setError(null);
      try {
        const updated = await updateUserProfile(data);
        if (updated) {
          setProfile(updated);
          notifyListeners(updated);
        }
        return updated;
      } catch (err: any) {
        const msg = err?.message || "更新资料失败";
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  return {
    userId,
    profile,
    avatarUrl: profile?.avatar_url || null,
    nickname: profile?.nickname || null,
    bio: profile?.bio || null,
    gender: profile?.gender ?? null,
    departments: profile?.departments ?? [],
    isLoading,
    error,
    refreshProfile,
    uploadAvatar: handleUploadAvatar,
    updateProfile: handleUpdateProfile,
  };
}
