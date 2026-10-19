"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderInfo, KnowledgeFile } from "@/lib/knowledge-types";
import { cn, formatBytes } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  Folder,
  FolderPlus,
  Loader2,
  MessageSquare,
  PanelLeftOpen,
  RotateCcw,
  Search,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";import { FileIcon } from "@/components/knowledge/FileIcon";
import type { UploadTaskItem } from "@/components/knowledge/UploadProgressCard";
import type { KnowledgeBaseNode } from "@/components/knowledge/KnowledgeTree";

/** 缩进步长与旧版树保持一致：文件夹 → 子文件夹 → 文件最深可视层级 */
const INDENT_STEP = 12;
const INDENT_BASE = 10;
const INDENT_MAX_DEPTH = 6;

const indentOf = (depth: number) =>
  INDENT_BASE + Math.min(depth, INDENT_MAX_DEPTH) * INDENT_STEP;

/**
 * 展开状态沿用旧树同一个存储键的 folders 部分：布局拆栏后用户已展开的
 * 文件夹直接继承；kbs 部分已无展开语义，读取时忽略、写入时不再产生。
 */
const EXPANDED_STORAGE_KEY = "knowledge-tree-expanded-v1";

function readExpandedFolders(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { folders?: Record<string, boolean> };
    return parsed.folders ?? {};
  } catch {
    return {};
  }
}

/** 只落盘展开项，避免键随折叠操作无限增长 */
function pickExpanded(map: Record<string, boolean>): Record<string, boolean> {
  return Object.fromEntries(Object.entries(map).filter(([, open]) => open));
}

interface KbFilePanelProps {
  /** 当前浏览（选中）的知识库；null 表示左侧还没选中任何库 */
  kb: KnowledgeBaseNode | null;
  /** 该知识库的全量文件夹（已由调用方按 kbId 分桶） */
  folders: FolderInfo[];
  /** 该知识库的全量文件 */
  files: KnowledgeFile[];
  /** 目录是否正在加载（loadingKbIds[kbId]） */
  loading?: boolean;
  uploadTasks?: UploadTaskItem[];
  canMoveFiles?: boolean;
  /** 当前问答锁定的文件夹（文件夹行高亮） */
  selectedFolderId?: string | null;
  /** 列表折叠态的展开入口；传入时显示在信息栏最左（与列表头部收起按钮同位） */
  onExpandList?: () => void;
  /** 围绕某个文件夹开启问答 */
  onSelectFolder: (folderId: string | null) => void;
  onOpenFile?: (file: KnowledgeFile) => void;
  onCreateFolder?: (parentFolderId: string | null) => void;
  onUploadFile?: (targetFolderId: string | null) => void;
  onDeleteFolder?: (folder: FolderInfo) => void;
  onDeleteFile?: (file: KnowledgeFile) => void;
  onRetryFile?: (file: KnowledgeFile) => void;
  onMoveFileToFolder?: (file: KnowledgeFile, targetFolderId: string | null) => void;
}

/**
 * 右侧文件管理面板：只负责「当前选中知识库」内部的文件夹与文件。
 * 原单栏树里的知识库列表职责已拆回 KnowledgeTree；这里承接全部
 * 目录级写操作入口（上传 / 新建文件夹 / 删除 / 拖拽移动）。
 */
