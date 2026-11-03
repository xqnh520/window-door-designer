/**
 * 门窗外框几何（纯函数，无 Konva/React 依赖）：
 * 所有形状的轮廓统一为「闭合采样多边形」（弧段折线逼近），
 * 渲染 / 分割 / 下料 / 吸附四端共用同一份几何，保证长度与视觉一致。
 *
 * 形状体系：
 * - 既四形状 rect / trapezoid / arch / gothic 直接在真实 box 上生成（实现保持不变）；
 * - 其余实测形状走「单位轮廓 → 朝向/镜像 → 角部圆角 → 仿射映射到 box」通路；
 * - 凸形全部收录；凹形收录实测点序明确的三种（lShape 倒L / notchTop 顶凹口 / earsTop 双耳T形）。
 *   轴切割 `clipByAxis` 用「交点配对 + 边界链」而非 Sutherland–Hodgman，故凹形同样正确；
 *   与切割线重合的退化位置（如凹口对称轴）返回 null，由上层按「此处不能分割」拒绝，不产出自交轮廓。
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 外框形状联合（后缀 = 特征朝向/镜像，对齐 windoorcraft 的 frame_* 变体命名） */
export type FrameShape =
  | 'rect'
  | 'roundedRect'
  | 'trapezoid'
  | 'trapezoidRight'
  | 'trapezoidDown'
  | 'trapezoidLeft'
  | 'parallelogram'
  | 'lShape'
  | 'notchTop'
  | 'earsTop'
  | 'arch'
  | 'gothic'
  | 'peakPentagon'
  | 'angledPentagon'
  | 'halfCircle'
  | 'quarterCircle'
  | 'quarterCircleLeft'
  | 'triangle'
  | 'rightTriangle'
  | 'rightTriangleLeft'
  | 'diamond'
  | 'hexagon'
  | 'hexagonTop'
  | 'octagon'
  | 'circle';

/** 形状清单（UI 与 schema 防漂移的唯一来源） */
export const FRAME_SHAPE_IDS: readonly FrameShape[] = [
  'rect', 'roundedRect', 'trapezoid', 'trapezoidRight', 'trapezoidDown', 'trapezoidLeft', 'parallelogram',
  'lShape', 'notchTop', 'earsTop',
  'arch', 'gothic', 'peakPentagon', 'angledPentagon', 'halfCircle', 'quarterCircle', 'quarterCircleLeft',
  'triangle', 'rightTriangle', 'rightTriangleLeft', 'diamond', 'hexagon', 'hexagonTop', 'octagon', 'circle',
];

/** 形状中文名（对齐 windoorcraft「框」面板标签；变体后缀=特征朝向） */
export const FRAME_SHAPE_LABEL: Record<FrameShape, string> = {
  rect: '矩形',
  roundedRect: '圆角矩形',
  trapezoid: '梯形',
  trapezoidRight: '梯形·窄边右',
  trapezoidDown: '倒梯形',
  trapezoidLeft: '梯形·窄边左',
  parallelogram: '平行四边形',
  lShape: '倒L形单耳窗',
  notchTop: '顶部凹口窗',
  earsTop: '双耳窗',
  arch: '弧形',
  gothic: '尖拱',
  peakPentagon: '三角顶',
  angledPentagon: '斜角五边形',
  halfCircle: '半圆',
  quarterCircle: '四分之一圆',
  quarterCircleLeft: '四分之一圆·镜像',
  triangle: '等腰三角形',
  rightTriangle: '直角三角形',
  rightTriangleLeft: '直角三角形·镜像',
  diamond: '菱形',
  hexagon: '六边形',
  hexagonTop: '顶部圆角矩形',
  octagon: '八边形',
  circle: '圆',
};

/** 形状分组（顺序即 FRAME_SHAPE_IDS 的分组）；摊平后必须与 FRAME_SHAPE_IDS 完全一致 */
export const FRAME_SHAPE_GROUPS: { label: string; value: readonly FrameShape[] }[] = [
  { label: '直边类', value: ['rect', 'roundedRect', 'trapezoid', 'trapezoidRight', 'trapezoidDown', 'trapezoidLeft', 'parallelogram'] },
  { label: '凹形', value: ['lShape', 'notchTop', 'earsTop'] },
  { label: '拱形类', value: ['arch', 'gothic', 'peakPentagon', 'angledPentagon', 'halfCircle', 'quarterCircle', 'quarterCircleLeft'] },
  { label: '多边形 · 圆', value: ['triangle', 'rightTriangle', 'rightTriangleLeft', 'diamond', 'hexagon', 'hexagonTop', 'octagon', 'circle'] },
];

/** 需要窄边比（topRatio）输入的形状 */
export const TRAPEZOID_SHAPES: readonly FrameShape[] = ['trapezoid', 'trapezoidRight', 'trapezoidDown', 'trapezoidLeft'];

/** 特征朝向：梯形窄边、四分之一圆弧顶落在哪一侧 */
export type FrameOrient = 'up' | 'right' | 'down' | 'left';

export const DEFAULT_TOP_RATIO = 0.6;

export const dist = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y);

export const bBoxOf = (pts: Pt[]): Box => {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

export function rectCorners(b: Box): Pt[] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
}

