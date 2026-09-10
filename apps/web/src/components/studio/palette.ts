/** 门窗颜色方案：色名 → 主色。用于画布着色与右侧「颜色」选项卡。 */
export const FRAME_COLOR_OPTIONS: { name: string; hex: string; desc: string }[] = [
  { name: '咖啡色', hex: '#6B4A2B', desc: '经典咖啡木纹' },
  { name: '香槟色', hex: '#C9A96A', desc: '香槟金' },
  { name: '银灰色', hex: '#AEB6BF', desc: '金属银灰' },
  { name: '深空灰', hex: '#4A4A52', desc: '深邃灰' },
  { name: '白色', hex: '#F2F2F0', desc: '纯白' },
];

export const COLOR_HEX: Record<string, string> = Object.fromEntries(
  FRAME_COLOR_OPTIONS.map((c) => [c.name, c.hex]),
);

/** 色名 → 十六进制；未知返回中性灰。 */
export function colorHex(name: string): string {
  return COLOR_HEX[name] ?? '#8a8a8a';
}

/** 十六进制色 + 透明度 → rgba 字符串（Konva 可用）。 */
export function rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 两种颜色按权重混合（t∈[0,1]，t=0 取 a，t=1 取 b） */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255;
  const ag = (pa >> 8) & 255;
  const ab = pa & 255;
  const br = (pb >> 16) & 255;
  const bg = (pb >> 8) & 255;
  const bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}