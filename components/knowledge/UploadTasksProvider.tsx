"use client";

/**
 * 用户级全局上传任务状态。
 *
 * 上传 / 索引进度卡片独立于任何对话区与页面：任务发起于知识库页，但状态
 * 存放在全局 Provider（AppShell 层），切换 session、切换页面都不会丢失，
 * 卡片常驻视口右上角。索引阶段（indexing）由 Provider 自行轮询
 * `/api/knowledge/index/progress/batch` 推进到 completed / error，
 * 不依赖知识库页面的文件列表数据。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { UploadProgressCard, type UploadTaskItem } from "@/components/knowledge/UploadProgressCard";
import {
  buildKnowledgeIndex,
  fetchIndexProgress,
  uploadSingleKnowledgeFile,
} from "@/lib/api/knowledge";

interface UploadTasksContextValue {
  uploadTasks: UploadTaskItem[];
  /** 把用户选择的文件加入全局上传队列（发起上传的唯一入口） */
  addFiles(
    files: File[],
    knowledgeBaseId: string,
    folderId?: string | null
  ): void;
  cancelTask(taskId: string): void;
  retryTask(taskId: string): void;
  removeTask(taskId: string): void;
  clearCompleted(): void;
  closeAll(): void;
  /**
   * 注册"单文件上传 + 触发索引完成"回调（知识库页用它刷新文件列表）。
   * Provider 不感知页面刷新逻辑；未注册时静默跳过。
   */
  registerSettledHandler(
    cb: (knowledgeBaseId: string) => void | Promise<void>
  ): () => void;
}

const UploadTasksContext = createContext<UploadTasksContextValue | null>(null);

const MAX_CONCURRENT_UPLOADS = 2;
const INDEX_POLL_INTERVAL_MS = 4000;

