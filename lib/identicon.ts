/**
 * 现代 Initials 品牌渐变字符徽章生成系统
 *
 * 核心特性：
 * 1. 深度适配网站纯白/浅灰（#FFFFFF / #F9FAFB）与翡翠绿（#00B36B）的主题调性
 * 2. 依据用户昵称/用户名提取首字符（支持中文汉字与英文字母大写），未设置时根据 userId 自动推导
 * 3. 基于 userId 确定性哈希计算专属翡翠/青绿品牌微渐变背景，辨识度高、千人千面、同一用户永久一致
 */

// 32-bit FNV-1a 哈希算法
function hashString(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getHashBytes(str: string): number[] {
  const bytes: number[] = [];
  const baseHash = hashString(str);
  for (let i = 0; i < 8; i++) {
    const seed = `${str}:${i}:${baseHash}`;
    const h = hashString(seed);
    bytes.push((h >>> 24) & 0xff);
    bytes.push((h >>> 16) & 0xff);
    bytes.push((h >>> 8) & 0xff);
    bytes.push(h & 0xff);
  }
  return bytes;
}

// 契合网站翡翠主色调的品牌渐变调色板（纯白文字高对比度）
const BRAND_GRADIENT_PALETTES = [
  // 1. 经典翡翠 (与品牌 Logo "J" 完全统一)
  { from: "#00B36B", to: "#00D980", glow: "rgba(0, 179, 107, 0.25)" },
  // 2. 清新薄荷绿
  { from: "#059669", to: "#34D399", glow: "rgba(5, 150, 105, 0.25)" },
  // 3. 碧海翠青
  { from: "#0284C7", to: "#00B36B", glow: "rgba(2, 132, 199, 0.25)" },
  // 4. 幽谷青翠
  { from: "#047857", to: "#10B981", glow: "rgba(4, 120, 87, 0.25)" },
  // 5. 琥珀青金
  { from: "#D97706", to: "#059669", glow: "rgba(217, 119, 6, 0.25)" },
  // 6. 靛蓝翡翠
  { from: "#6366F1", to: "#00B36B", glow: "rgba(99, 102, 241, 0.25)" },
];

export interface InitialAvatarData {
  char: string;
  gradient: {
    from: string;
    to: string;
    glow: string;
  };
}

/**
 * 提取展示字符（支持中文字符、英文首字母、数字）
 */
function extractDisplayChar(name?: string | null, userId?: string | null): string {
  const trimmedName = name?.trim();
  if (trimmedName && trimmedName.length > 0) {
    // 优先取名字的首个字符（若是英文转大写）
    const firstChar = trimmedName[0];
    return /[a-zA-Z]/.test(firstChar) ? firstChar.toUpperCase() : firstChar;
  }

  const rawId = userId?.trim() || "";
  if (rawId) {
    // user_ 前缀的旧格式用户 ID，去掉前缀取特征字母
    const cleaned = rawId.replace(/^(user|sub|account)_?/i, "").trim();
    if (cleaned.length > 0) {
      const c = cleaned[0];
      return /[a-zA-Z]/.test(c) ? c.toUpperCase() : c;
    }
  }

  // 默认使用系统首字母 "J"
  return "J";
}

/**
 * 根据用户 ID 与昵称生成确定性 Initials 品牌渐变徽章数据
 */
export function generateInitialData(
  userId?: string | null,
  name?: string | null
): InitialAvatarData {
  const rawId = userId?.trim() || "default_user";
  const bytes = getHashBytes(rawId);
  const paletteIndex = bytes[0] % BRAND_GRADIENT_PALETTES.length;
  const gradient = BRAND_GRADIENT_PALETTES[paletteIndex];
  const char = extractDisplayChar(name, rawId);

  return {
    char,
    gradient,
  };
}
