"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import * as Icons from "lucide-react";
import { MountedSource } from "@/lib/types";
import {
  fetchFolderFiles,
  fetchFolders,
  fetchKnowledgeBases,
  fetchRootFiles,
} from "@/lib/api/knowledge";
import { KnowledgeBaseInfo, KnowledgeFile } from "@/lib/knowledge-types";

interface MountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (sources: MountedSource[]) => void;
}

export const MountModal = ({ isOpen, onClose, onConfirm }: MountModalProps) => {
  const [activeTab, setActiveTab] = useState<"knowledge" | "files">("knowledge");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseInfo[]>([]);
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const loadData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const { knowledgeBases: nextKnowledgeBases } =
          await fetchKnowledgeBases();
        setKnowledgeBases(nextKnowledgeBases);

        const foldersByKb = await Promise.all(
          nextKnowledgeBases.map((kb) => fetchFolders(kb.knowledge_base_id))
        );
        const allFolders = foldersByKb.flat();
        const [rootFilesByKb, filesByFolder] = await Promise.all([
          Promise.all(
            nextKnowledgeBases.map((kb) => fetchRootFiles(kb.knowledge_base_id))
          ),
          Promise.all(
            allFolders.map((folder) => fetchFolderFiles(folder.folder_id))
          ),
        ]);

        setFiles(
          [...rootFilesByKb.flat(), ...filesByFolder.flat()].map((file) => ({
            ...file,
            index_status: file.index_status ?? "pending",
            progress: file.progress ?? 0,
          }))
        );
      } catch (loadError) {
        setKnowledgeBases([]);
        setFiles([]);
        setError(
          loadError instanceof Error
            ? `加载挂载数据失败：${loadError.message}`
            : "加载挂载数据失败"
        );
      } finally {
        setIsLoading(false);
      }
    };

    setSelectedItems(new Set());
    void loadData();
  }, [isOpen]);

  const handleToggle = (id: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  const handleConfirm = () => {
    const sources: MountedSource[] = [];

    if (activeTab === "knowledge") {
      knowledgeBases
        .filter((kb) => selectedItems.has(kb.knowledge_base_id))
        .forEach((kb) => {
          sources.push({
            name: kb.knowledge_base_name,
            type: "kb",
            icon: "Library",
          });
        });
    } else {
      files
        .filter((file) => selectedItems.has(file.file_id))
        .forEach((file) => {
          sources.push({
            name: file.file_name,
            type: "file",
            icon: "FileText",
          });
        });
    }

    onConfirm(sources);
    setSelectedItems(new Set());
    onClose();
  };

  if (!isOpen) return null;

  const items = activeTab === "knowledge" ? knowledgeBases : files;

  return (
    <>
      <div
        className="fixed inset-0 z-[2000] animate-fadeIn bg-black/70"
        onClick={onClose}
      />

      <div className="fixed left-1/2 top-1/2 z-[2001] flex max-h-[80vh] w-[90%] max-w-[700px] -translate-x-1/2 -translate-y-1/2 animate-slideUp flex-col rounded-2xl bg-dark-card shadow-2xl">
        <div className="border-b border-dark-border p-6">
          <h2 className="mb-4 text-lg text-foreground">挂载知识库/文件</h2>
          <div className="flex gap-6">
            <button
              onClick={() => {
                setActiveTab("knowledge");
                setSelectedItems(new Set());
              }}
              className={cn(
                "border-b-2 pb-2 text-sm transition-colors",
                activeTab === "knowledge"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted hover:text-foreground"
              )}
            >
              我的知识库
            </button>
            <button
              onClick={() => {
                setActiveTab("files");
                setSelectedItems(new Set());
              }}
              className={cn(
                "border-b-2 pb-2 text-sm transition-colors",
                activeTab === "files"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted hover:text-foreground"
              )}
            >
              工作空间文件
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="py-10 text-center text-sm text-muted">正在加载...</div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted">
              当前没有可挂载的数据
            </div>
          ) : (
            items.map((item) => {
              const IconComponent = Icons.FileText;
              const itemId =
                ("knowledge_base_id" in item
                  ? item.knowledge_base_id
                  : item.file_id) ?? "";
              const isSelected = selectedItems.has(itemId);

              return (
                <button
                  key={itemId}
                  onClick={() => handleToggle(itemId)}
                  className="mb-2 flex w-full items-center gap-3 rounded-lg p-3 transition-all hover:bg-primary/5"
                >
                  <div
                    className={cn(
                      "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border-2 transition-all",
                      isSelected
                        ? "border-primary bg-primary"
                        : "border-muted-subtle"
                    )}
                  >
                    {isSelected && (
                      <span className="text-xs text-white">✓</span>
                    )}
                  </div>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <IconComponent className="h-4.5 w-4.5 text-foreground" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm text-foreground">
                      {"knowledge_base_name" in item
                        ? item.knowledge_base_name
                        : item.file_name}
                    </div>
                    <div className="text-xs text-muted">
                      {"knowledge_base_name" in item
                        ? `知识库类型: ${item.knowledge_type || "common_file"}`
                        : `${item.mime_type || "未知类型"}`}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-dark-border p-5">
          <span className="text-xs text-muted">
            已选择 {selectedItems.size} 项
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="rounded-lg px-6 py-2 text-sm text-muted transition-all hover:bg-dark hover:text-foreground"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedItems.size === 0 || isLoading || Boolean(error)}
              className="rounded-lg bg-primary px-6 py-2 text-sm text-white transition-all hover:bg-primary-light disabled:cursor-not-allowed disabled:bg-dark-border disabled:text-muted"
            >
              确认挂载
            </button>
          </div>
        </div>
      </div>
    </>
  );
};