/** 等腰梯形角点：顶边以 topRatio 缩窄居中，底边保持全宽 */
export function trapezoidCorners(b: Box, topRatio = DEFAULT_TOP_RATIO): Pt[] {
  const tw = b.w * topRatio;
  const tlx = b.x + (b.w - tw) / 2;
  return [
    { x: tlx, y: b.y },
    { x: tlx + tw, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
}

/** 单位轮廓的基础形状 */
type BaseShape =
  | 'roundedRect'
  | 'trapezoid'
  | 'lShape'
  | 'notchTop'
  | 'earsTop'
  | 'circle'
  | 'halfCircle'
  | 'quarterCircle'
  | 'octagon'
  | 'hexagon'
  | 'diamond'
  | 'triangle'
  | 'rightTriangle'
  | 'angledPentagon'
  | 'peakPentagon'
  | 'parallelogram';

interface ShapeSpec {
  base: BaseShape;
  /** 角部圆角比例（实测 ctx.arc 半径 ÷ 包围盒） */
  cornerRatio?: number;
  /** 只圆角指定顶点索引；省略=全部顶点 */
  cornerOnly?: number[];
  /** 水平镜像（特征朝左） */
  mirror?: boolean;
  orient?: FrameOrient;
}

/** 变体 id → 单位轮廓配方（角部圆角比例取实测 ctx.arc 半径 ÷ 包围盒） */
const SHAPE_SPECS: Partial<Record<FrameShape, ShapeSpec>> = {
  roundedRect: { base: 'roundedRect', cornerRatio: 0.2 },
  hexagonTop: { base: 'roundedRect', cornerRatio: 0.25, cornerOnly: [0, 1] },
  rightTriangle: { base: 'rightTriangle', cornerRatio: 0.1, cornerOnly: [1] },
  rightTriangleLeft: { base: 'rightTriangle', cornerRatio: 0.1, cornerOnly: [1], mirror: true },
  angledPentagon: { base: 'angledPentagon' },
  lShape: { base: 'lShape' },
  notchTop: { base: 'notchTop' },
  earsTop: { base: 'earsTop' },
  trapezoidRight: { base: 'trapezoid', orient: 'right' },
  trapezoidDown: { base: 'trapezoid', orient: 'down' },
  trapezoidLeft: { base: 'trapezoid', orient: 'left' },
  circle: { base: 'circle' },
  halfCircle: { base: 'halfCircle' },
  quarterCircle: { base: 'quarterCircle' },
  quarterCircleLeft: { base: 'quarterCircle', mirror: true },
  octagon: { base: 'octagon', cornerRatio: 0.092 },
  hexagon: { base: 'hexagon', cornerRatio: 0.071 },
  diamond: { base: 'diamond', cornerRatio: 0.081 },
  triangle: { base: 'triangle', cornerRatio: 0.1 },
  peakPentagon: { base: 'peakPentagon' },
  parallelogram: { base: 'parallelogram' },
};

const ARC_SEG = 360;

/** 单位正方形（0..1，y 轴向下）内的基础轮廓；弧形按 360 段折线逼近 */
function unitBase(base: BaseShape, topRatio: number): Pt[] {
  const arc = (cx: number, cy: number, from: number, to: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i <= ARC_SEG; i++) {
      const t = ((from + ((to - from) * i) / ARC_SEG) * Math.PI) / 180;
      out.push({ x: cx + 0.5 * Math.cos(t), y: cy + 0.5 * Math.sin(t) });
    }
    return out;
  };
  switch (base) {
    case 'roundedRect':
      return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    case 'trapezoid': {
      const k = Math.min(0.95, Math.max(0.05, topRatio));
      return [
        { x: (1 - k) / 2, y: 0 },
        { x: (1 + k) / 2, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
    }
    case 'lShape':
      // 实测 frame_ear2：主矩形 0..1 × 0..0.688 + 右下凸出块（凹角在 0.64,0.688）
      return [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.688 }, { x: 0.64, y: 0.688 }, { x: 0.64, y: 1 }, { x: 0, y: 1 },
      ];
    case 'notchTop':
      // 实测 frame_hollow2：左/右/底完整，顶部分两段并各下探到 y=0.4 → 顶部中央凹口
      return [
        { x: 0, y: 0 }, { x: 0.367, y: 0 }, { x: 0.367, y: 0.4 }, { x: 0.633, y: 0.4 },
        { x: 0.633, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
      ];
    case 'earsTop':
      // 实测 frame_double_ears2：上部通宽到 y=0.5、下部窄柱 x 0.352..0.667 → 主体 + 左右两耳
      return [
        { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 0.667, y: 0.5 },
        { x: 0.667, y: 1 }, { x: 0.352, y: 1 }, { x: 0.352, y: 0.5 }, { x: 0, y: 0.5 },
      ];
    case 'circle':
      return arc(0.5, 0.5, 0, 360);
    case 'halfCircle':
      // 上半圆 + implicit 平底槛（首尾点连成直径）
      return arc(0.5, 0.5, 180, 360);
    case 'quarterCircle': {
      // 直角在左下，弧顶在右上：圆心 (0,1)、半径 1
      const pts: Pt[] = [{ x: 0, y: 1 }, { x: 0, y: 0 }];
      for (let i = 1; i <= ARC_SEG; i++) {
        const t = ((-90 + (90 * i) / ARC_SEG) * Math.PI) / 180;
        pts.push({ x: Math.cos(t), y: 1 + Math.sin(t) });
      }
      return pts;
    }
    case 'octagon':
      return [
        { x: 0.343, y: 0.12 }, { x: 0.657, y: 0.12 }, { x: 0.879, y: 0.343 }, { x: 0.879, y: 0.657 },
        { x: 0.657, y: 0.879 }, { x: 0.343, y: 0.879 }, { x: 0.12, y: 0.657 }, { x: 0.12, y: 0.343 },
      ];
    case 'hexagon':
      return [
        { x: 0.286, y: 0.081 }, { x: 0.714, y: 0.081 }, { x: 1, y: 0.5 },
        { x: 0.714, y: 0.919 }, { x: 0.286, y: 0.919 }, { x: 0, y: 0.5 },
      ];
    case 'diamond':
      return [{ x: 0.5, y: 0 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }];
    case 'triangle':
      return [{ x: 0.5, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    case 'rightTriangle':
      // 实测 frame_triangle 玻璃 (0.131,0.175)(0.131,0.869)(0.825,0.869) 归一化
      return [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
    case 'angledPentagon':
      // 实测 frame_angled_pentagon 玻璃 5 点归一化（左上角被一条斜边切掉）
      return [
        { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0.535, y: 0 }, { x: 0, y: 0.308 },
      ];
    case 'peakPentagon':
      return [{ x: 0.5, y: 0 }, { x: 1, y: 0.45 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0.45 }];
    case 'parallelogram':
      return [{ x: 0.25, y: 0 }, { x: 1, y: 0 }, { x: 0.75, y: 1 }, { x: 0, y: 1 }];
    default:
      return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  }
}

/** 归一化到充满单位正方形（实测点常留有内缩余量） */
function fitUnit(pts: Pt[]): Pt[] {
  const b = bBoxOf(pts);
  return pts.map((p) => ({ x: (p.x - b.x) / b.w, y: (p.y - b.y) / b.h }));
}

/** 绕中心旋转到目标朝向（base 的特征朝上） */
function rotateUnit(pts: Pt[], dir: FrameOrient): Pt[] {
  if (dir === 'up') return pts;
  if (dir === 'down') return pts.map((p) => ({ x: 1 - p.x, y: 1 - p.y }));
  if (dir === 'right') return pts.map((p) => ({ x: 1 - p.y, y: p.x }));
  return pts.map((p) => ({ x: p.y, y: 1 - p.x }));
}

/** 实测形状都不是尖角：每个顶点用二次贝塞尔（控制点=原顶点）做圆角过渡 */
function roundUnitCorners(pts: Pt[], ratio: number, only?: number[], samples = 3): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const dp = dist(prev, cur);
    const dn = dist(next, cur);
    const d = only && !only.includes(i) ? 0 : Math.min(ratio, dp / 2, dn / 2);
    if (d <= 1e-6) {
      out.push(cur);
      continue;
    }
    const p1 = { x: cur.x + ((prev.x - cur.x) / dp) * d, y: cur.y + ((prev.y - cur.y) / dp) * d };
    const p2 = { x: cur.x + ((next.x - cur.x) / dn) * d, y: cur.y + ((next.y - cur.y) / dn) * d };
    out.push(p1, ...quadSample(p1, cur, p2, samples));
  }
  return out;
}

function unitToBox(pts: Pt[], b: Box): Pt[] {
  return pts.map((p) => ({ x: b.x + p.x * b.w, y: b.y + p.y * b.h }));
}

/** 二次贝塞尔采样 */
function quadSample(p0: Pt, p1: Pt, p2: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const it = 1 - t;
    out.push({
      x: it * it * p0.x + 2 * it * t * p1.x + t * t * p2.x,
      y: it * it * p0.y + 2 * it * t * p1.y + t * t * p2.y,
    });
  }
  return out;
}

/**
 * 门窗外框轮廓采样：返回闭合多边形（世界 mm）。
 * inset=0 为外框外轮廓；inset=frameWidth 为内腔轮廓（玻璃区）。
 * rect/trapezoid/arch/gothic 取真实 box 上的角点或对弧线采样；其余形状（circle / halfCircle /
 * quarterCircle(+Left) / octagon / hexagon / diamond / triangle / peakPentagon / parallelogram /
 * trapezoidRight|Down|Left）走单位轮廓 + 朝向变换，`topRatio` 对梯形族意为「窄边 ÷ 长边」。
 */
export function sampleOutline(shape: FrameShape, box: Box, instr: { inset?: number; topRatio?: number }): Pt[] {
  const topRatio = instr.topRatio ?? DEFAULT_TOP_RATIO;
  let pts: Pt[];
  const spec = SHAPE_SPECS[shape];
  if (spec) {
    let u = fitUnit(unitBase(spec.base, topRatio));
    if (spec.mirror) u = u.map((p) => ({ x: 1 - p.x, y: p.y }));
    u = rotateUnit(u, spec.orient ?? 'up');
    if (spec.cornerRatio) u = roundUnitCorners(u, spec.cornerRatio, spec.cornerOnly);
    pts = unitToBox(u, box);
  } else
    switch (shape) {
      case 'rect':
        pts = rectCorners(box);
        break;
      case 'trapezoid':
        pts = trapezoidCorners(box, topRatio);
        break;
      case 'arch': {
        const b = box;
        const rx = b.w / 2;
        // 拱顶升高：半圆优先（rise=rx），外框太矮放不下时压扁成半椭圆（rise=b.h），
        // 保证拱顶恒落在框顶 b.y、底边落在 b.y+b.h，不溢出也不留空。
        const rise = Math.min(rx, b.h);
        const arcY = b.y + rise; // 起拱线
        const bl = { x: b.x, y: b.y + b.h };
        const l = { x: b.x, y: arcY };
        const rp = { x: b.x + b.w, y: arcY };
        const br = { x: b.x + b.w, y: b.y + b.h };
        const arcPts: Pt[] = [];
        const archSeg = 64;
        for (let i = 1; i < archSeg; i++) {
          const theta = Math.PI - (Math.PI * i) / archSeg;
          arcPts.push({ x: b.x + rx + rx * Math.cos(theta), y: arcY - rise * Math.sin(theta) });
        }
        pts = [bl, l, ...arcPts, rp, br];
        break;
      }
      case 'gothic': {
        const b = box;
        const bl = { x: b.x, y: b.y + b.h };
        const c1 = { x: b.x + b.w * 0.04, y: b.y + b.h * 0.45 };
        const apex = { x: b.x + b.w / 2, y: b.y };
        const c2 = { x: b.x + b.w * 0.96, y: b.y + b.h * 0.45 };
        const br = { x: b.x + b.w, y: b.y + b.h };
        pts = [bl, ...quadSample(bl, c1, apex, 32), ...quadSample(apex, c2, br, 32), br];
        break;
      }
      default:
        pts = rectCorners(box);
    }
  const dedup: Pt[] = [];
  for (const p of pts) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.001) dedup.push(p);
  }
  return instr.inset && instr.inset > 0 ? insetPolygon(dedup, instr.inset) : dedup;
}

/** 有符号面积（y 轴向下：屏幕顺时针为正） */
function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** 闭合多边形是否无自交（相邻边与公共端点不计） */
function isSimplePolygon(pts: Pt[]): boolean {
  const n = pts.length;
  const cross = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // 与首边共享端点
      const c = pts[j];
      const d = pts[(j + 1) % n];
      const d1 = cross(c, d, a);
      const d2 = cross(c, d, b);
      const d3 = cross(a, b, c);
      const d4 = cross(a, b, d);
      if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return false;
    }
  }
  return true;
}

