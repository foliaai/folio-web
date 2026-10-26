"use client";

import { File } from "lucide-react";

const ICON_DIR = "/file-icons";

const customIconMap: Record<string, string> = {
  pdf: `${ICON_DIR}/pdf.png`,
  doc: `${ICON_DIR}/word.png`,
  docx: `${ICON_DIR}/word.png`,
  xls: `${ICON_DIR}/excel.png`,
  xlsx: `${ICON_DIR}/excel.png`,
  csv: `${ICON_DIR}/excel.png`,
  md: `${ICON_DIR}/md.png`,
  markdown: `${ICON_DIR}/md.png`,
  html: `${ICON_DIR}/html.png`,
  htm: `${ICON_DIR}/html.png`,
  txt: `${ICON_DIR}/txt.png`,
  png: `${ICON_DIR}/image.png`,
  jpg: `${ICON_DIR}/image.png`,
  jpeg: `${ICON_DIR}/image.png`,
  gif: `${ICON_DIR}/image.png`,
  webp: `${ICON_DIR}/image.png`,
  svg: `${ICON_DIR}/image.png`,
  ppt: `${ICON_DIR}/ppt.png`,
  pptx: `${ICON_DIR}/ppt.png`,
  zip: `${ICON_DIR}/zip.png`,
  rar: `${ICON_DIR}/zip.png`,
  json: `${ICON_DIR}/json.png`,
};

export const FileIcon = ({ fileName, className = "h-5 w-5 shrink-0" }: { fileName: string; className?: string }) => {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const iconPath = customIconMap[ext];

  if (iconPath) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconPath}
        alt={ext}
        className={className}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
          e.currentTarget.nextElementSibling?.classList.remove("hidden");
        }}
      />
    );
  }

  return <File className={`${className} text-gray-400`} />;
};