export function UploadTasksProvider({ children }: { children: ReactNode }) {
  const [uploadTasks, setUploadTasks] = useState<UploadTaskItem[]>([]);
  const processingTaskIdsRef = useRef<Set<string>>(new Set());
  const settledHandlerRef = useRef<
    ((knowledgeBaseId: string) => void | Promise<void>) | null
  >(null);

  const registerSettledHandler = useCallback(
    (cb: (knowledgeBaseId: string) => void | Promise<void>) => {
      settledHandlerRef.current = cb;
      return () => {
        if (settledHandlerRef.current === cb) {
          settledHandlerRef.current = null;
        }
      };
    },
    []
  );

  // 多文件并发调度：最多 2 个文件同时进行数据上传传输
  useEffect(() => {
    const currentUploadingCount = uploadTasks.filter(
      (t) => t.status === "uploading"
    ).length;

    const availableSlots = MAX_CONCURRENT_UPLOADS - currentUploadingCount;
    if (availableSlots <= 0) return;

    const waitingTasks = uploadTasks.filter(
      (t) => t.status === "waiting" && !processingTaskIdsRef.current.has(t.id)
    );

    const tasksToStart = waitingTasks.slice(0, availableSlots);
    tasksToStart.forEach((task) => {
      void runSingleUploadTaskRef.current(task);
    });
  }, [uploadTasks]);

  const runSingleUploadTask = async (task: UploadTaskItem) => {
    processingTaskIdsRef.current.add(task.id);
    const controller = new AbortController();

    setUploadTasks((prev) =>
      prev.map((t) =>
        t.id === task.id
          ? { ...t, status: "uploading", abortController: controller }
          : t
      )
    );

    try {
      const uploaded = await uploadSingleKnowledgeFile({
        file: task.file,
        knowledge_base_id: task.knowledgeBaseId,
        folder_id: task.folderId,
        signal: controller.signal,
        onUploadProgress: (progressEvent) => {
          setUploadTasks((prev) =>
            prev.map((t) => {
              if (t.id !== task.id) return t;
              return {
                ...t,
                progress: progressEvent.progress,
                loaded: progressEvent.loaded,
                speed: progressEvent.speed,
                estimatedSeconds: progressEvent.estimatedSeconds,
              };
            })
          );
        },
      });

      // 上传成功 -> 标记为 indexing，进度交由下方轮询推进
      setUploadTasks((prev) =>
        prev.map((t) =>
          t.id === task.id
            ? {
                ...t,
                status: "indexing",
                progress: 1,
                loaded: task.fileSize,
                speed: 0,
                estimatedSeconds: 0,
                fileId: uploaded.file_id,
              }
            : t
        )
      );

      // 立即触发后台索引构建
      await buildKnowledgeIndex({
        knowledge_base_id: task.knowledgeBaseId,
        file_ids: [uploaded.file_id],
      });

      // 通知注册方（知识库页）刷新文件列表
      await settledHandlerRef.current?.(task.knowledgeBaseId);
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        // 用户主动取消 -> 移除该任务
        setUploadTasks((prev) => prev.filter((t) => t.id !== task.id));
      } else {
        setUploadTasks((prev) =>
          prev.map((t) => {
            if (t.id !== task.id) return t;
            return {
              ...t,
              status: "error",
              speed: 0,
              estimatedSeconds: 0,
              errorMessage:
                error instanceof Error ? error.message : "上传失败",
            };
          })
        );
      }
    } finally {
      processingTaskIdsRef.current.delete(task.id);
    }
  };

  // 调度 effect 需要最新的上传实现，但不希望它成为 effect 依赖（否则每次
  // 渲染都重新跑调度）——通过 ref 转发。
  const runSingleUploadTaskRef = useRef(runSingleUploadTask);
  useEffect(() => {
    runSingleUploadTaskRef.current = runSingleUploadTask;
  });

  // 索引阶段独立轮询：有 indexing 任务时按 fileId 批量查后端进度，
  // success -> completed、failed -> error；全部结束后停止轮询。
  const indexingFileIds = useMemo(
    () =>
      uploadTasks
        .filter((t) => t.status === "indexing" && t.fileId)
        .map((t) => t.fileId as string),
    [uploadTasks]
  );

  useEffect(() => {
    if (indexingFileIds.length === 0) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const files = await fetchIndexProgress(indexingFileIds);
        if (cancelled) return;
        const statusMap = new Map(
          files.map((f) => [f.file_id, f] as const)
        );
        setUploadTasks((prev) => {
          let changed = false;
          const next = prev.map((task) => {
            if (task.status !== "indexing" || !task.fileId) return task;
            const matched = statusMap.get(task.fileId);
            if (!matched) return task;
            // 与页面 mergeProgress 同规则：前台进度(progress>=1)已走完但
            // status 仍 processing（后台摘要/图谱阶段未结束）即视为完成
            const normalized =
              matched.progress >= 1 && matched.status === "processing"
                ? "success"
                : matched.status;
            if (normalized === "success") {
              changed = true;
              return { ...task, status: "completed" as const, progress: 1 };
            }
            if (normalized === "failed") {
              changed = true;
              return {
                ...task,
                status: "error" as const,
                errorMessage:
                  matched.message || "文件解析或索引构建失败",
              };
            }
            return task;
          });
          return changed ? next : prev;
        });
      } catch {
        // 轮询失败静默重试，不打断任务状态
      }
    };

    void poll();
    const timer = setInterval(poll, INDEX_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [indexingFileIds]);

  // 防误触刷新拦截：只要有上传、排队或索引中的任务，就弹窗保护
  useEffect(() => {
    const hasActiveTask = uploadTasks.some(
      (t) =>
        t.status === "uploading" ||
        t.status === "waiting" ||
        t.status === "indexing"
    );
    if (!hasActiveTask) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue =
        "文件正在上传或构建中，离开页面将导致传输中断。确认离开吗？";
      return event.returnValue;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [uploadTasks]);

  const addFiles = useCallback(
    (files: File[], knowledgeBaseId: string, folderId?: string | null) => {
      if (files.length === 0 || !knowledgeBaseId) return;

      const newTasks: UploadTaskItem[] = files.map((file, idx) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${idx}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
        file,
        fileName: file.name,
        fileSize: file.size,
        knowledgeBaseId,
        folderId: folderId ?? null,
        status: "waiting",
        progress: 0,
        loaded: 0,
        speed: 0,
        estimatedSeconds: 0,
      }));

      setUploadTasks((prev) => [...prev, ...newTasks]);
    },
    []
  );

  const cancelTask = useCallback((taskId: string) => {
    setUploadTasks((prev) => {
      const target = prev.find((t) => t.id === taskId);
      if (target?.abortController) {
        target.abortController.abort();
        return prev;
      }
      return prev.filter((t) => t.id !== taskId);
    });
  }, []);

  const retryTask = useCallback((taskId: string) => {
    setUploadTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status: "waiting",
              progress: 0,
              loaded: 0,
              speed: 0,
              estimatedSeconds: 0,
              errorMessage: undefined,
            }
          : t
      )
    );
  }, []);

  const removeTask = useCallback((taskId: string) => {
    setUploadTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  const clearCompleted = useCallback(() => {
    setUploadTasks((prev) => prev.filter((t) => t.status !== "completed"));
  }, []);

  const closeAll = useCallback(() => {
    setUploadTasks((prev) => {
      const isRunning = prev.some(
        (t) =>
          t.status === "uploading" ||
          t.status === "indexing" ||
          t.status === "waiting"
      );
      return isRunning ? prev : [];
    });
  }, []);

  const value = useMemo<UploadTasksContextValue>(
    () => ({
      uploadTasks,
      addFiles,
      cancelTask,
      retryTask,
      removeTask,
      clearCompleted,
      closeAll,
      registerSettledHandler,
    }),
    [
      uploadTasks,
      addFiles,
      cancelTask,
      retryTask,
      removeTask,
      clearCompleted,
      closeAll,
      registerSettledHandler,
    ]
  );

  return (
    <UploadTasksContext.Provider value={value}>
      {children}
    </UploadTasksContext.Provider>
  );
}

export function useUploadTasks(): UploadTasksContextValue {
  const ctx = useContext(UploadTasksContext);
  if (!ctx) {
    throw new Error("useUploadTasks 必须在 UploadTasksProvider 内使用");
  }
  return ctx;
}

/** 全局常驻的上传 / 索引进度卡片（对话区右上角，悬浮于所有页面之上） */
export function GlobalUploadProgressCard() {
  const {
    uploadTasks,
    cancelTask,
    retryTask,
    removeTask,
    clearCompleted,
    closeAll,
  } = useUploadTasks();

  return (
    <UploadProgressCard
      tasks={uploadTasks}
      onCancelTask={cancelTask}
      onRetryTask={retryTask}
      onRemoveTask={removeTask}
      onClearCompleted={clearCompleted}
      onCloseAll={closeAll}
    />
  );
}
