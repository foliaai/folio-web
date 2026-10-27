#!/usr/bin/env node
/**
 * 拷贝 mermaid UMD 单文件到 public/vendor/（运行时 script 标签加载，不进 bundler）。
 *
 * 背景：mermaid 直接 import 进 bundler 会让 Next（Turbopack）构建内存峰值暴涨，
 * CI runner OOM（进程被 Killed）。public 下的静态文件不参与打包，浏览器运行时
 * 从自身域名加载 /vendor/mermaid.min.js，内网部署不依赖外部 CDN。
 *
 * 挂在 postinstall：npm install 后自动就位，dev/build 均覆盖。
 */

import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules", "mermaid", "dist", "mermaid.min.js");
const outDir = join(root, "public", "vendor");
const out = join(outDir, "mermaid.min.js");

if (!existsSync(src)) {
  console.error("[copy-mermaid] 源文件不存在（先 npm install）:", src);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
copyFileSync(src, out);
console.log("[copy-mermaid] OK:", out);