export const KbFilePanel = ({
  kb,
  folders,
  files,
  loading = false,
  uploadTasks = [],
  canMoveFiles = false,
  selectedFolderId,
  onExpandList,
  onSelectFolder,
  onOpenFile,
  onCreateFolder,
  onUploadFile,
  onDeleteFolder,
  onDeleteFile,
  onRetryFile,
  onMoveFileToFolder,
}: KbFilePanelProps) => {
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>(
    () => readExpandedFolders()
  );
  const [draggingFileId, setDraggingFileId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const kbId = kb?.knowledge_base_id ?? "";

  // 文件夹展开状态跨刷新保留（与旧树同一份存储）
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        EXPANDED_STORAGE_KEY,
        JSON.stringify({ kbs: {}, folders: pickExpanded(expandedFolders) })
      );
    } catch {
      // 隐私模式或配额写满时忽略，展开状态退化为仅本次会话有效
    }
  }, [expandedFolders]);

  // 有上传任务分配到某个文件夹时，自动展开该文件夹及其各级父文件夹
  useEffect(() => {
    if (uploadTasks.length === 0) return;
    const folderLookup = new Map(folders.map((f) => [f.folder_id, f]));
    setExpandedFolders((current) => {
      let changed = false;
      const next = { ...current };
      uploadTasks.forEach((task) => {
        let fid = task.folderId;
        while (fid) {
          if (!next[fid]) {
            next[fid] = true;
            changed = true;
          }
          fid = folderLookup.get(fid)?.parent_folder_id ?? null;
        }
      });
      return changed ? next : current;
    });
  }, [uploadTasks, folders]);

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const rootFolders = useMemo(
    () =>
      folders
        .filter((folder) => !folder.parent_folder_id)
        .sort((a, b) => a.folder_name.localeCompare(b.folder_name)),
    [folders]
  );

  const childFoldersByParent = useMemo(() => {
    const next = new Map<string, FolderInfo[]>();
    folders.forEach((folder) => {
      if (!folder.parent_folder_id) return;
      const list = next.get(folder.parent_folder_id) ?? [];
      list.push(folder);
      next.set(folder.parent_folder_id, list);
    });
    next.forEach((list) => list.sort((a, b) => a.folder_name.localeCompare(b.folder_name)));
    return next;
  }, [folders]);

  const rootFiles = useMemo(
    () =>
      files
        .filter((file) => !file.folder_id)
        .sort((a, b) => a.file_name.localeCompare(b.file_name)),
    [files]
  );

  const filesByFolder = useMemo(() => {
    const next = new Map<string, KnowledgeFile[]>();
    files.forEach((file) => {
      if (!file.folder_id) return;
      const list = next.get(file.folder_id) ?? [];
      list.push(file);
      next.set(file.folder_id, list);
    });
    next.forEach((list) => list.sort((a, b) => a.file_name.localeCompare(b.file_name)));
    return next;
  }, [files]);

  // 已出现在文件列表里的任务不再画占位行，避免同一个文件重复出现
  const pendingTasks = useMemo(() => {
    const existingFileIds = new Set(files.map((f) => f.file_id));
    return uploadTasks.filter(
      (task) => task.knowledgeBaseId === kbId && !(task.fileId && existingFileIds.has(task.fileId))
    );
  }, [uploadTasks, files, kbId]);

  const rootTasks = useMemo(
    () => pendingTasks.filter((task) => !task.folderId),
    [pendingTasks]
  );

  const tasksByFolder = useMemo(() => {
    const next = new Map<string, UploadTaskItem[]>();
    pendingTasks.forEach((task) => {
      if (!task.folderId) return;
      const list = next.get(task.folderId) ?? [];
      list.push(task);
      next.set(task.folderId, list);
    });
    return next;
  }, [pendingTasks]);

  const matchesFile = useCallback(
    (file: KnowledgeFile) =>
      `${file.file_name} ${file.description ?? ""} ${file.mime_type ?? ""}`
        .toLowerCase()
        .includes(normalizedSearch),
    [normalizedSearch]
  );

  // 命中的文件夹及其祖先链；null 表示不过滤
  const matchedFolderIds = useMemo(() => {
    if (!normalizedSearch) return null;

    const folderLookup = new Map(folders.map((folder) => [folder.folder_id, folder]));
    const next = new Set<string>();

    folders.forEach((folder) => {
      if (!folder.folder_name.toLowerCase().includes(normalizedSearch)) return;
      next.add(folder.folder_id);
      let parentId = folder.parent_folder_id;
      while (parentId) {
        next.add(parentId);
        parentId = folderLookup.get(parentId)?.parent_folder_id ?? null;
      }
    });

    files.forEach((file) => {
      if (!matchesFile(file)) return;
      let folderId = file.folder_id ?? null;
      while (folderId) {
        next.add(folderId);
        folderId = folderLookup.get(folderId)?.parent_folder_id ?? null;
      }
    });

    return next;
  }, [files, folders, matchesFile, normalizedSearch]);

  const folderFilter = matchedFolderIds;
  const fileFilterActive = Boolean(normalizedSearch);
  const hasVisibleRootContent =
    rootFolders.length > 0 || rootFiles.length > 0 || rootTasks.length > 0;

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((current) => ({
      ...current,
      [folderId]: !current[folderId],
    }));
  };

  const draggingFile = useMemo(
    () =>
      draggingFileId
        ? (files.find((file) => file.file_id === draggingFileId) ?? null)
        : null,
    [draggingFileId, files]
  );

  /** 本面板只展示一个库，拖拽天然不跨库；仍要求 canMoveFiles 且有落点回调 */
  const canDrop = Boolean(canMoveFiles && onMoveFileToFolder && draggingFile);

  const handleDropAt = (targetFolderId: string | null) => {
    const file = draggingFile;
    setDraggingFileId(null);
    setDragOverFolderId(null);
    if (file) onMoveFileToFolder?.(file, targetFolderId);
  };

  const renderUploadingPlaceholder = (task: UploadTaskItem, depth: number) => {
    if (fileFilterActive && !task.fileName.toLowerCase().includes(normalizedSearch)) {
      return null;
    }

    const pct = Math.round(Math.max(0, Math.min(1, task.progress || 0)) * 100);

    return (
      <div
        key={`placeholder-${task.id}`}
        className="group relative mb-0.5 flex h-8 items-center gap-2 overflow-hidden rounded-md border border-dashed border-primary/30 bg-primary/[0.04] px-2 text-sm text-foreground/75 transition-all animate-in fade-in duration-200"
        style={{ paddingLeft: indentOf(depth) }}
      >
        {task.status === "uploading" && (
          <div
            className="pointer-events-none absolute bottom-0 left-0 top-0 bg-primary/10 transition-all duration-200"
            style={{ width: `${Math.max(4, pct)}%` }}
          />
        )}

        <div className="relative flex min-w-0 flex-1 items-center gap-2">
          <FileIcon fileName={task.fileName} className="h-5 w-5 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1 truncate font-normal text-foreground/80">
            {task.fileName}
          </span>
        </div>

        <div className="relative flex shrink-0 items-center gap-1.5 text-[11px]">
          {task.status === "waiting" && (
            <span className="font-medium text-amber-600/90">排队中</span>
          )}
          {task.status === "uploading" && (
            <span className="flex items-center gap-1 font-medium text-primary">
              <UploadCloud className="h-3 w-3 animate-pulse" />
              {pct}%
            </span>
          )}
          {task.status === "indexing" && (
            <span className="flex items-center gap-1 font-medium text-blue-600">
              <Loader2 className="h-3 w-3 animate-spin" />
              解析中
            </span>
          )}
          {task.status === "error" && (
            <span
              className="max-w-[70px] truncate font-medium text-red-500"
              title={task.errorMessage}
            >
              上传失败
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderFile = (file: KnowledgeFile, depth: number) => {
    if (fileFilterActive && !matchesFile(file)) {
      return null;
    }

    const status = file.index_status ?? "pending";
    const isProcessing = status !== "success" && status !== "failed";
    const isFailed = status === "failed";
    const isDraggable = canMoveFiles && status === "success";
    const pct = Math.round(Math.max(0, Math.min(1, file.progress ?? 0)) * 100);

    const statusLabels: Record<string, string> = {
      pending: "排队中",
      processing: `${pct}%`,
      failed: "失败",
    };

    return (
      <div
        key={file.file_id}
        draggable={isDraggable}
        onDragStart={() => setDraggingFileId(file.file_id)}
        onDragEnd={() => setDraggingFileId(null)}
        className={cn(
          "group flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted transition-colors hover:bg-gray-100 hover:text-foreground",
          isDraggable && "cursor-grab active:cursor-grabbing",
          draggingFileId === file.file_id && "opacity-40"
        )}
        style={{ paddingLeft: indentOf(depth) }}
      >
        <FileIcon fileName={file.file_name} className="h-5 w-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={file.file_name}>
          {file.file_name}
        </span>

        {isProcessing || isFailed ? (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 text-[11px] group-hover:hidden",
              isFailed ? "text-red-500" : "text-primary"
            )}
          >
            {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {statusLabels[status] ?? status}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-muted-subtle group-hover:hidden">
            {formatBytes(file.file_size)}
          </span>
        )}
        <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
          {isFailed && onRetryFile ? (
            <button
              type="button"
              onClick={() => onRetryFile(file)}
              className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-primary"
              title="重试"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {status === "success" && onOpenFile ? (
            <button
              type="button"
              onClick={() => onOpenFile(file)}
              className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-foreground"
              title="详情"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {onDeleteFile ? (
            <button
              type="button"
              onClick={() => onDeleteFile(file)}
              className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-red-300"
              title="删除"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const renderFolder = (folder: FolderInfo, depth: number) => {
    if (folderFilter && !folderFilter.has(folder.folder_id)) {
      return null;
    }

    const childFolders = childFoldersByParent.get(folder.folder_id) ?? [];
    const childFiles = filesByFolder.get(folder.folder_id) ?? [];
    const childTasks = tasksByFolder.get(folder.folder_id) ?? [];
    const isExpanded = normalizedSearch
      ? true
      : (expandedFolders[folder.folder_id] ?? false);
    const isDragOver = canDrop && dragOverFolderId === folder.folder_id;
    const isChatTarget = selectedFolderId === folder.folder_id;

    return (
      <div key={folder.folder_id}>
        <div
          onDragOver={(event) => {
            if (!canDrop) return;
            event.preventDefault();
            event.stopPropagation();
            setDragOverFolderId(folder.folder_id);
          }}
          onDragLeave={() => {
            if (dragOverFolderId === folder.folder_id) setDragOverFolderId(null);
          }}
          onDrop={(event) => {
            if (!canDrop) return;
            event.preventDefault();
            event.stopPropagation();
            handleDropAt(folder.folder_id);
          }}
          className={cn(
            "group flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors",
            isChatTarget
              ? "bg-primary/10 text-foreground"
              : "text-foreground/80 hover:bg-gray-100",
            // 拖拽落点用描边区分，否则与「问答目标」的底色一模一样
            isDragOver && "bg-primary/10 text-foreground ring-1 ring-inset ring-primary/50"
          )}
          style={{ paddingLeft: indentOf(depth) }}
        >
          <button
            type="button"
            onClick={() => toggleFolder(folder.folder_id)}
            className="flex min-w-0 flex-1 items-center gap-2"
            title={folder.folder_name}
          >
            {isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
            )}
            <Folder className="h-4 w-4 shrink-0 text-muted-faint" />
            <span className="min-w-0 flex-1 truncate text-left">{folder.folder_name}</span>
          </button>
          <div
            className={cn(
              "shrink-0 items-center gap-0.5",
              isChatTarget ? "flex" : "hidden group-hover:flex"
            )}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectFolder(folder.folder_id);
              }}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded",
                isChatTarget ? "text-primary" : "text-muted hover:text-foreground"
              )}
              title="围绕此文件夹问答"
              aria-label="围绕此文件夹问答"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
            {onUploadFile ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUploadFile(folder.folder_id);
                }}
                className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-foreground"
                title="上传文件到此文件夹"
              >
                <UploadCloud className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {onCreateFolder ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateFolder(folder.folder_id);
                }}
                className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-foreground"
                title="在此文件夹下新建子文件夹"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {onDeleteFolder && folder.is_default !== 1 ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteFolder(folder);
                }}
                className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-red-300"
                title="删除文件夹"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
        {isExpanded ? (
          <>
            {childFolders.map((child) => renderFolder(child, depth + 1))}
            {childTasks.map((task) => renderUploadingPlaceholder(task, depth + 1))}
            {childFiles.map((file) => renderFile(file, depth + 1))}
          </>
        ) : null}
      </div>
    );
  };

  // ---------- 未选中知识库 ----------

  if (!kb) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center bg-gray-50/40 px-6 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-gray-200/70">
          <Database className="h-5 w-5 text-muted-faint" />
        </div>
        <p className="mt-3 text-sm text-foreground/80">从左侧选择一个知识库</p>
        <p className="mt-1 text-xs text-muted-subtle">
          文件夹与文件将在这里管理，可上传、移动、删除
        </p>
      </div>
    );
  }

  // ---------- 面板主体 ----------

  const isLoaded = folders.length > 0 || files.length > 0 || !loading;
  const isEmpty =
    isLoaded &&
    !loading &&
    folders.length === 0 &&
    files.length === 0 &&
    pendingTasks.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* 信息区：知识库身份与统计，预留后续补充基础信息（描述 / 创建者等）
          的空间——min-h 保持留白，底色与内容区分隔、不用边线
          （避免与左侧列表头部的水平线错位） */}
      <div className="flex min-h-[84px] shrink-0 flex-col justify-center gap-1.5 bg-gray-50/60 px-3 py-3">
        <div className="flex items-center gap-2">
          {onExpandList ? (
            <button
              type="button"
              onClick={onExpandList}
              aria-expanded={false}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-gray-100 hover:text-foreground cursor-pointer"
              title="展开知识库列表"
              aria-label="展开知识库列表"
            >
              <PanelLeftOpen className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <Database className="h-4 w-4 shrink-0 text-primary" />
          <span
            className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
            title={kb.knowledge_base_name}
          >
            {kb.knowledge_base_name}
          </span>
          {kb.visibility === "team" ? (
            <span
              className="shrink-0 rounded bg-primary/10 px-1 py-px text-[10px] leading-4 font-normal text-primary"
              title="共享知识库：通过「成员管理」邀请的成员共同读写"
            >
              共享
            </span>
          ) : kb.visibility === "public" ? (
            <span
              className="shrink-0 rounded bg-amber-50 px-1 py-px text-[10px] leading-4 font-normal text-amber-600"
              title="订阅知识库：所有登录用户可读"
            >
              订阅
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 pl-6 text-[11px] text-muted-subtle">
          <span>{kb.fileCount} 个文件</span>
          {kb.lastUpdated ? (
            <span className="text-muted-faint">· 最近更新 {kb.lastUpdated}</span>
          ) : null}
          {/* 后续知识库基础信息（描述 / 创建者 / 成员数等）加在这一行或下方 */}
        </div>
      </div>

      {/* 管理动作行：左侧「全部文件」小标题与右侧动作组对称，不带下边线 */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
        <span className="min-w-0 truncate px-1 text-xs text-muted">全部文件</span>
        <div className="flex shrink-0 items-center gap-1">
        {onUploadFile ? (
          <button
            type="button"
            onClick={() => onUploadFile(null)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-gray-100 hover:text-primary cursor-pointer"
            title="上传文件到根目录"
            aria-label="上传文件"
          >
            <UploadCloud className="h-4 w-4" />
          </button>
        ) : null}
        {onCreateFolder ? (
          <button
            type="button"
            onClick={() => onCreateFolder(null)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-gray-100 hover:text-foreground cursor-pointer"
            title="新建文件夹"
            aria-label="新建文件夹"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setSearchOpen(!searchOpen);
            if (searchOpen) setSearchTerm("");
          }}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-gray-100 hover:text-foreground",
            searchOpen && "bg-gray-100 text-foreground"
          )}
          title="搜索文件夹 / 文件"
          aria-label="搜索"
        >
          <Search className="h-4 w-4" />
        </button>
        </div>
      </div>

      {searchOpen ? (
        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
          <input
            autoFocus
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="在当前知识库内搜索..."
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-subtle"
          />
          {searchTerm ? (
            <button
              type="button"
              onClick={() => setSearchTerm("")}
              className="flex h-4 w-4 items-center justify-center rounded text-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* 拖到空白处＝移回根目录；overflow-x-hidden：内联像素缩进不能撑出横向滚动条 */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden py-1"
        onDragOver={(event) => {
          if (!canDrop) return;
          event.preventDefault();
          setDragOverFolderId(null);
        }}
        onDrop={(event) => {
          if (!canDrop) return;
          event.preventDefault();
          handleDropAt(null);
        }}
      >
        {rootFolders.map((folder) => renderFolder(folder, 0))}
        {rootTasks.map((task) => renderUploadingPlaceholder(task, 0))}
        {rootFiles.map((file) => renderFile(file, 0))}

        {/* 「载入中」与「暂无内容」分开：切换库时先看到 spinner，而不是误判为空 */}
        {loading && !hasVisibleRootContent && folders.length === 0 ? (
          <div className="flex items-center gap-1.5 px-3 py-4 text-xs text-muted-subtle">
            <Loader2 className="h-3 w-3 animate-spin" />
            正在载入目录…
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
            <UploadCloud className="h-6 w-6 text-muted-faint" />
            <p className="mt-2 text-xs text-muted-subtle">
              这个知识库还没有内容，点右上角
              <button
                type="button"
                onClick={() => onUploadFile?.(null)}
                className="mx-0.5 text-primary underline-offset-2 hover:underline"
              >
                上传文件
              </button>
              开始添加
            </p>
          </div>
        ) : !hasVisibleRootContent && !fileFilterActive ? (
          <div className="px-3 py-4 text-xs text-muted-subtle">
            根目录暂无内容{folders.length > 0 ? "，全部在子文件夹中" : ""}
          </div>
        ) : null}

        {fileFilterActive && !hasVisibleRootContent ? (
          <div className="px-3 py-4 text-xs text-muted-subtle">没有匹配的内容</div>
        ) : null}
      </div>
    </div>
  );
};
