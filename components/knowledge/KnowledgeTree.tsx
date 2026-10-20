"use client";

import { useMemo, useState } from "react";
import { KnowledgeBaseInfo } from "@/lib/knowledge-types";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Globe,
  PanelLeftClose,
  Plus,
  Search,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";

/** 列表层缩进：兼容历史上创建的子知识库（新建子库入口已下线） */
const INDENT_STEP = 12;
const INDENT_BASE = 10;
const INDENT_MAX_DEPTH = 6;

const indentOf = (depth: number) =>
  INDENT_BASE + Math.min(depth, INDENT_MAX_DEPTH) * INDENT_STEP;

export type KnowledgeBaseNode = KnowledgeBaseInfo & {
  fileCount: number;
  lastUpdated?: string;
};

interface KnowledgeTreeProps {
  /**
   * 全量知识库，由调用方拍平后传入。
   * 仍按 parent_knowledge_base_id 嵌套渲染，以兼容历史上创建的子知识库；
   * 新建子知识库的入口已下线，不再产生新的嵌套。
   */
  knowledgeBases: KnowledgeBaseNode[];
  /** 当前浏览的知识库；决定右侧文件面板展示哪个库 */
  selectedKbId?: string;
  /** 当前问答锁定的知识库；与 selectedKbId 解耦，点击知识库行不会改变它 */
  chatKbId?: string | null;
  /** 当前问答锁定的文件夹；锁定到文件夹时整库行不再是问答目标 */
  chatFolderId?: string | null;
  searchTerm?: string;
  onSelectKb: (id: string) => void;
  /** 打开团队知识库的成员管理面板（邀请/快速邀请/角色）；仅团队库行显示 */
  onManageTeamMembers?: (kb: KnowledgeBaseInfo) => void;
  onCreateKb?: () => void;
  onDeleteKb?: (kb: KnowledgeBaseInfo) => void;
  onSearchChange?: (term: string) => void;
  /** 收起左侧库列表（文件管理区不受影响）；未传则不显示收起按钮 */
  onCollapse?: () => void;
}

/**
 * 左侧知识库列表：只负责库的选择与库级操作（对话 / 成员管理 / 删除）。
 * 库内文件夹与文件的管理职责在右侧 KbFilePanel——本组件不再渲染目录内容。
 */
