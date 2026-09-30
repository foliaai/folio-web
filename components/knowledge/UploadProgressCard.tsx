"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";
import { FileIcon } from "@/components/knowledge/FileIcon";

export type TaskStatus =
  | "waiting"
  | "uploading"
  | "indexing"
  | "completed"
  | "error";

export interface UploadTaskItem {
  id: string;
  file: File;
  fileName: string;
  fileSize: number;
  knowledgeBaseId: string;
  folderId?: string | null;
  status: TaskStatus;
  progress: number; // 0 ~ 1
  loaded: number;
  speed: number; // bytes/s
  estimatedSeconds: number;
  errorMessage?: string;
  fileId?: string;
  abortController?: AbortController;
}

interface UploadProgressCardProps {
  tasks: UploadTaskItem[];
  onCancelTask?: (taskId: string) => void;
  onRetryTask?: (taskId: string) => void;
  onRemoveTask?: (taskId: string) => void;
  onClearCompleted?: () => void;
  onCloseAll?: () => void;
}

function formatSpeed(bytesPerSec?: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "0 KB/s";
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatRemainingTime(seconds?: number): string {
  if (seconds === undefined || seconds <= 0 || !Number.isFinite(seconds)) {
    return "计算中…";
  }
  if (seconds < 60) {
    return `约 ${seconds} 秒`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) {
    return secs > 0 ? `约 ${mins} 分 ${secs} 秒` : `约 ${mins} 分钟`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `约 ${hours} 小时 ${remMins} 分`;
}

export function UploadProgressCard({
  tasks,
  onCancelTask,
  onRetryTask,
  onRemoveTask,
  onClearCompleted,
  onCloseAll,
}: UploadProgressCardProps) {
  const [isMinimized, setIsMinimized] = useState(false);
  const [isListExpanded, setIsListExpanded] = useState(true);

  const summary = useMemo(() => {
    const totalCount = tasks.length;
    let waitingCount = 0;
    let uploadingCount = 0;
    let indexingCount = 0;
    let completedCount = 0;
    let errorCount = 0;
    let totalBytes = 0;
    let loadedBytes = 0;
    let totalSpeed = 0;

    tasks.forEach((task) => {
      totalBytes += task.fileSize || 0;
      if (task.status === "waiting") {
        waitingCount += 1;
      } else if (task.status === "uploading") {
        uploadingCount += 1;
        loadedBytes += task.loaded || 0;
        totalSpeed += task.speed || 0;
      } else if (task.status === "indexing") {
        indexingCount += 1;
        loadedBytes += task.fileSize || 0;
      } else if (task.status === "completed") {
        completedCount += 1;
        loadedBytes += task.fileSize || 0;
      } else if (task.status === "error") {
        errorCount += 1;
        loadedBytes += task.loaded || 0;
      }
    });

    const isRunning = uploadingCount > 0 || indexingCount > 0 || waitingCount > 0;
    const progress = totalBytes > 0 ? Math.min(1, loadedBytes / totalBytes) : 0;
    const percent = Math.min(100, Math.max(0, Math.round(progress * 100)));

    const remainingBytes = Math.max(0, totalBytes - loadedBytes);
    const estimatedSeconds =
      totalSpeed > 0 ? Math.round(remainingBytes / totalSpeed) : 0;

    return {
      totalCount,
      waitingCount,
      uploadingCount,
      indexingCount,
      completedCount,
      errorCount,
      totalBytes,
      loadedBytes,
      totalSpeed,
      progress,
      percent,
      estimatedSeconds,
      isRunning,
    };
  }, [tasks]);

  if (tasks.length === 0) return null;

  // 外层只负责定位（常驻）；内层按形态渲染并带 origin-top-right 的
  // zoom-in + fade 入场动画——放大/收起时从右上角缩放浮现，走合成器
  // 动画，轨迹干净顺滑。top 定位避开对话面板顶部状态栏（上下文统计 +
  // 会话控制，高约 49px）。
  return (
    <div className="fixed top-14 md:top-16 right-3 md:right-6 z-[95]">
      {isMinimized ? (
        <div
          key="pill"
          className="flex origin-top-right animate-in fade-in zoom-in-95 duration-200 items-center gap-2.5 rounded-full border border-gray-200/90 bg-white/95 px-4 py-2.5 shadow-xl backdrop-blur-md transition-shadow duration-200 hover:shadow-2xl max-w-[calc(100vw-1.5rem)]"
        >
          {summary.uploadingCount > 0 && (
            <div className="flex items-center gap-2">
              <UploadCloud className="h-4 w-4 animate-bounce text-primary" />
              <span className="text-xs font-medium text-foreground">
                正在上传 ({summary.completedCount}/{summary.totalCount}) · {summary.percent}%
              </span>
            </div>
          )}
          {!summary.uploadingCount && summary.indexingCount > 0 && (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
              <span className="text-xs font-medium text-foreground">
                索引构建中 ({summary.indexingCount} 个)
              </span>
            </div>
          )}
          {!summary.isRunning && summary.errorCount === 0 && (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-xs font-medium text-emerald-700">
                全部上传就绪 ({summary.completedCount})
              </span>
            </div>
          )}
          {!summary.isRunning && summary.errorCount > 0 && (
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <span className="text-xs font-medium text-red-600">
                {summary.errorCount} 个文件失败
              </span>
            </div>
          )}

          <div className="flex items-center gap-1 pl-1 border-l border-gray-200">
            <button
              type="button"
              onClick={() => setIsMinimized(false)}
              className="rounded p-1 text-muted transition-colors hover:bg-gray-100 hover:text-foreground"
              title="展开任务详情"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
            {!summary.isRunning && onCloseAll && (
              <button
                type="button"
                onClick={onCloseAll}
                className="rounded p-1 text-muted transition-colors hover:bg-gray-100 hover:text-foreground"
                title="关闭"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          key="panel"
          className="flex origin-top-right animate-in fade-in zoom-in-95 duration-200 w-[420px] max-w-[calc(100vw-1.5rem)] max-h-[min(78dvh,560px)] overflow-y-auto flex-col rounded-2xl border border-gray-200/90 bg-white/95 p-4 shadow-2xl backdrop-blur-md"
        >
          {/* 头部摘要 */}
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <div className="flex items-center gap-2.5 min-w-0">
              {summary.isRunning && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <UploadCloud className="h-4 w-4 animate-pulse" />
                </div>
              )}
              {!summary.isRunning && summary.errorCount === 0 && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
              )}
              {!summary.isRunning && summary.errorCount > 0 && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                  <AlertCircle className="h-4 w-4" />
                </div>
              )}

              <div className="min-w-0">
                <h4 className="truncate text-xs font-semibold text-foreground">
                  {summary.isRunning &&
                    `文件上传处理中 (${summary.completedCount}/${summary.totalCount} 已完成)`}
                  {!summary.isRunning &&
                    summary.errorCount === 0 &&
                    `全部 ${summary.totalCount} 个文件已就绪`}
                  {!summary.isRunning &&
                    summary.errorCount > 0 &&
                    `上传结束（${summary.completedCount} 成功，${summary.errorCount} 失败）`}
                </h4>
                <p className="text-[11px] text-muted truncate">
                  {summary.uploadingCount > 0 &&
                    `总速度 ${formatSpeed(summary.totalSpeed)} · 剩余 ${formatRemainingTime(summary.estimatedSeconds)}`}
                  {summary.uploadingCount === 0 && summary.indexingCount > 0 &&
                    `上传已完成，正在投递后台生成向量索引…`}
                  {!summary.isRunning &&
                    summary.errorCount === 0 &&
                    `已成功录入知识库，可直接开启智能问答`}
                  {!summary.isRunning &&
                    summary.errorCount > 0 &&
                    `部分文件上传失败，可点击重试或查看错误`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsListExpanded(!isListExpanded)}
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground"
                title={isListExpanded ? "收起列表" : "展开列表"}
              >
                {isListExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setIsMinimized(true)}
                className="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground"
                title="最小化"
              >
                <Minimize2 className="h-3.5 w-3.5" />
              </button>
              {!summary.isRunning && onCloseAll && (
                <button
                  type="button"
                  onClick={onCloseAll}
                  className="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground"
                  title="关闭"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* 总体进度条 */}
          <div className="mt-3 space-y-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300 ease-out",
                  summary.isRunning && "bg-gradient-to-r from-emerald-500 to-teal-500",
                  !summary.isRunning && summary.errorCount === 0 && "bg-emerald-500",
                  !summary.isRunning && summary.errorCount > 0 && "bg-amber-500"
                )}
                style={{ width: `${Math.max(4, summary.percent)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>
                {formatBytes(summary.loadedBytes)} / {formatBytes(summary.totalBytes)} ({summary.percent}%)
              </span>
              {summary.isRunning && (
                <span className="text-primary font-medium">
                  {summary.uploadingCount} 上传中 · {summary.indexingCount} 索引中 · {summary.waitingCount} 排队
                </span>
              )}
            </div>
          </div>

          {/* 独立文件列表明细 */}
          {isListExpanded && (
            <div className="mt-3 max-h-60 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/40 p-2 space-y-2">
              {tasks.map((task) => {
                const taskPercent = Math.min(
                  100,
                  Math.max(0, Math.round((task.progress || 0) * 100))
                );

                return (
                  <div
                    key={task.id}
                    className="group relative rounded-lg border border-gray-100 bg-white p-2.5 shadow-sm transition-all hover:border-gray-200"
                  >
                    <div className="flex items-center gap-2.5">
                      <FileIcon fileName={task.fileName} className="h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-foreground">
                            {task.fileName}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted">
                            {formatBytes(task.fileSize)}
                          </span>
                        </div>

                        {/* 单文件状态指示 */}
                        <div className="mt-1 flex items-center justify-between text-[11px]">
                          {task.status === "waiting" && (
                            <div className="flex items-center gap-1 text-amber-600">
                              <Clock className="h-3 w-3" />
                              <span>排队等待中…</span>
                            </div>
                          )}

                          {task.status === "uploading" && (
                            <div className="flex items-center gap-2 text-primary font-medium">
                              <span>上传中 {taskPercent}%</span>
                              <span className="text-muted font-normal text-[10px]">
                                {formatSpeed(task.speed)} · 剩 {formatRemainingTime(task.estimatedSeconds)}
                              </span>
                            </div>
                          )}

                          {task.status === "indexing" && (
                            <div className="flex items-center gap-1.5 text-blue-600 font-medium">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>已上传，后台构建索引中…</span>
                            </div>
                          )}

                          {task.status === "completed" && (
                            <div className="flex items-center gap-1 text-emerald-600 font-medium">
                              <CheckCircle2 className="h-3 w-3" />
                              <span>已就绪</span>
                            </div>
                          )}

                          {task.status === "error" && (
                            <div
                              className="flex items-center gap-1 text-red-600 font-medium truncate"
                              title={task.errorMessage}
                            >
                              <AlertCircle className="h-3 w-3 shrink-0" />
                              <span className="truncate">
                                {task.errorMessage || "上传失败"}
                              </span>
                            </div>
                          )}

                          {/* 操作按钮 */}
                          <div className="flex items-center gap-1">
                            {task.status === "uploading" && onCancelTask && (
                              <button
                                type="button"
                                onClick={() => onCancelTask(task.id)}
                                className="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                              >
                                取消
                              </button>
                            )}
                            {task.status === "error" && onRetryTask && (
                              <button
                                type="button"
                                onClick={() => onRetryTask(task.id)}
                                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-primary hover:bg-primary/10 transition-colors font-medium"
                              >
                                <RotateCcw className="h-3 w-3" />
                                重试
                              </button>
                            )}
                            {(task.status === "completed" || task.status === "error") &&
                              onRemoveTask && (
                                <button
                                  type="button"
                                  onClick={() => onRemoveTask(task.id)}
                                  className="rounded p-0.5 text-muted hover:bg-gray-100 hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
                                  title="移除此项"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                          </div>
                        </div>

                        {/* 单文件独立进度条 */}
                        {task.status === "uploading" && (
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full bg-primary transition-all duration-200"
                              style={{ width: `${Math.max(3, taskPercent)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 底部操作与提示 */}
          <div className="mt-3 flex items-center justify-between text-[10px] text-muted">
            {summary.isRunning ? (
              <span className="text-amber-600">
                💡 上传过程中请勿刷新或关闭网页，以免中断连接
              </span>
            ) : (
              <span>所有任务已结束</span>
            )}

            {summary.completedCount > 0 && onClearCompleted && (
              <button
                type="button"
                onClick={onClearCompleted}
                className="flex items-center gap-1 text-muted hover:text-foreground transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                清空已完成
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