/** 旧语义：向质心按比例内缩（等距内缩退化时兜底）；中心必须落在多边形内，否则缩放会把点甩到边界外 */
function scaleInset(pts: Pt[], inset: number): Pt[] {
  const c = regionAnchor(pts);
  return pts.map((p) => {
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d <= inset) return { ...p };
    const f = 1 - inset / d;
    return { x: c.x + (p.x - c.x) * f, y: c.y + (p.y - c.y) * f };
  });
}

/** 凸多边形（允许共线）判定 */
function isConvex(pts: Pt[]): boolean {
  const n = pts.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const c = pts[(i + 2) % n];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cr);
    else if (Math.sign(cr) !== sign) return false;
  }
  return true;
}

/** 沿边 a→b 的内侧法向平移 inset 后裁掉多余部分（凸多边形逐边裁剪 = 精确等距内缩） */
function clipHalfPlane(poly: Pt[], a: Pt, b: Pt, inset: number, s: number): Pt[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len <= 1e-9 || poly.length < 3) return poly;
  const nx = (-s * (b.y - a.y)) / len;
  const ny = (s * (b.x - a.x)) / len;
  const d = (p: Pt) => inset - ((p.x - a.x) * nx + (p.y - a.y) * ny); // >0 = 离该边不足 inset，裁掉
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const dp = d(p);
    const dq = d(q);
    if (dp <= 0) out.push(p);
    if ((dp <= 0) !== (dq <= 0) && Math.abs(dp - dq) > 1e-12) {
      const t = dp / (dp - dq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

/**
 * 等距内缩（mm）：料厚沿每条边恒等。
 * - 凸多边形（含弧/圆角采样）：逐边做内侧半平面裁剪，即所有偏移半空间的交，精确且不会自交；
 * - 凹多边形：每边沿内法向平移后重建轮廓，先按"凹角倒角 + 凸角 miter（超 4×inset 也倒角）"重建，
 *   结果无效时再按候选点重建一次（每个角取两侧偏移线交点，交点跑到原轮廓外就改用仍在轮廓内的偏移端点，
 *   两端点都不在内说明该角已被这条边吃掉，跳过）——弧链与直边之间的锐角只有第二条路径能切对；
 * - 任一候选都需仍是「同号、正面积、无自交、落在原轮廓内」的有效多边形，否则退回质心缩放
 *   （inset 超过最小特征宽度等退化情形），保证渲染/算料永远拿不到坏轮廓。
 */
export function insetPolygon(pts: Pt[], inset: number): Pt[] {
  const n = pts.length;
  if (!(inset > 0) || n < 3) return pts.map((p) => ({ ...p }));
  const s = signedArea(pts) >= 0 ? 1 : -1;
  const valid = (ring: Pt[]) => {
    const area = signedArea(ring);
    return (
      ring.length >= 3 &&
      Math.sign(area) === s &&
      Math.abs(area) > 1e-6 &&
      isSimplePolygon(ring) &&
      ring.every((p) => pointInPoly(p, pts))
    );
  };
  if (isConvex(pts)) {
    let poly = pts.map((p) => ({ ...p }));
    for (let i = 0; i < n && poly.length >= 3; i++) poly = clipHalfPlane(poly, pts[i], pts[(i + 1) % n], inset, s);
    return valid(poly) ? poly : scaleInset(pts, inset);
  }
  const edges = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= 1e-9) return null;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const nx = -s * uy * inset;
    const ny = s * ux * inset;
    return { ax: a.x + nx, ay: a.y + ny, bx: b.x + nx, by: b.y + ny, ux, uy };
  });
  const join = (strict: boolean) => {
    const ring: Pt[] = [];
    for (let i = 0; i < n; i++) {
      const prev = edges[(i - 1 + n) % n];
      const cur = edges[i];
      if (!prev || !cur) continue;
      const bevel = () => {
        for (const p of [{ x: prev.bx, y: prev.by }, { x: cur.ax, y: cur.ay }]) {
          if (!strict || pointInPoly(p, pts)) ring.push(p);
        }
      };
      const den = prev.ux * cur.uy - prev.uy * cur.ux;
      if (den * s <= 1e-9 || Math.abs(den) < 1e-9) {
        bevel();
        continue;
      }
      const t = ((cur.ax - prev.ax) * cur.uy - (cur.ay - prev.ay) * cur.ux) / den;
      const m = { x: prev.ax + prev.ux * t, y: prev.ay + prev.uy * t };
      if (!strict && Math.hypot(m.x - pts[i].x, m.y - pts[i].y) > 4 * inset) bevel();
      else if (strict && !pointInPoly(m, pts)) bevel();
      else ring.push(m);
    }
    return ring;
  };
  const loose = join(false);
  if (loose.length && valid(loose)) return loose;
  const strict = join(true);
  return valid(strict) ? strict : scaleInset(pts, inset);
}