export const KnowledgeTree = ({
  knowledgeBases,
  selectedKbId,
  chatKbId,
  chatFolderId,
  searchTerm = "",
  onSelectKb,
  onManageTeamMembers,
  onCreateKb,
  onDeleteKb,
  onSearchChange,
  onCollapse,
}: KnowledgeTreeProps) => {
  const [searchOpen, setSearchOpen] = useState(false);
  /** 三分区（个人/共享/订阅）折叠状态：键为分区 key，值为 true 表示已折叠 */
  const [collapsedSections, setCollapsedSections] = useState<
    Record<string, boolean>
  >({});

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const kbChildrenByParent = useMemo(() => {
    const next = new Map<string | null, KnowledgeBaseNode[]>();
    knowledgeBases.forEach((kb) => {
      const key = kb.parent_knowledge_base_id ?? null;
      const list = next.get(key) ?? [];
      list.push(kb);
      next.set(key, list);
    });
    next.forEach((list) =>
      list.sort((a, b) => a.knowledge_base_name.localeCompare(b.knowledge_base_name))
    );
    return next;
  }, [knowledgeBases]);

  /** 按名称命中的知识库（列表只搜库；库内内容搜索在右侧文件面板） */
  const visibleKbIds = useMemo(() => {
    if (!normalizedSearch) return null;

    const lookup = new Map(
      knowledgeBases.map((kb) => [kb.knowledge_base_id, kb])
    );
    const next = new Set<string>();
    const addWithAncestors = (kbId: string) => {
      let cursor: string | null = kbId;
      while (cursor) {
        next.add(cursor);
        cursor = lookup.get(cursor)?.parent_knowledge_base_id ?? null;
      }
    };

    knowledgeBases.forEach((kb) => {
      if (
        `${kb.knowledge_base_name} ${kb.description ?? ""}`
          .toLowerCase()
          .includes(normalizedSearch)
      ) {
        addWithAncestors(kb.knowledge_base_id);
      }
    });

    return next;
  }, [knowledgeBases, normalizedSearch]);

  const renderKb = (kb: KnowledgeBaseNode, depth: number) => {
    if (visibleKbIds && !visibleKbIds.has(kb.knowledge_base_id)) {
      return null;
    }

    const childKbs = kbChildrenByParent.get(kb.knowledge_base_id) ?? [];
    const isSelected = kb.knowledge_base_id === selectedKbId;
    // 问答锁定在该库、且没有进一步锁定到某个文件夹时，整库才是问答目标
    const isChatTarget = kb.knowledge_base_id === chatKbId && !chatFolderId;

    return (
      <div key={kb.knowledge_base_id}>
        <div
          className={cn(
            "group flex h-8 items-center gap-2 rounded-md px-2 text-sm transition-colors",
            // 主色底＝问答目标，灰底＝当前浏览位置，两者可以不是同一个库
            isChatTarget
              ? "bg-primary/10 text-foreground"
              : isSelected
                ? "bg-gray-100 text-foreground"
                : "text-foreground/80 hover:bg-gray-100"
          )}
          style={{ paddingLeft: indentOf(depth) }}
        >
          <button
            type="button"
            onClick={() => onSelectKb(kb.knowledge_base_id)}
            className="flex min-w-0 flex-1 items-center gap-2"
            title={kb.knowledge_base_name}
          >
            {childKbs.length > 0 ? (
              <ChevronRight
                className="h-3.5 w-3.5 shrink-0 text-muted-faint"
                aria-hidden="true"
              />
            ) : null}
            <Database
              className={cn(
                "h-4 w-4 shrink-0",
                isChatTarget ? "text-primary" : "text-muted-faint"
              )}
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-left",
                (isChatTarget || isSelected) && "font-medium"
              )}
            >
              {kb.knowledge_base_name}
            </span>
          </button>

          {/* 窄面板里只留数字徽标，把宽度让给知识库名；问答目标行常驻按钮，徽标让位 */}
          {kb.fileCount > 0 && !isChatTarget ? (
            <span
              className="shrink-0 text-[11px] text-muted-subtle group-hover:hidden"
              title={`${kb.fileCount} 个文件`}
            >
              {kb.fileCount}
            </span>
          ) : null}

          <div
            className={cn(
              "shrink-0 items-center gap-0.5",
              isChatTarget ? "flex" : "hidden group-hover:flex"
            )}
          >
            {kb.visibility === "team" && kb.team_id && onManageTeamMembers ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onManageTeamMembers(kb);
                }}
                className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-foreground"
                title="成员管理（邀请 / 移除成员）"
                aria-label={`成员管理 ${kb.knowledge_base_name}`}
              >
                <Users className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {onDeleteKb ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteKb(kb);
                }}
                className="flex h-6 w-6 items-center justify-center rounded text-muted hover:text-red-300"
                title="删除知识库"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>

        {/* 历史子知识库常驻展示（数量少、无目录内容），不再做展开/折叠 */}
        {childKbs.map((child) => renderKb(child, depth + 1))}
      </div>
    );
  };

  const rootKbs = kbChildrenByParent.get(null) ?? [];
  const visibleRootKbs = rootKbs.filter(
    (kb) => !visibleKbIds || visibleKbIds.has(kb.knowledge_base_id)
  );

  // 三分区：个人 / 共享 / 订阅——栏目恒驻（空分区显示计数 0），
  // 给用户稳定的分类心智；搜索态下分区全部参与过滤。
  const kbSections = [
    {
      key: "private" as const,
      label: "个人",
      icon: User,
      kbs: visibleRootKbs.filter(
        (kb) => (kb.visibility ?? "private") === "private"
      ),
    },
    {
      key: "team" as const,
      label: "共享",
      icon: Users,
      kbs: visibleRootKbs.filter((kb) => kb.visibility === "team"),
    },
    {
      key: "public" as const,
      label: "订阅",
      icon: Globe,
      kbs: visibleRootKbs.filter((kb) => kb.visibility === "public"),
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* h-12 与右侧文件区信息区第一行同几何：标题文字同水平线、
          折叠按钮与折叠态展开按钮完全同位（视觉不动） */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-gray-200 px-3">
        {/* 收起按钮放最左：与右侧信息区的展开按钮同形（h-7 w-7）同位，
            切换时原地只翻图标方向 */}
        {onCollapse ? (
          <button
            type="button"
            onClick={onCollapse}
            aria-expanded
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-gray-100 hover:text-foreground"
            title="收起知识库列表"
            aria-label="收起知识库列表"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center text-sm font-medium text-foreground">
          <span className="truncate">知识库</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setSearchOpen(!searchOpen);
              if (searchOpen && onSearchChange) onSearchChange("");
            }}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-gray-100 hover:text-foreground",
              searchOpen && "bg-gray-100 text-foreground"
            )}
            title="搜索知识库"
            aria-label="搜索"
          >
            <Search className="h-4 w-4" />
          </button>
          {onCreateKb ? (
            <button
              type="button"
              onClick={onCreateKb}
              className="flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[11px] text-white transition-transform hover:-translate-y-0.5"
            >
              <Plus className="h-3 w-3" />
              新建
            </button>
          ) : null}
        </div>
      </div>

      {searchOpen ? (
        <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
          <input
            autoFocus
            value={searchTerm}
            onChange={(e) => onSearchChange?.(e.target.value)}
            placeholder="搜索知识库名称..."
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-subtle"
          />
          {searchTerm ? (
            <button
              type="button"
              onClick={() => onSearchChange?.("")}
              className="flex h-4 w-4 items-center justify-center rounded text-muted hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto overflow-x-hidden py-1">
        {kbSections.map((section) => {
          const collapsed = !normalizedSearch && collapsedSections[section.key];
          return (
            <div key={section.key} className="mb-0.5">
              <button
                type="button"
                onClick={() =>
                  setCollapsedSections((current) => ({
                    ...current,
                    [section.key]: !current[section.key],
                  }))
                }
                aria-expanded={!collapsed}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-gray-50 hover:text-foreground"
              >
                {collapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <section.icon className="h-3.5 w-3.5" aria-hidden="true" />
                {section.label}
                <span className="text-muted-subtle">
                  {section.kbs.length}
                </span>
              </button>
              {!collapsed ? section.kbs.map((kb) => renderKb(kb, 0)) : null}
            </div>
          );
        })}

        {visibleRootKbs.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-subtle">
            {rootKbs.length === 0 ? "还没有知识库，点右上角新建" : "没有匹配的知识库"}
          </div>
        ) : null}
      </div>
    </div>
  );
};
