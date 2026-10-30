/** 可用 PDF.js 预览的后缀：原生 PDF + Office（转 PDF 后 bbox 对齐） */
const PDF_PREVIEWABLE_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
]);

/**
 * 判断文件是否应按 PDF 视图渲染（react-pdf + bbox 高亮）。
 *
 * Word/PPT 后端会在 /raw 默认返回转换后 PDF；若尚未转换完成，
 * DocumentView 仍进入 PDF 视图，由加载失败态提示。
 */
export function isPdfPreviewableFile(file: {
  file_name?: string | null;
  mime_type?: string | null;
  render_as?: string | null;
  preview_mime_type?: string | null;
}): boolean {
  if (file.render_as === "pdf") return true;
  if (file.preview_mime_type?.includes("pdf")) return true;
  if (file.mime_type?.includes("pdf")) return true;

  const name = (file.file_name || "").toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() || "" : "";
  return PDF_PREVIEWABLE_EXTENSIONS.has(ext);
}