/** 闭合折线周长（mm） */
export function polygonLen(pts: Pt[]): number {
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    len += dist(pts[i], pts[(i + 1) % pts.length]);
  }
  return len;
}

/** 闭合多边形面积（mm²，鞋带公式取绝对值） */
export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

/** 尖拱中心（用于标注外法线） */
export function gothicCentroid(b: Box): Pt {
  return { x: b.x + b.w / 2, y: b.y + b.h * 0.55 };
}

/** 半圆拱（拱形）路径：底部横边 + 顶部半圆弧（SVG 2D 标注/导出） */
export function archpath(b: Box): string {
  const rx = b.w / 2;
  const rise = Math.min(rx, b.h);
  const cy = b.y + rise;
  return `M ${b.x} ${b.y + b.h} L ${b.x} ${cy} A ${rx} ${rise} 0 0 0 ${b.x + b.w} ${cy} L ${b.x + b.w} ${b.y + b.h} Z`;
}

/** 尖拱（哥特拱）路径 */
export function gothicArchPath(b: Box): string {
  const apex = { x: b.x + b.w / 2, y: b.y };
  const bl = { x: b.x, y: b.y + b.h };
  const br = { x: b.x + b.w, y: b.y + b.h };
  const c1 = { x: b.x + b.w * 0.04, y: b.y + b.h * 0.45 };
  const c2 = { x: b.x + b.w * 0.96, y: b.y + b.h * 0.45 };
  return `M ${bl.x} ${bl.y} Q ${c1.x} ${c1.y} ${apex.x} ${apex.y} Q ${c2.x} ${c2.y} ${br.x} ${br.y} Z`;
}

