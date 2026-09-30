"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildKnowledgeIndex,
  createFolder,
  createKnowledgeBase,
  deleteFile,
  deleteFolder,
  deleteKnowledgeBase,
  fetchFolderFiles,
  fetchFolders,
  fetchIndexProgress,
  fetchRootFiles,
  fetchKnowledgeBaseChildren,
  fetchKnowledgeBases,
  moveFile,
  uploadKnowledgeFiles,
} from "@/lib/api/knowledge";
import {
  ConfirmModal,
  type ConfirmAction,
} from "@/components/knowledge/ConfirmModal";
import { KnowledgeChatPanel } from "@/components/knowledge/KnowledgeChatPanel";
import { KnowledgeTree } from "@/components/knowledge/KnowledgeTree";
import { useUploadTasks } from "@/components/knowledge/UploadTasksProvider";
import {
  FolderInfo,
  KnowledgeBaseInfo,
  KnowledgeFile,
} from "@/lib/knowledge-types";
import { cacheKnowledgeFileView } from "@/lib/knowledge-viewer";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { RequireAuth } from "@/components/auth/RequireAuth";

/** 问答作用域：锁定到某个知识库，或该知识库下的某个文件夹 */
interface ChatScope {
  kbId: string;
  kbName?: string;
  folderId: string | null;
  folderName?: string | null;
}

interface KnowledgeMetric {
  fileCount: number;
  lastUpdated?: string;
}

function buildMetrics(files: KnowledgeFile[]): KnowledgeMetric {
  const latest = files
    .map((file) => file.updated_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return {
    fileCount: files.length,
    lastUpdated: latest ? formatDate(latest) : undefined,
  };
}

function mergeProgress(
  baseFiles: KnowledgeFile[],
  progressFiles: Array<{
    file_id: string;
    file_name: string;
    progress: number;
    status: "pending" | "processing" | "success" | "failed";
  }>
): KnowledgeFile[] {
  const progressMap = new Map(progressFiles.map((item) => [item.file_id, item]));

  return baseFiles.map((file) => {
    const progress = progressMap.get(file.file_id);
    if (!progress) return file;
    const normalizedStatus =
      progress.progress >= 1 && progress.status === "processing"
        ? "success"
        : progress.status;
    return {
      ...file,
      file_name: progress.file_name || file.file_name,
      index_status: normalizedStatus,
      progress: normalizedStatus === "success" ? 1 : progress.progress,
    };
  });
}

function isFileIndexing(file: KnowledgeFile): boolean {
  return file.index_status === "pending" || file.index_status === "processing";
}

/** 文件夹自身 + 全部后代文件夹的 id */
function collectFolderSubtreeIds(
  folders: FolderInfo[],
  rootFolderId: string
): Set<string> {
  const ids = new Set<string>([rootFolderId]);
  const queue = [rootFolderId];

  while (queue.length > 0) {
    const current = queue.shift();
    folders.forEach((folder) => {
      if (folder.parent_folder_id === current && !ids.has(folder.folder_id)) {
        ids.add(folder.folder_id);
        queue.push(folder.folder_id);
      }
    });
  }

  return ids;
}

function getAverageProgress(files: KnowledgeFile[]): number {
  if (files.length === 0) return 1;

  return files.reduce((sum, file) => sum + Math.max(0, Math.min(1, file.progress ?? 0)), 0) / files.length;
}

async function fetchKnowledgeBaseTree(): Promise<KnowledgeBaseInfo[]> {
  const roots = await fetchKnowledgeBases();
  const visited = new Set<string>();
  const queue = [...roots];
  const all = [...roots];

  roots.forEach((item) => visited.add(item.knowledge_base_id));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    const children = await fetchKnowledgeBaseChildren(current.knowledge_base_id).catch(
      () => []
    );

    children.forEach((child) => {
      if (visited.has(child.knowledge_base_id)) return;
      visited.add(child.knowledge_base_id);
      all.push(child);
      queue.push(child);
    });
  }

  return all;
}

interface InputPromptAction {
  title: string;
  placeholder: string;
  confirmLabel: string;
  onConfirm: (value: string) => Promise<void>;
}

