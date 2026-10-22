import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#00B36B",
          light: "#00D980",
          // 同色相（155.9°）的压暗版本：DEFAULT 对白底只有 2.74:1，
          // 用在 11–12px 小字和 7px 图形上远低于 4.5:1 / 3:1 门槛。
          // deep 对白底 5.41:1，供小字与小图形使用；DEFAULT 留给按钮等大色块。
          deep: "#007A49",
        },
        dark: {
          DEFAULT: "#FFFFFF",
          card: "#F5F5F5",
          border: "#E5E7EB",
        },
        foreground: "#1A1A1A",
        // 文字层级按对比度门槛分档。不要再用 muted/NN 透明度派生——透明度修饰符
        // 曾让 /40 ~ /70（1.7:1 ~ 2.8:1）在无人核对的情况下扩散到 17 处。
        //   muted        7.56:1  二级文字
        //   muted-subtle 4.83:1  三级文字（正文 4.5:1 的下限）
        //   muted-faint  3.68:1  仅非文字图形（3:1 的下限），不可承载文字
        muted: {
          DEFAULT: "#4B5563",
          subtle: "#6B7280",
          // 绿调中性：色相对齐 primary 的 156°（原先是 #818793，220° 的冷蓝灰，
          // 挨着主色时像是从另一套配色里借来的）。饱和度压到 8%，仍是"灰"，
          // 只是这灰属于这套配色。对比度 3.68:1，比换之前的 3.61:1 略高。
          faint: "#758A82",
        },
        // 轨道竖线、发丝分隔线专用的绿调浅中性，同样对齐 156°。
        // 纯装饰、不承载信息，所以不受 3:1 约束；独立成 token 是为了不去动
        // 全项目 86 处引用的 gray-200。
        hairline: "#DFE7E4",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Hiragino Sans GB",
          "Microsoft YaHei",
          "sans-serif",
        ],
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(40px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        slideInRight: {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        fadeIn: "fadeIn 0.3s ease-out",
        slideUp: "slideUp 0.3s ease-out",
        slideIn: "slideIn 0.3s ease-out",
        slideInRight: "slideInRight 0.25s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