/** 形状质心（外框标注/放置参考） */
export function shapeCentroid(shape: FrameShape, box: Box, topRatio?: number): Pt {
  switch (shape) {
    case 'trapezoid': {
      const c = trapezoidCorners(box, topRatio ?? DEFAULT_TOP_RATIO);
      return {
        x: (c[0].x + c[1].x + c[2].x + c[3].x) / 4,
        y: (c[0].y + c[1].y + c[2].y + c[3].y) / 4,
      };
    }
    case 'gothic':
      return gothicCentroid(box);
    default:
      return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  }
}

// ── 异形分割：按轴裁剪（凸/凹通用，见 clipSlab） ────────

function dedupPts(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const dup = out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.001);
    if (!dup) out.push(p);
  }
  return out;
}

/**
 * 按轴裁剪（凹形安全）：取「切割线之间落在带内的那段边界链」，再用切割线上的弦闭合。
 * 旧实现是 Sutherland–Hodgman，只对凸多边形正确 —— 凹形（带耳/凹口）会得到跨越缺口的
 * 「桥接」自交多边形。这里链数一旦不符合单一连通结果就返回 null，由上层按「此处不能分割」拒绝。
 * lo/hi 允许 ±Infinity 表示半平面。
 */
function clipSlab(poly: Pt[], axis: 'vertical' | 'horizontal', lo: number, hi: number): Pt[] | null {
  const c = (p: Pt) => (axis === 'vertical' ? p.x : p.y);
  const at = (fixed: number, other: number): Pt => (axis === 'vertical' ? { x: fixed, y: other } : { x: other, y: fixed });
  const eps = 1e-9;
  const xs: { edge: number; t: number; p: Pt }[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ca = c(a);
    const cb = c(b);
    if (Math.abs(ca - cb) < eps) continue; // 与切割线平行（含重合边）
    for (const ln of [lo, hi]) {
      if (!Number.isFinite(ln)) continue;
      // 半开区间：起点在带内一侧、终点越过线，避免顶点被计两次
      const up = ca < ln && cb >= ln;
      const down = cb < ln && ca >= ln;
      if (!up && !down) continue;
      const t = (ln - ca) / (cb - ca);
      const o = a.y + (b.y - a.y) * t;
      const o2 = a.x + (b.x - a.x) * t;
      xs.push({ edge: i, t, p: at(ln, axis === 'vertical' ? o : o2) });
    }
  }
  xs.sort((p, q) => p.edge - q.edge || p.t - q.t);
  if (!xs.length) {
    const inside = poly.every((p) => c(p) >= lo - 1e-6 && c(p) <= hi + 1e-6);
    return inside ? poly.slice() : null;
  }
  if (xs.length % 2 !== 0) return null;
  const chains: { from: (typeof xs)[number]; to: (typeof xs)[number]; pts: Pt[] }[] = [];
  for (let k = 0; k < xs.length; k++) {
    const from = xs[k];
    const to = xs[(k + 1) % xs.length];
    const pts: Pt[] = [from.p];
    let idx = (from.edge + 1) % n;
    let guard = 0;
    while (guard++ <= n) {
      if (idx === (to.edge + 1) % n) break;
      pts.push(poly[idx]);
      idx = (idx + 1) % n;
    }
    pts.push(to.p);
    const mid = pts.reduce((s, p) => s + c(p), 0) / pts.length;
    if (mid > lo + 1e-6 && mid < hi - 1e-6) chains.push({ from, to, pts });
  }
  const want = Number.isFinite(lo) && Number.isFinite(hi) ? 2 : 1;
  if (chains.length !== want) return null;
  const ring: Pt[] = [];
  for (const ch of chains) ring.push(...ch.pts);
  if (ring.length < 3) return null;
  return ring;
}