function InputModal({
  action,
  busy,
  onCancel,
}: {
  action: InputPromptAction | null;
  busy: boolean;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue("");
  }, [action]);

  if (!action) return null;

  const canConfirm = value.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/30 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium text-foreground">{action.title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-muted transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={action.placeholder}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              canConfirm &&
              !busy &&
              !e.nativeEvent.isComposing
            ) {
              void action.onConfirm(value.trim());
            }
          }}
          className="mt-4 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-subtle focus:border-primary focus:bg-white"
        />

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-gray-200 px-4 py-2 text-sm text-foreground transition-colors hover:border-primary"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canConfirm || busy}
            onClick={() => void action.onConfirm(value.trim())}
            className="rounded-full bg-primary px-4 py-2 text-sm text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-primary/40"
          >
            {busy ? "处理中..." : action.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function KnowledgeGuestView() {
  return (
    <RequireAuth
      featureLabel="知识库"
      title="登录后构建你的专属知识库"
      description="上传文档、保存文件夹结构，并围绕私有内容持续问答——这些内容将长期沉淀到你的个人工作区。"
      nextPath="/knowledge"
    >
      <KnowledgeWorkspace />
    </RequireAuth>
  );
}

// ---- 左侧栏可拖拽分割条 ----
// 宽度按视口比例存储：固定像素在 1280 与 2560 上的占屏差一倍，比例才稳定。
// 未自定义时走 DEFAULT_RATIO 并封顶 DEFAULT_MAX；拖过一次后放开到 SPLIT_MAX。
// 双击分割条清除自定义值，回到默认比例。
const SPLIT_RATIO_STORAGE_KEY = "knowledge-workspace-left-ratio";
/** 默认占屏 1/4 */
const SPLIT_RATIO_DEFAULT = 0.25;
const SPLIT_MIN = 240;
const SPLIT_MAX = 560;
/** 默认宽度封顶：25vw 在大屏上过宽，超过即压住，多出的宽度留给对话区 */
const SPLIT_DEFAULT_MAX = 420;
/** SSR / 首帧拿不到 window.innerWidth 时的兜底宽度 */
const SPLIT_FALLBACK_WIDTH = 360;
/** 当前选中的知识库 ID 持久化 key（刷新后保持在原知识库，而非跳回第一个） */
const SELECTED_KB_STORAGE_KEY = "knowledge-workspace-selected-kb";
/** 左栏收/展状态持久化 key */
const LEFT_COLLAPSED_STORAGE_KEY = "knowledge-workspace-left-collapsed";
/**
 * 收起后保留的导轨宽度。
 * 不收到 0：那样展开按钮只能浮在对话区上方，既要避让对话区自己的顶栏，
 * 也让人以为面板被删掉了。留一条 44px 的轨道，收起是可逆的、位置是固定的。
 */
const SPLIT_RAIL_WIDTH = 44;

function KnowledgeWorkspace() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetFolderRef = useRef<string | null>(null);
  /** null = 未自定义，按 SPLIT_RATIO_DEFAULT 计算 */
  const [leftRatio, setLeftRatio] = useState<number | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inputPrompt, setInputPrompt] = useState<InputPromptAction | null>(null);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseInfo[]>([]);
  const [knowledgeMetrics, setKnowledgeMetrics] = useState<Record<string, KnowledgeMetric>>({});
  const [selectedKbId, setSelectedKbId] = useState("");
  /**
   * 问答作用域，与左侧浏览位置解耦：只有知识库/文件夹行上的「对话」按钮会改变它，
   * 点击行本身仅展开或切换浏览目标，不会打断当前会话。
   * 自带名称，这样浏览到别的知识库后作用域标题依然正确。
   */
  const [chatScope, setChatScope] = useState<ChatScope | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  /**
   * 目录内容按知识库分桶缓存。
   *
   * 以前只存「当前选中库」的一份，切库即整体清空——于是别的库即使还展开着，也没
   * 有任何数据可渲染，看起来就是被强行收起了。按 kbId 分桶后，展开过的库各自留着
   * 自己的内容，切库不再互相清除。
   *
   * 桶里有 key 就表示该库已加载完成，据此才能把「空库」和「还没加载」区分开。
   */
  const [foldersByKb, setFoldersByKb] = useState<Record<string, FolderInfo[]>>(
    {},
  );
  const [filesByKb, setFilesByKb] = useState<Record<string, KnowledgeFile[]>>(
    {},
  );
  /** 正在拉取目录的知识库，仅用于渲染行内的载入提示 */
  const [loadingKbIds, setLoadingKbIds] = useState<Record<string, boolean>>({});
  /**
   * 同一个库的并发加载去重。
   * 用 ref 而不是上面那份 state：切换选中库和展开库这两条触发路径可能落在同一个
   * 提交里，此时双方读到的 state 还是旧值，只有 ref 能立即生效。
   */
  const loadingKbIdsRef = useRef<Set<string>>(new Set());
  // 上传任务为用户级全局状态（UploadTasksProvider）：卡片独立于对话区，
  // 切换 session / 页面不丢失；本页面只负责把文件加入队列。
  const { uploadTasks, addFiles, registerSettledHandler } = useUploadTasks();
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  /**
   * 当前浏览库的扁平视图。
   * 页面级的统计、问答可用性校验、删除逻辑都只关心当前浏览的库，让它们继续读这两
   * 个数组，就不必跟着分桶改造一遍。
   */
  const folders = useMemo(
    () => foldersByKb[selectedKbId] ?? [],
    [foldersByKb, selectedKbId],
  );
  const files = useMemo(
    () => filesByKb[selectedKbId] ?? [],
    [filesByKb, selectedKbId],
  );

  const selectedKb = knowledgeBases.find(
    (kb) => kb.knowledge_base_id === selectedKbId
  );
  /** 问答锁定的知识库与当前浏览的是同一个时，才能用已加载的文件夹/文件推导统计与禁用态 */
  const chatScopeIsBrowsed = Boolean(chatScope) && chatScope?.kbId === selectedKbId;
  /** 树上的「问答目标」高亮只在浏览其所属知识库时出现 */
  const selectedFolderId = chatScopeIsBrowsed ? (chatScope?.folderId ?? null) : null;
  const selectedFolder = folders.find((folder) => folder.folder_id === selectedFolderId);
  const canMoveFiles = true;

  /** 把问答锁定到某个知识库（由知识库行的「对话」按钮触发） */
  const startKbChat = useCallback((kb: KnowledgeBaseInfo) => {
    setChatScope({
      kbId: kb.knowledge_base_id,
      kbName: kb.knowledge_base_name,
      folderId: null,
      folderName: null,
    });
  }, []);

  /** folder_id → 所属知识库；树里可以同时展开多个库，操作必须落到文件夹自己的库上 */
  const kbIdByFolderId = useMemo(() => {
    const next = new Map<string, string>();
    for (const [kbId, list] of Object.entries(foldersByKb)) {
      for (const folder of list) next.set(folder.folder_id, kbId);
    }
    return next;
  }, [foldersByKb]);

  /** 把问答锁定到某个文件夹（null 表示回到当前浏览知识库的整库问答） */
  const startFolderChat = useCallback(
    (folderId: string | null) => {
      // 文件夹行可能来自任意一个展开着的库，作用域要跟着它的归属走，
      // 否则会拿另一个库的 folder_id 去问答当前库
      const kbId = folderId
        ? (kbIdByFolderId.get(folderId) ?? selectedKbId)
        : selectedKbId;
      const kb = knowledgeBases.find((item) => item.knowledge_base_id === kbId);
      if (!kb) return;
      const folder = folderId
        ? (foldersByKb[kbId] ?? []).find((item) => item.folder_id === folderId)
        : undefined;
      setChatScope({
        kbId: kb.knowledge_base_id,
        kbName: kb.knowledge_base_name,
        folderId,
        folderName: folder?.folder_name ?? null,
      });
    },
    [foldersByKb, kbIdByFolderId, knowledgeBases, selectedKbId]
  );

  /**
   * 删除文件夹后若问答正锁定在它（或其子孙）上，回退到整库问答。
   * 子树在删除前算好，避免依赖删除后异步重载的 folders 造成误清。
   */
  const clearChatFolderIfRemoved = useCallback((removedFolderIds: Set<string>) => {
    setChatScope((current) =>
      current && current.folderId && removedFolderIds.has(current.folderId)
        ? { ...current, folderId: null, folderName: null }
        : current
    );
  }, []);

  /** 左侧宽度：默认占屏 1/4 并封顶，用户拖过之后按其比例（上限放宽） */
  const effectiveLeftWidth = useMemo(() => {
    const vw = viewportWidth || 0;
    if (!vw) return SPLIT_FALLBACK_WIDTH;
    const cap = leftRatio === null ? SPLIT_DEFAULT_MAX : SPLIT_MAX;
    const raw = vw * (leftRatio ?? SPLIT_RATIO_DEFAULT);
    return Math.round(Math.min(cap, Math.max(SPLIT_MIN, raw)));
  }, [leftRatio, viewportWidth]);

  const visibleFiles = useMemo(() => {
    if (!selectedFolderId) return files;

    const folderIds = collectFolderSubtreeIds(folders, selectedFolderId);
    return files.filter(
      (file) => file.folder_id && folderIds.has(file.folder_id)
    );
  }, [files, folders, selectedFolderId]);

  const fileStats = useMemo(() => {
    const totalSize = visibleFiles.reduce(
      (sum, file) => sum + (file.file_size ?? 0),
      0
    );
    const indexedCount = visibleFiles.filter(
      (file) => file.index_status === "success"
    ).length;

    return {
      totalSize,
      indexedCount,
    };
  }, [visibleFiles]);

  const indexingFiles = useMemo(
    () => visibleFiles.filter(isFileIndexing),
    [visibleFiles]
  );

  const indexingSummary = useMemo(() => {
    const pendingCount = indexingFiles.filter(
      (file) => file.index_status === "pending"
    ).length;
    const processingCount = indexingFiles.filter(
      (file) => file.index_status === "processing"
    ).length;

    return {
      total: indexingFiles.length,
      pendingCount,
      processingCount,
      progress: getAverageProgress(indexingFiles),
    };
  }, [indexingFiles]);

  const chatDisabledReason = useMemo(() => {
    if (!chatScope) {
      return "先选择一个知识库，再围绕文件内容开始问答。";
    }

    // 问答锁定在别的知识库时，其文件列表尚未加载，无法判断是否为空，不做拦截
    if (chatScopeIsBrowsed && visibleFiles.length === 0) {
      return selectedFolder
        ? "当前文件夹下还没有文件，请先上传资料。"
        : "当前知识库还没有文件，请先上传资料。";
    }

    return null;
  }, [
    chatScope,
    chatScopeIsBrowsed,
    selectedFolder,
    visibleFiles.length,
  ]);

  const chatNoticeBanner = useMemo(() => {
    if (chatDisabledReason) return null;

    const hasUploadingTasks = uploadTasks.some(
      (t) => t.status === "uploading" || t.status === "waiting"
    );
    const hasIndexingTasks = uploadTasks.some((t) => t.status === "indexing");

    if (hasUploadingTasks) {
      return "部分文件正在上传中，你仍可基于现有已索引文件提问；上传并索引完成后问答将更完整。";
    }

    if (hasIndexingTasks && indexingSummary.total === 0) {
      return "新文件已上传，正在初始化索引，你仍可基于已有文件提问。";
    }

    if (indexingSummary.total > 0) {
      return `当前有 ${indexingSummary.total} 个文件正在构建索引中，你可正常提问，处理完成后问答将更准确完整。`;
    }

    if (fileStats.indexedCount === 0 && visibleFiles.length > 0) {
      return "文件正在解析中，你可先提问，索引构建完成后结果会更丰富。";
    }

    return null;
  }, [
    chatDisabledReason,
    fileStats.indexedCount,
    indexingSummary.total,
    uploadTasks,
    visibleFiles.length,
  ]);

  const knowledgeBasesView = useMemo(() => {
    return knowledgeBases.map((kb) => ({
      ...kb,
      fileCount: knowledgeMetrics[kb.knowledge_base_id]?.fileCount ?? 0,
      lastUpdated: knowledgeMetrics[kb.knowledge_base_id]?.lastUpdated,
    }));
  }, [knowledgeBases, knowledgeMetrics]);

  const loadKnowledgeBasesData = async () => {
    try {
      const list = await fetchKnowledgeBaseTree();
      setKnowledgeBases(list);
      setSelectedKbId((current) => {
        if (current && list.some((kb) => kb.knowledge_base_id === current)) {
          return current;
        }
        // 刷新后 current 为空 → 优先恢复上次选中的知识库，避免跳回第一个
        try {
          const persisted = window.localStorage.getItem(SELECTED_KB_STORAGE_KEY);
          if (persisted && list.some((kb) => kb.knowledge_base_id === persisted)) {
            return persisted;
          }
        } catch {
          // localStorage 不可用 → 回退到首个
        }
        return list[0]?.knowledge_base_id ?? "";
      });
      setKnowledgeMetrics((current) =>
        Object.fromEntries(
          list.map((kb) => [
            kb.knowledge_base_id,
            current[kb.knowledge_base_id] ?? { fileCount: 0 },
          ])
        )
      );
      setNotice(null);
    } catch (error) {
      setKnowledgeBases([]);
      setKnowledgeMetrics({});
      setSelectedKbId("");
      setFoldersByKb({});
      setFilesByKb({});
      setNotice(
        error instanceof Error
          ? `加载知识库失败：${error.message}`
          : "加载知识库失败"
      );
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 拉取某个知识库的目录内容并写入缓存。
   *
   * 这里不再动 isBusy：以前每次切库都弹一层全屏遮罩，而现在切库不清空旧内容、
   * 展开别的库也会触发加载，全屏阻塞就纯粹是噪音了。加载反馈改由 loadingKbIds
   * 落到对应那一行上。
   */
  const loadKnowledgeBaseWorkspace = async (knowledgeBaseId: string) => {
    if (!knowledgeBaseId) return;
    if (loadingKbIdsRef.current.has(knowledgeBaseId)) return;

    loadingKbIdsRef.current.add(knowledgeBaseId);
    setLoadingKbIds((prev) => ({ ...prev, [knowledgeBaseId]: true }));
    try {
      const nextFolders = await fetchFolders(knowledgeBaseId);
      const [rootFiles, ...filesByFolder] = await Promise.all([
        fetchRootFiles(knowledgeBaseId),
        ...nextFolders.map((folder) => fetchFolderFiles(folder.folder_id)),
      ]);
      // knowledge_base_id 兜底补齐：多库同时可见后，文件的归属决定了它能被拖到
      // 哪些文件夹，缺这个字段会让跨库校验失效。
      const flatFiles = [...rootFiles, ...filesByFolder.flat()].map((file) => ({
        ...file,
        knowledge_base_id: file.knowledge_base_id || knowledgeBaseId,
      }));
      const progress = flatFiles.length
        ? await fetchIndexProgress(flatFiles.map((file) => file.file_id)).catch(
            () => []
          )
        : [];
      const nextFiles = mergeProgress(flatFiles, progress);

      setFoldersByKb((prev) => ({
        ...prev,
        [knowledgeBaseId]: nextFolders,
      }));
      setFilesByKb((prev) => ({ ...prev, [knowledgeBaseId]: nextFiles }));
      setNotice(null);
    } catch (error) {
      // 写入空桶而不是留空：否则这个库会一直被当成「未加载」而反复重试
      setFoldersByKb((prev) => ({ ...prev, [knowledgeBaseId]: [] }));
      setFilesByKb((prev) => ({ ...prev, [knowledgeBaseId]: [] }));
      setNotice(
        error instanceof Error
          ? `同步知识库失败：${error.message}`
          : "同步知识库失败"
      );
    } finally {
      loadingKbIdsRef.current.delete(knowledgeBaseId);
      setLoadingKbIds((prev) => {
        const next = { ...prev };
        delete next[knowledgeBaseId];
        return next;
      });
    }
  };

  /** 展开某个库时按需加载它的目录；已有缓存或正在加载则跳过 */
  const ensureKbContents = useCallback(
    (knowledgeBaseId: string) => {
      if (!knowledgeBaseId) return;
      if (foldersByKb[knowledgeBaseId] || loadingKbIds[knowledgeBaseId]) return;
      void loadKnowledgeBaseWorkspace(knowledgeBaseId);
    },
    // loadKnowledgeBaseWorkspace 是每次渲染重建的普通函数，这里只依赖判定条件
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [foldersByKb, loadingKbIds],
  );

  useEffect(() => {
    void loadKnowledgeBasesData();
  }, []);

  // 视口宽度用于把比例换算成像素；SSR 阶段不读，避免 hydration warning
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setViewportWidth(window.innerWidth);
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  // 启动时还原用户自定义的左栏占比（没有则保持 null，走默认比例）
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(SPLIT_RATIO_STORAGE_KEY);
      if (!raw) return;
      const value = Number(raw);
      if (Number.isFinite(value) && value > 0 && value < 1) {
        setLeftRatio(value);
      }
    } catch {
      // localStorage 不可用（隐私模式 / 配额满）→ 用默认比例即可
    }
  }, []);

  // 还原上次的收/展选择。
  // 这里不会出现「先闪一下展开态再收起」：isLoading 初始为 true，整页显示加载
  // 文案，本 effect 早在工作台挂载之前就跑完了。
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setLeftCollapsed(
        window.localStorage.getItem(LEFT_COLLAPSED_STORAGE_KEY) === "1",
      );
    } catch {
      // localStorage 不可用 → 保持展开
    }
  }, []);

  /**
   * 收/展并立即落盘。
   * 落盘写在事件回调里而不是 useEffect：若用 effect 监听 leftCollapsed，挂载时
   * 它会先用初始值 false 覆盖掉存储里的 "1"，再被还原 effect 纠正回来——多一次
   * 无意义的错误写入。
   */
  const toggleLeftCollapsed = useCallback(() => {
    const next = !leftCollapsed;
    setLeftCollapsed(next);
    try {
      window.localStorage.setItem(
        LEFT_COLLAPSED_STORAGE_KEY,
        next ? "1" : "0",
      );
    } catch {
      // localStorage 不可用 → 本次会话内仍然生效，只是不跨刷新
    }
  }, [leftCollapsed]);

  // 当前选中知识库持久化（刷新后保持在原知识库，而非跳回第一个）
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!selectedKbId) return;
    try {
      window.localStorage.setItem(SELECTED_KB_STORAGE_KEY, selectedKbId);
    } catch {
      // ignore
    }
  }, [selectedKbId]);


  // 拖拽期间监听全局 mousemove / mouseup；同步给 body 加 col-resize 光标 + 禁选中。
  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: MouseEvent) => {
      const vw = window.innerWidth || 1;
      const next = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, event.clientX));
      setLeftRatio(next / vw);
    };
    const onUp = () => setDragging(false);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
  }, [dragging]);

  // 占比变化即时持久化；回到默认（null）时清掉记录
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (leftRatio === null) {
        window.localStorage.removeItem(SPLIT_RATIO_STORAGE_KEY);
      } else {
        window.localStorage.setItem(SPLIT_RATIO_STORAGE_KEY, String(leftRatio));
      }
    } catch {
      // ignore quota / private-mode 错误
    }
  }, [leftRatio]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // 切换浏览的知识库只重新加载目录，不动问答作用域（否则又会打断当前会话）。
  // 这里无条件重新拉取（而非复用缓存），让当前浏览的库始终是最新的；其余库的缓存
  // 保持原样，它们的内容不会因为这次切换而消失。
  useEffect(() => {
    if (!selectedKbId) return;

    void loadKnowledgeBaseWorkspace(selectedKbId);
  }, [selectedKbId]);

  // 首次进入时问答默认锁定当前知识库；知识库被删除后丢弃失效的作用域
  useEffect(() => {
    if (knowledgeBases.length === 0) {
      setChatScope(null);
      return;
    }
    setChatScope((current) => {
      if (
        current &&
        knowledgeBases.some((kb) => kb.knowledge_base_id === current.kbId)
      ) {
        return current;
      }
      if (!selectedKb) return null;
      return {
        kbId: selectedKb.knowledge_base_id,
        kbName: selectedKb.knowledge_base_name,
        folderId: null,
        folderName: null,
      };
    });
  }, [knowledgeBases, selectedKb]);


  // 文件数与更新时间统一从缓存派生，省掉在每个写入点手动同步统计的重复代码
  useEffect(() => {
    setKnowledgeMetrics((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [kbId, list] of Object.entries(filesByKb)) {
        const metric = buildMetrics(list);
        if (
          prev[kbId]?.fileCount !== metric.fileCount ||
          prev[kbId]?.lastUpdated !== metric.lastUpdated
        ) {
          next[kbId] = metric;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [filesByKb]);

  // 索引进度轮询覆盖所有已加载的知识库：它们的文件现在可以同时展示在树里，
  // 只盯着当前选中的那个会让别的库的进度条僵在原地。
  useEffect(() => {
    const pendingByKb = new Map<string, string[]>();
    for (const [kbId, list] of Object.entries(filesByKb)) {
      const ids = list.filter(isFileIndexing).map((file) => file.file_id);
      if (ids.length > 0) pendingByKb.set(kbId, ids);
    }
    if (pendingByKb.size === 0) return;

    const progressIds = [...pendingByKb.values()].flat();

    const timer = window.setInterval(async () => {
      try {
        const progress = await fetchIndexProgress(progressIds);
        setFilesByKb((current) => {
          const next = { ...current };
          for (const kbId of pendingByKb.keys()) {
            const list = current[kbId];
            if (list) next[kbId] = mergeProgress(list, progress);
          }
          return next;
        });
      } catch {
        // Ignore transient polling failures.
      }
    }, 2500);

    return () => window.clearInterval(timer);
  }, [filesByKb]);

  // 上传完成的回调注册到全局 Provider：文件上传 + 触发索引后刷新本页文件列表。
  // 离开知识库页时注销（Provider 静默跳过，回来时页面自行加载）。
  useEffect(() => {
    return registerSettledHandler((knowledgeBaseId) => {
      void loadKnowledgeBaseWorkspace(knowledgeBaseId);
    });
  }, [registerSettledHandler, loadKnowledgeBaseWorkspace]);

  const handleUploadClick = (targetFolderId: string | null = null) => {
    if (!selectedKbId) return;
    uploadTargetFolderRef.current = targetFolderId;
    fileInputRef.current?.click();
  };

  const handleFileSelect = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const fileList = Array.from(event.target.files || []);
    if (fileList.length === 0 || !selectedKbId) return;

    const targetFolderId = uploadTargetFolderRef.current;
    uploadTargetFolderRef.current = null;

    addFiles(fileList, selectedKbId, targetFolderId);
    setNotice(`已添加 ${fileList.length} 个文件到上传队列。`);
    event.target.value = "";
  };

  /** 只创建顶层知识库：子知识库入口已下线，层级改由文件夹表达 */
  const handleCreateKnowledgeBase = () => {
    setInputPrompt({
      title: "新建知识库",
      placeholder: "请输入知识库名称",
      confirmLabel: "创建",
      onConfirm: async (name) => {
        try {
          setIsBusy("kb");
          const item = await createKnowledgeBase({
            knowledge_base_name: name,
            parent_knowledge_base_id: null,
          });
          await loadKnowledgeBasesData();
          setSelectedKbId(item.knowledge_base_id);
          setNotice("知识库已创建。");
        } catch (error) {
          setNotice(
            error instanceof Error ? `创建知识库失败：${error.message}` : "创建知识库失败"
          );
        } finally {
          setIsBusy(null);
          setInputPrompt(null);
        }
      },
    });
  };

  const handleCreateFolder = (parentFolderId: string | null = null) => {
    if (!selectedKbId) return;

    setInputPrompt({
      title: "新建文件夹",
      placeholder: "请输入文件夹名称",
      confirmLabel: "创建",
      onConfirm: async (name) => {
        try {
          setIsBusy("folder");
          await createFolder({
            knowledge_base_id: selectedKbId,
            folder_name: name,
            parent_folder_id: parentFolderId,
          });
          await loadKnowledgeBaseWorkspace(selectedKbId);
          setNotice("文件夹已创建。");
        } catch (error) {
          setNotice(
            error instanceof Error ? `创建文件夹失败：${error.message}` : "创建文件夹失败"
          );
        } finally {
          setIsBusy(null);
          setInputPrompt(null);
        }
      },
    });
  };

  const handleOpenFile = (file: KnowledgeFile) => {
    cacheKnowledgeFileView({
      file,
      knowledgeBaseName: selectedKb?.knowledge_base_name,
    });
    window.open(
      `/knowledge/file/${encodeURIComponent(file.file_id)}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  const handleRetryFile = async (file: KnowledgeFile) => {
    if (!selectedKbId) return;
    try {
      setIsBusy("retry");
      await buildKnowledgeIndex({
        knowledge_base_id: selectedKbId,
        file_ids: [file.file_id],
      });
      setFilesByKb((current) => ({
        ...current,
        [selectedKbId]: (current[selectedKbId] ?? []).map((f) =>
          f.file_id === file.file_id
            ? { ...f, index_status: "pending" as const, progress: 0 }
            : f
        ),
      }));
      setNotice(`文件「${file.file_name}」已重新提交处理。`);
    } catch (error) {
      setNotice(
        error instanceof Error ? `重试失败：${error.message}` : "重试失败"
      );
    } finally {
      setIsBusy(null);
    }
  };

  const handleDeleteFile = async (file: KnowledgeFile) => {
    if (!selectedKbId) return;

    // 索引失败的文件没有可用内容，不值得再拦一次确认
    if (file.index_status === "failed") {
      try {
        setIsBusy("delete-file");
        await deleteFile(file.file_id);
        await loadKnowledgeBaseWorkspace(selectedKbId);
      } catch (error) {
        setNotice(
          error instanceof Error ? `删除失败：${error.message}` : "删除失败"
        );
      } finally {
        setIsBusy(null);
      }
      return;
    }

    setConfirmAction({
      kind: "danger",
      title: `永久删除文件「${file.file_name}」`,
      description:
        "文件及其索引数据会被永久删除，无法恢复，问答将不再引用该文件的内容。",
      confirmLabel: "永久删除",
      onConfirm: async () => {
        try {
          setIsBusy("delete-file");
          await deleteFile(file.file_id);
          await loadKnowledgeBaseWorkspace(selectedKbId);
          setNotice(`文件「${file.file_name}」已永久删除。`);
        } catch (error) {
          setNotice(
            error instanceof Error ? `删除失败：${error.message}` : "删除失败"
          );
        } finally {
          setIsBusy(null);
          setConfirmAction(null);
        }
      },
    });
  };

  const handleDeleteFolder = async (folder: FolderInfo) => {
    if (!selectedKbId) return;

    const childFolders = folders.filter((f) => f.parent_folder_id === folder.folder_id);
    const childFiles = files.filter((f) => f.folder_id === folder.folder_id);
    const isEmpty = childFolders.length === 0 && childFiles.length === 0;
    // 删除前算好子树，删除后据此判断是否要撤掉问答锁定
    const removedFolderIds = collectFolderSubtreeIds(folders, folder.folder_id);

    if (isEmpty) {
      try {
        setIsBusy("delete-folder");
        await deleteFolder(folder.folder_id);
        await loadKnowledgeBaseWorkspace(selectedKbId);
        clearChatFolderIfRemoved(removedFolderIds);
      } catch (error) {
        setNotice(
          error instanceof Error ? `删除文件夹失败：${error.message}` : "删除文件夹失败"
        );
      } finally {
        setIsBusy(null);
      }
      return;
    }

    setConfirmAction({
      kind: "danger",
      title: `永久删除文件夹「${folder.folder_name}」`,
      description:
        "该文件夹及其子文件夹中的文件会被永久删除，无法恢复，问答将不再引用这些文件的内容。",
      confirmLabel: "永久删除",
      onConfirm: async () => {
        try {
          setIsBusy("delete-folder");
          const result = await deleteFolder(folder.folder_id);
          await loadKnowledgeBaseWorkspace(selectedKbId);
          clearChatFolderIfRemoved(removedFolderIds);
          setNotice(
            `已永久删除 ${result.deleted_folder_count} 个文件夹、${result.deleted_file_count} 个文件。`
          );
        } catch (error) {
          setNotice(
            error instanceof Error
              ? `删除文件夹失败：${error.message}`
              : "删除文件夹失败"
          );
        } finally {
          setIsBusy(null);
          setConfirmAction(null);
        }
      },
    });
  };

  const handleDeleteKnowledgeBase = (kb: KnowledgeBaseInfo) => {
    const collectDescendantIds = (parentId: string): string[] => {
      const children = knowledgeBases.filter(
        (item) => item.parent_knowledge_base_id === parentId
      );
      return children.flatMap((child) => [
        child.knowledge_base_id,
        ...collectDescendantIds(child.knowledge_base_id),
      ]);
    };
    const descendantIds = collectDescendantIds(kb.knowledge_base_id);
    const allAffectedIds = new Set([kb.knowledge_base_id, ...descendantIds]);

    const description =
      descendantIds.length > 0
        ? `此操作不可撤销，将同时删除 ${descendantIds.length} 个子知识库。请确保所有知识库内已无文件，否则无法删除。`
        : "此操作不可撤销。请确保知识库内已无文件，否则无法删除。";

    setConfirmAction({
      kind: "knowledge-base",
      title: `删除知识库「${kb.knowledge_base_name}」`,
      description,
      confirmLabel: "删除知识库",
      confirmText: kb.knowledge_base_name,
      dangerNote:
        "删除方式与 GitHub 删除仓库一致，需要手动输入知识库名称确认。",
      onConfirm: async () => {
        try {
          setIsBusy("delete-kb");
          await deleteKnowledgeBase(kb.knowledge_base_id);
          await loadKnowledgeBasesData();
          // 丢掉被删库（含子库）的缓存，否则它们的内容会一直留在树里
          const dropAffected = <T,>(current: Record<string, T>) =>
            Object.fromEntries(
              Object.entries(current).filter(([kbId]) => !allAffectedIds.has(kbId))
            );
          setFoldersByKb(dropAffected);
          setFilesByKb(dropAffected);
          if (allAffectedIds.has(selectedKbId)) {
            setSelectedKbId("");
          }
          setNotice("知识库已删除。");
        } catch (error) {
          setNotice(
            error instanceof Error
              ? `删除知识库失败：${error.message}`
              : "删除知识库失败"
          );
        } finally {
          setIsBusy(null);
          setConfirmAction(null);
        }
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white text-sm text-muted">
        正在加载知识库工作台...
      </div>
    );
  }

  return (
    <>
      <div
        className="flex h-[calc(100dvh-3.5rem)] md:h-screen w-full bg-white xl:grid xl:grid-cols-[var(--knowledge-left-width)_6px_minmax(0,1fr)]"
        style={
          {
            "--knowledge-left-width": `${
              leftCollapsed ? SPLIT_RAIL_WIDTH : effectiveLeftWidth
            }px`,
          } as React.CSSProperties
        }
      >
        {/* 桌面端左侧树面板 (xl 及以上显示) */}
        <div className="hidden min-w-0 overflow-hidden xl:flex">
          {leftCollapsed ? (
            <div className="flex h-full w-full items-start justify-center border-r border-gray-200 py-2.5">
              <button
                type="button"
                onClick={toggleLeftCollapsed}
                aria-expanded={false}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-gray-100 hover:text-foreground cursor-pointer"
                title="展开知识库管理"
                aria-label="展开知识库管理"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          {/* 收起时用 hidden 隐藏而非卸载：树的滚动位置与搜索框开合是组件内部
              状态，卸载会让每次收/展都把它们重置掉。display:none 同时把子树移出
              可访问性树与 tab 顺序，不会留下隐形焦点。 */}
          <div
            className={cn(
              "min-w-0 flex-1 overflow-hidden",
              leftCollapsed && "hidden",
            )}
          >
            <KnowledgeTree
              knowledgeBases={knowledgeBasesView}
              selectedKbId={selectedKbId}
              foldersByKb={foldersByKb}
              filesByKb={filesByKb}
              loadingKbIds={loadingKbIds}
              onRequestKbContents={ensureKbContents}
              uploadTasks={uploadTasks}
              selectedFolderId={selectedFolderId}
              searchTerm={searchTerm}
              canMoveFiles={canMoveFiles}
              onSelectKb={(id) => {
                // 只切换浏览目标，问答会话保持不变
                setSelectedKbId(id);
              }}
              chatKbId={chatScope?.kbId ?? null}
              onChatWithKb={(kb) => {
                setSelectedKbId(kb.knowledge_base_id);
                startKbChat(kb);
              }}
              onCreateKb={handleCreateKnowledgeBase}
              onDeleteKb={(kb) => handleDeleteKnowledgeBase(kb)}
              onSelectFolder={(id) => {
                // 仅由文件夹行上的「对话」按钮触发，展开/折叠不会切会话
                startFolderChat(id);
              }}
              onOpenFile={handleOpenFile}
              onCreateFolder={handleCreateFolder}
              onUploadFile={handleUploadClick}
              onDeleteFolder={handleDeleteFolder}
              onDeleteFile={handleDeleteFile}
              onRetryFile={handleRetryFile}
              onCollapse={toggleLeftCollapsed}
              onSearchChange={setSearchTerm}
              onMoveFileToFolder={async (file, targetFolderId) => {
                try {
                  setIsBusy("move");
                  await moveFile(file.file_id, targetFolderId);
                  // 刷新文件自己所属的库：树里可以同时展开多个库，被拖动的文件
                  // 不一定来自当前浏览的那个
                  await loadKnowledgeBaseWorkspace(
                    file.knowledge_base_id || selectedKbId
                  );
                  setNotice(`文件「${file.file_name}」已移动。`);
                } catch (error) {
                  setNotice(
                    error instanceof Error ? `移动失败：${error.message}` : "移动失败"
                  );
                } finally {
                  setIsBusy(null);
                }
              }}
            />
          </div>
        </div>

        {/* 可拖拽分割条：仅在 xl 及以上可用。
            左栏收起时整条让位——拖动一个已收起的面板没有可预期的结果，
            边线此时由导轨自己的 border-r 提供，不会缺一道线。 */}
        <div
          className={cn(
            "group relative hidden h-full w-full xl:flex xl:items-center xl:justify-center",
            dragging && "bg-primary/10"
          )}
        >
          {leftCollapsed ? null : (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="拖动调整左侧宽度"
              onMouseDown={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDoubleClick={() => setLeftRatio(null)}
              className="h-full w-full cursor-col-resize"
              title="拖动调整宽度（双击恢复默认 1/4 屏宽）"
            >
              <div
                className={cn(
                  "h-full w-px transition-colors",
                  dragging
                    ? "bg-primary/60"
                    : "bg-gray-200 group-hover:bg-primary/40"
                )}
              />
            </div>
          )}
        </div>

        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <KnowledgeChatPanel
            knowledgeBaseId={chatScope?.kbId ?? null}
            knowledgeBaseName={chatScope?.kbName}
            selectedFolderId={chatScope?.folderId ?? null}
            selectedFolderName={chatScope?.folderName ?? null}
            disabled={Boolean(chatDisabledReason)}
            disabledReason={chatDisabledReason ?? undefined}
            noticeBanner={chatNoticeBanner ?? undefined}
            enabled
            onToggleMobileTree={() => setMobileDrawerOpen((v) => !v)}
            className="h-full w-full"
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.markdown,.json,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {/* 移动端知识库/文件管理抽屉 (xl 以下) */}
      <div
        className={cn(
          "fixed inset-0 z-[1100] bg-black/40 backdrop-blur-xs transition-opacity duration-300 xl:hidden",
          mobileDrawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setMobileDrawerOpen(false)}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-[1101] flex h-full w-[min(380px,88vw)] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out xl:hidden",
          mobileDrawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/80 px-4 py-3">
          <span className="text-sm font-semibold text-foreground">知识库与文件管理</span>
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-gray-200/70 hover:text-foreground cursor-pointer"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <KnowledgeTree
            knowledgeBases={knowledgeBasesView}
            selectedKbId={selectedKbId}
            foldersByKb={foldersByKb}
            filesByKb={filesByKb}
            loadingKbIds={loadingKbIds}
            onRequestKbContents={ensureKbContents}
            uploadTasks={uploadTasks}
            selectedFolderId={selectedFolderId}
            searchTerm={searchTerm}
            canMoveFiles={canMoveFiles}
            onSelectKb={(id) => {
              setSelectedKbId(id);
            }}
            chatKbId={chatScope?.kbId ?? null}
            onChatWithKb={(kb) => {
              setSelectedKbId(kb.knowledge_base_id);
              startKbChat(kb);
              setMobileDrawerOpen(false);
            }}
            onCreateKb={handleCreateKnowledgeBase}
            onDeleteKb={(kb) => handleDeleteKnowledgeBase(kb)}
            onSelectFolder={(id) => {
              startFolderChat(id);
              setMobileDrawerOpen(false);
            }}
            onOpenFile={handleOpenFile}
            onCreateFolder={handleCreateFolder}
            onUploadFile={handleUploadClick}
            onDeleteFolder={handleDeleteFolder}
            onDeleteFile={handleDeleteFile}
            onRetryFile={handleRetryFile}
            onSearchChange={setSearchTerm}
            onMoveFileToFolder={async (file, targetFolderId) => {
              try {
                setIsBusy("move");
                await moveFile(file.file_id, targetFolderId);
                await loadKnowledgeBaseWorkspace(
                  file.knowledge_base_id || selectedKbId
                );
                setNotice(`文件「${file.file_name}」已移动。`);
              } catch (error) {
                setNotice(
                  error instanceof Error ? `移动失败：${error.message}` : "移动失败"
                );
              } finally {
                setIsBusy(null);
              }
            }}
          />
        </div>
      </aside>

      <ConfirmModal
        action={confirmAction}
        busy={Boolean(isBusy && confirmAction)}
        onCancel={() => {
          if (isBusy) return;
          setConfirmAction(null);
        }}
      />
      <InputModal
        action={inputPrompt}
        busy={Boolean(isBusy)}
        onCancel={() => {
          if (isBusy) return;
          setInputPrompt(null);
        }}
      />

      {isBusy ? (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/10 backdrop-blur-[2px]">
          <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-5 py-3.5 shadow-xl">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-foreground">
              {isBusy === "delete-file" && "正在删除文件，清理关联数据…"}
              {isBusy === "delete-folder" && "正在删除文件夹，清理关联数据…"}
              {isBusy === "delete-kb" && "正在删除知识库…"}
              {!["delete-file", "delete-folder", "delete-kb"].includes(isBusy) && "处理中…"}
            </span>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="fixed bottom-16 md:bottom-6 left-1/2 z-[100] -translate-x-1/2 animate-in fade-in slide-in-from-bottom-4 duration-300 max-w-[calc(100vw-2rem)] w-auto">
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-lg backdrop-blur-sm",
              notice.includes("失败") || notice.includes("错误")
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-green-200 bg-green-50 text-green-700"
            )}
          >
            {notice.includes("失败") || notice.includes("错误") ? (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="ml-2 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}

    </>
  );
}

export default function KnowledgePage() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <KnowledgeGuestView />;
  }

  return <KnowledgeWorkspace />;
}