/**
 * 凸/凹多边形按轴裁剪（竖/横中线 + 厚度）：
 * 用两条平行线（中心线 ± 半厚）把多边形分成 [左/上子区, 中梃, 右/下子区]。
 * 中点线按多边形包围盒的比例定位。返回三个闭合多边形（world mm）；退化或切成多块时返回 null。
 */
export function clipByAxis(
  poly: Pt[],
  axis: 'vertical' | 'horizontal',
  ratio: number,
  thickness: number,
): { a: Pt[]; muntin: Pt[]; b: Pt[] } | null {
  const box = bBoxOf(poly);
  const span = axis === 'vertical' ? box.w : box.h;
  if (span <= 0) return null;
  const half = thickness / 2;
  const base = axis === 'vertical' ? box.x : box.y;
  const c0 = base + span * ratio - half;
  const c1 = base + span * ratio + half;
  const a = clipSlab(poly, axis, -Infinity, c0);
  const muntin = clipSlab(poly, axis, c0, c1);
  const b = clipSlab(poly, axis, c1, Infinity);
  if (!a || !muntin || !b) return null;
  if (a.length < 3 || b.length < 3 || muntin.length < 3) return null;
  return { a: dedupPts(a), muntin: dedupPts(muntin), b: dedupPts(b) };
}

/** 判断点是否在多边形内（射线法，用于命中测试/放置校验） */
export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * 外框四边分组：把闭合轮廓按边的走向拆成 顶/右/底/左 四条链（每条长度=该边下料长）。
 * 按每条边的主导方向归属：横向边（|dx|≥|dy|）按中点在上/下半归 顶/底；
 * 纵向边（|dy|>|dx|）按中点在左/右半归 左/右。
 * 矩形精确 = w/w/h/h；梯形 = 顶宽/底宽/两斜边；拱形/尖拱 = 底边(直)/两侧(直边+起拱弧)/顶弧链。
 * 四链之和恒等于轮廓周长。弧/斜边已被折线采样覆盖，故长度=折线长。
 */
export function outlineFourSides(pts: Pt[]): { top: number; right: number; bottom: number; left: number } {
  const box = bBoxOf(pts);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const chains: Record<'top' | 'right' | 'bottom' | 'left', number[]> = { top: [], right: [], bottom: [], left: [] };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len <= 0) continue;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const side = Math.abs(dx) >= Math.abs(dy) ? (mid.y <= cy ? 'top' : 'bottom') : mid.x <= cx ? 'left' : 'right';
    chains[side].push(len);
  }
  const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);
  return {
    top: sum(chains.top),
    right: sum(chains.right),
    bottom: sum(chains.bottom),
    left: sum(chains.left),
  };
}

const onSeg = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** 两线段严格相交（排除端点接触，避免擦边被当成切割） */
function segCross(a: Pt, b: Pt, c: Pt, d: Pt): { t: number; u: number } | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  const eps = 1e-9;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return { t, u };
}

/** 圆弧采样链（角度制，y 轴向下；用于把曲线分割交给 splitByChain 的折线算法） */
export function arcChain(c: Pt, r: number, fromDeg: number, toDeg: number, segments = 32): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / segments) * Math.PI) / 180;
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return out;
}

/**
 * 用一条开折线（弧链）把简单多边形切成两块。
 * 只处理「链穿入一次、穿出一次」的常规切割：交点数 ≠ 2、任一块自交、或两块面积之和
 * 不等于原面积时一律返回 null（宁可不切，也不产出错轮廓）——与 clipByAxis 同一套拒绝纪律。
 */
export function splitByChain(poly: Pt[], chain: Pt[]): { a: Pt[]; b: Pt[] } | null {
  const n = poly.length;
  if (n < 3 || chain.length < 2) return null;
  const hits: { chainIdx: number; tc: number; p: Pt; edge: number }[] = [];
  for (let ci = 0; ci + 1 < chain.length; ci++) {
    for (let e = 0; e < n; e++) {
      const r = segCross(chain[ci], chain[ci + 1], poly[e], poly[(e + 1) % n]);
      if (r) hits.push({ chainIdx: ci, tc: r.t, p: onSeg(chain[ci], chain[ci + 1], r.t), edge: e });
    }
  }
  hits.sort((x, y) => x.chainIdx - y.chainIdx || x.tc - y.tc);
  if (hits.length !== 2) return null;
  const [h1, h2] = hits;
  const midInterior: Pt[] = [];
  for (let i = h1.chainIdx + 1; i <= h2.chainIdx; i++) midInterior.push(chain[i]);
  // 沿多边形正向走：从 from 交点之后第一个顶点到 to 交点所在边的起点
  const boundary = (from: { edge: number }, to: { edge: number }) => {
    const out: Pt[] = [];
    let i = (from.edge + 1) % n;
    let guard = 0;
    while (guard++ <= n) {
      out.push(poly[i]);
      if (i === to.edge) break;
      i = (i + 1) % n;
    }
    return out;
  };
  const a = dedupPts([h1.p, ...midInterior, h2.p, ...boundary(h2, h1)]);
  const b = dedupPts([h1.p, ...boundary(h1, h2), h2.p, ...midInterior.slice().reverse()]);
  if (a.length < 3 || b.length < 3) return null;
  if (!isSimplePolygon(a) || !isSimplePolygon(b)) return null;
  const whole = polygonArea(poly);
  if (!(whole > 0) || Math.abs(polygonArea(a) + polygonArea(b) - whole) > Math.max(1, whole * 1e-6)) return null;
  return { a, b };
}

/** 由弦与弧高确定的圆弧（角度制，y 轴向下） */
export interface ArcSpec {
  center: Pt;
  rMm: number;
  fromDeg: number;
  sweepDeg: number;
}

/** 弦 a→b、弧高 sagitta（正值朝左法向凸出）→ 圆弧；弧高≈0 时返回 null（走直线分割） */
export function arcFromChord(a: Pt, b: Pt, sagittaMm: number): ArcSpec | null {
  const L = dist(a, b);
  const s = sagittaMm;
  if (L <= 0 || Math.abs(s) < 1e-6) return null;
  const abs = Math.abs(s);
  const r = (abs * abs + (L * L) / 4) / (2 * abs);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const nx = (-(b.y - a.y)) / L;
  const ny = (b.x - a.x) / L;
  const dir = s > 0 ? 1 : -1;
  const center = { x: mid.x - nx * dir * (r - abs), y: mid.y - ny * dir * (r - abs) };
  const a0 = Math.atan2(a.y - center.y, a.x - center.x);
  const a1 = Math.atan2(b.y - center.y, b.x - center.x);
  let sweep = a1 - a0;
  while (sweep <= -Math.PI) sweep += 2 * Math.PI;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  return { center, rMm: r, fromDeg: (a0 * 180) / Math.PI, sweepDeg: (sweep * 180) / Math.PI };
}

/** 按弧采样链：可改半径（做等距带）、可向两端延长（保证干净穿出区域） */
export function arcChainOf(arc: ArcSpec, rMm = arc.rMm, segments = 24, extend = 0.2): Pt[] {
  const from = arc.fromDeg - arc.sweepDeg * extend;
  const to = arc.fromDeg + arc.sweepDeg * (1 + extend);
  const out: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = ((from + ((to - from) * i) / segments) * Math.PI) / 180;
    out.push({ x: arc.center.x + rMm * Math.cos(a), y: arc.center.y + rMm * Math.sin(a) });
  }
  return out;
}

/**
 * 等距弧带分割：按「轴向比例线 + 弧高」把多边形切成 [中心侧块, 弧带, 外侧块]。
 * 中心侧 = a（对应 clipByAxis 的 <c0 侧），与直线分割保持同一约定；弧高≈0 时直接走 clipByAxis。
 * 任一环节退化（穿越次数≠2、自交、面积不守恒）返回 null，由调用方回退直线分割。
 */
export function clipByArcBand(
  poly: Pt[],
  axis: 'vertical' | 'horizontal',
  ratio: number,
  thickness: number,
  sagittaMm: number,
): { a: Pt[]; muntin: Pt[]; b: Pt[] } | null {
  if (Math.abs(sagittaMm) < 1e-6) return clipByAxis(poly, axis, ratio, thickness);
  const box = bBoxOf(poly);
  const at = ratio > 0 && ratio < 1 ? ratio : 0.5;
  const x = box.x + box.w * at;
  const y = box.y + box.h * at;
  const chordA = axis === 'vertical' ? { x, y: box.y } : { x: box.x, y };
  const chordB = axis === 'vertical' ? { x, y: box.y + box.h } : { x: box.x + box.w, y };
  // 弧高必须小于半弦（≥半圆就不是"梃"而是回转曲线），否则由调用方回退成直线分割
  if (Math.abs(sagittaMm) >= dist(chordA, chordB) / 2) return null;
  const arc = arcFromChord(chordA, chordB, sagittaMm);
  if (!arc) return null;
  const t = Math.max(1, thickness);
  const rHi = arc.rMm + t / 2;
  const rLo = arc.rMm - t / 2;
  if (rLo <= 0) return null;
  const outer = splitByChain(poly, arcChainOf(arc, rHi));
  if (!outer) return null;
  if (rLo <= 6) return null;
  // 探针沿「圆心 → 弦中点」这条径向取三个半径位置（圆心本身常在区域外，不能当探针）
  const chordMid = { x: (chordA.x + chordB.x) / 2, y: (chordA.y + chordB.y) / 2 };
  const dcm = Math.max(1e-6, dist(chordMid, arc.center));
  const ux = (chordMid.x - arc.center.x) / dcm;
  const uy = (chordMid.y - arc.center.y) / dcm;
  const atR = (radius: number): Pt => ({ x: arc.center.x + ux * radius, y: arc.center.y + uy * radius });
  const pIn = atR(rLo - 5);
  const pBand = atR((rLo + rHi) / 2);
  const pOut = atR(rHi + 5);
  const pick = (piece: { a: Pt[]; b: Pt[] }, probe: Pt): Pt[] | null =>
    (pointInPoly(probe, piece.a) ? piece.a : null) ?? (pointInPoly(probe, piece.b) ? piece.b : null);
  const innerSide = pick(outer, pIn);
  const outerSide = pick(outer, pOut);
  if (!innerSide || !outerSide || innerSide === outerSide) return null;
  const split2 = splitByChain(innerSide, arcChainOf(arc, rLo));
  if (!split2) return null;
  const leafIn = pick(split2, pIn);
  const band = pick(split2, pBand);
  if (!leafIn || !band || leafIn === band) return null;
  const whole = polygonArea(poly);
  const sum = polygonArea(leafIn) + polygonArea(band) + polygonArea(outerSide);
  if (Math.abs(sum - whole) > Math.max(2, whole * 1e-5)) return null;
  // 与 clipByAxis 同约定：a = 左/上侧子区，b = 右/下侧子区（用顶点均值比较，与凸向无关）
  const key = (pts: Pt[]) => axis === 'vertical' ? pts.reduce((s, p) => s + p.x, 0) / pts.length : pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const [a, b] = key(leafIn) <= key(outerSide) ? [leafIn, outerSide] : [outerSide, leafIn];
  return { a, muntin: band, b };
}

/**
 * 斜带用的偏移坐标：把点归一化到多边形包围盒后取 f = v − u（↘族）或 f = v + u − 1（↗族）。
 * f = 0 正好是那条**对角线本身**，故 ratio=0.5 = 角到角的一刀；f 的取值区间是 [−1, 1]。
 */
function slopeF(p: Pt, box: Box, slope: MuntinSlope): number {
  const u = (p.x - box.x) / Math.max(1e-6, box.w);
  const v = (p.y - box.y) / Math.max(1e-6, box.h);
  return slope === 'diagonal' ? v - u : v + u - 1;
}

/** 等值线 f = c 上的一条长直链（两端伸出包围盒之外，保证穿过整个多边形） */
function slopeChain(box: Box, slope: MuntinSlope, c: number): Pt[] {
  const reach = 2 * Math.hypot(box.w, box.h);
  const len = Math.max(1e-6, Math.hypot(box.w, box.h));
  const ux = box.w / len;
  const uy = (slope === 'diagonal' ? box.h : -box.h) / len;
  const base = { x: box.x + box.w * 0.5, y: box.y + box.h * (c + 0.5) };
  return [
    { x: base.x - ux * reach, y: base.y - uy * reach },
    { x: base.x + ux * reach, y: base.y + uy * reach },
  ];
}

const meanF = (pts: Pt[], box: Box, slope: MuntinSlope): number =>
  pts.reduce((s, p) => s + slopeF(p, box, slope), 0) / Math.max(1, pts.length);

/** 斜梃朝向：`diagonal` 平行于「左上→右下」对角线（↘），`antiDiagonal` 平行于「左下→右上」对角线（↗） */
export type MuntinSlope = 'diagonal' | 'antiDiagonal';

/**
 * 斜等宽带分割：按「对角线族偏移 ratio + 料厚」把多边形切成 [a=小 f 侧, 斜带, b=大 f 侧]。
 * 与弧带同一套纪律——两次 `splitByChain` 切割、三块面积必须守恒，任何退化（穿越次数≠2、自交、
 * 面积不守恒、带子被切没）一律返回 null，由调用方拒绝这次分割（斜梃没有"回退成直梃"这种合理降级）。
 */
export function clipByDiagonalBand(
  poly: Pt[],
  slope: MuntinSlope,
  ratio: number,
  thickness: number,
): { a: Pt[]; muntin: Pt[]; b: Pt[] } | null {
  if (poly.length < 3) return null;
  const box = bBoxOf(poly);
  if (box.w <= 1 || box.h <= 1) return null;
  const at = ratio > 0 && ratio < 1 ? ratio : 0.5;
  const c = 1 - 2 * at;
  // 料厚是**垂直于带**的 mm 数，换算到 f 单位要乘该方向的梯度模长
  const half = (Math.max(1, thickness) / 2) * Math.hypot(1 / box.w, 1 / box.h);
  const hi = splitByChain(poly, slopeChain(box, slope, c + half));
  if (!hi) return null;
  const fHi = meanF(hi.a, box, slope);
  const fLo = meanF(hi.b, box, slope);
  const [bigSide, lowSide] = fHi > fLo ? [hi.a, hi.b] : [hi.b, hi.a];
  const inner = splitByChain(lowSide, slopeChain(box, slope, c - half));
  if (!inner) return null;
  const gHi = meanF(inner.a, box, slope);
  const gLo = meanF(inner.b, box, slope);
  const [a, band] = gHi > gLo ? [inner.b, inner.a] : [inner.a, inner.b];
  const whole = polygonArea(poly);
  const sum = polygonArea(a) + polygonArea(band) + polygonArea(bigSide);
  if (Math.abs(sum - whole) > Math.max(2, whole * 1e-5)) return null;
  if (polygonLen(band) / 2 - thickness <= 0) return null;
  return { a, muntin: band, b: bigSide };
}

/** 区域标注锚点：面积加权质心；月牙/弧带等强凹形质心会落到区域外，此时退到"边中点朝质心微移"的内侧点 */
export function regionAnchor(pts: Pt[]): Pt {
  if (!pts.length) return { x: 0, y: 0 };
  const b = bBoxOf(pts);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-6) return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const centroid = { x: cx / (6 * a), y: cy / (6 * a) };
  if (pointInPoly(centroid, pts)) return centroid;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const probe = { x: mid.x + (centroid.x - mid.x) * 0.02, y: mid.y + (centroid.y - mid.y) * 0.02 };
    if (pointInPoly(probe, pts)) return probe;
  }
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}
