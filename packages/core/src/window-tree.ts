import { randomId } from './util.js';
import type { DesignComponent, DesignModel, DesignFitting, WindowType } from '@wdd/schema';
import { clipByArcBand, clipByAxis, clipByDiagonalBand, bBoxOf, insetPolygon, polygonLen, sampleOutline, type FrameShape, type MuntinSlope, type Pt } from './outline.js';
import { resolveComponentType } from './component-registry.js';
import type { FittingType } from './fitting-registry.js';
import { DEFAULT_INSTALL_GAP_MM } from './defaults.js';

/** 配件实例（windoorcraft 16 类配件体系）：几何归属决定挂载层级 */
export interface WindowFitting {
  id: string;
  type: FittingType;
  /** 安装方位（对碰位左/右、压线边等） */
  side?: 'left' | 'right' | 'top' | 'bottom';
  /** 数量（缺省用注册表默认） */
  count?: number;
}

/**
 * 门窗容器树模型（对齐第三方工具"先外框容器 → 分割 → 放构件"的递归交互）：
 *
 *   WindowTree（根）
 *    └─ root: WindowTreeArea（主内腔容器）
 *        ├─ 可分割：children = [子Area, 中梃Muntin, 子Area]（递归，三明治结构）
 *        └─ 叶子：放置构件 sash（固定玻璃 / 平开 / 推拉 / 上悬 / 内开内倒 / 纱窗）
 *
 * 模型不依赖 Konva/React，几何由 layoutTree 统一计算，可持久化、可测试、可被 server 复用。
 * 通过 toDesignComponents 转成 DesignModel，复用既有 BOM/报价/校验链路。
 */

/** 构件/扇类型：固定 / 平开 / 推拉 / 上悬 / 内开内倒 + 纱窗 */
export type SashType = WindowType | 'screen';

/** 外框四条边（缺边操作用） */
export type FrameSide = 'up' | 'down' | 'left' | 'right';

export interface WindowTree {
  id: string;
  name: string;
  /** 洞口宽高（mm） */
  openingW: number;
  openingH: number;
  seriesId: string;
  glassId: string;
  /** 外框宽（mm） */
  frameWidthMm: number;
  /** 扇料宽（mm）；缺省 = frameWidthMm + SASH_WIDTH_BONUS_MM（扇料应略宽于框料） */
  sashWidthMm?: number;
  /** 中梃料厚（mm）；缺省 = DEFAULT_MUNTIN_MM（实测直梃 40 / 弧梃 50 属分档） */
  muntinWidthMm?: number;
  /** 新建中梃的默认弧高（mm，正=朝左/上凸，负=反向，0/缺省=直梃） */
  muntinSagittaMm?: number;
  /** 对开扇中缝料（对开料）宽度（mm）；缺省 = DEFAULT_MEETING_MM（实测扇料 22 时对开料 60） */
  meetingWidthMm?: number;
  /** 百叶帘片间距（mm）；缺省 = DEFAULT_LOUVER_PITCH_MM（对方未采到，按行业惯例可配） */
  louverPitchMm?: number;
  /** 肯德基门下板高度（mm）；缺省 = DEFAULT_PANEL_HEIGHT_MM（实测 200） */
  panelHeightMm?: number;
  /** 异形外框形状（缺省 rect=矩形，走既有矩形路径） */
  frameShape?: FrameShape;
  /** 等腰梯形顶边宽比（0..1，仅 frameShape==='trapezoid'） */
  topRatio?: number;
  /** 缺边（开放框/传递窗/吧台窗/落地门洞）：被缺的边不画框料也不出型材；缺省四边齐全 */
  frameOpenSides?: FrameSide[];
  /**
   * 自定义外框轮廓（mm，相对外框左上角的局部坐标，闭合多边形）。
   * 用于旧方案里无法用 frameShape 枚举表达的异形轮廓；存在时布局/描述/出料一律优先于 frameShape 采样。
   */
  frameContour?: Pt[];
  /** 窗口世界坐标偏移（mm，默认 0,0；外框左/上边拖拽时变化） */
  offsetX?: number;
  offsetY?: number;
  /** 整窗级配件（外框/中梃/洞口/防盗框/锁配件） */
  fittings?: WindowFitting[];
  /** 主内腔容器；null 表示尚未创建外框结构 */
  root: WindowTreeArea | null;
}

export type WindowNode = WindowTreeArea | WindowMuntin | WindowSashNode;

export interface WindowTreeArea {
  id: string;
  kind: 'area';
  /** 相对父容器的矩形（0..1）；root 固定为 0,0,1,1 */
  xr: number;
  yr: number;
  wr: number;
  hr: number;
  /** 已分割：children = [子Area, 中梃, 子Area]（与 sash 互斥） */
  children?: [WindowTreeArea, WindowMuntin, WindowTreeArea];
  /** 未分割叶子：放置构件（与 children 互斥） */
  sash?: WindowSashSpec;
  label?: string;
  /** 叶子级配件（玻扇/纱扇/玻璃/对开扇/推拉/折叠/板材/对碰位配件） */
  fittings?: WindowFitting[];
  /** 玻璃格条（装饰条）图案；未配置即无格条 */
  bars?: GlassBarSpec;
}

export interface WindowMuntin {
  id: string;
  kind: 'muntin';
  /**
   * vertical=竖中梃（左右分）；horizontal=横中梃（上下分）；
   * diagonal=斜梃（平行于「左上→右下」对角线）；antiDiagonal=斜梃↗（平行于「左下→右上」对角线）。
   * 斜梃的 ratio 是该对角线族里的偏移（0.5=正好角到角那条对角线），thicknessMm 按**垂直于料**计；
   * 斜梃不支持 curve（弧高只对直轴带有意义）。
   */
  direction: 'vertical' | 'horizontal' | MuntinSlope;
  /** 中梃中心线相对父容器的比例（0..1） */
  ratio: number;
  /** 中梃厚度（mm） */
  thicknessMm: number;
  /**
   * 弧梃（曲线中梃）：sagittaMm = 相对中心线弦的弧高（mm），
   * 正值朝左/上侧凸出（与 clipByArcBand 同一约定）。缺省=直线中梃。
   */
  curve?: { sagittaMm: number };
}

/** 该方向是斜梃吗；返回其朝向（轴对齐中梃返回 null） */
export function slopeOf(direction: WindowMuntin['direction']): MuntinSlope | null {
  return direction === 'diagonal' || direction === 'antiDiagonal' ? direction : null;
}

/** 矩形 → 点环（供多边形裁剪器使用） */
function rectPtsOf(b: WindowBox): Pt[] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
}

/** 带轮廓是否真的斜（存在既不平也不竖的边）——用于区分"斜带"与"退化回轴对齐矩形带" */
function bandIsOblique(pts: Pt[]): boolean {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (Math.abs(b.x - a.x) > 1 && Math.abs(b.y - a.y) > 1) return true;
  }
  return false;
}

/** 扇面填充：只有显式 `louver` 才算百叶（旧数据一律玻璃，无损） */
export function sashInfillOf(sash?: Pick<WindowSashSpec, 'infill'> | null): 'glass' | 'louver' | 'panel' {
  return sash?.infill === 'louver' || sash?.infill === 'panel' ? sash.infill : 'glass';
}

/** 百叶帘片默认间距（mm）——对方未采到帘片几何，按行业惯例取值并做成可配参数 */
export const DEFAULT_LOUVER_PITCH_MM = 100;

/** 百叶帘片间距（mm） */
export function louverPitchOf(tree: Pick<WindowTree, 'louverPitchMm'>): number {
  return Math.max(10, tree.louverPitchMm ?? DEFAULT_LOUVER_PITCH_MM);
}

/**
 * 百叶帘片在单叶内的位置（元素局部坐标，返回每片的 y 中心）：
 * 在扇口高度内按间距均摊，两端各留半间距，保证片数 ≥ 2 且不超过叶高。
 */
export function louverSlats(h: number, inset: number, pitch: number): number[] {
  const top = Math.max(1, inset);
  const usable = h - 2 * top;
  if (usable <= 0) return [];
  const n = Math.max(2, Math.min(60, Math.round(usable / Math.max(10, pitch))));
  const step = usable / n;
  return Array.from({ length: n }, (_, i) => top + step * (i + 0.5));
}

/** 下板（肯德基门横板）默认高度（mm）：实测 windoorcraft 门体下部 200mm 横板 */
export const DEFAULT_PANEL_HEIGHT_MM = 200;

/** 下板高度（mm） */
export function panelHeightOf(tree: Pick<WindowTree, 'panelHeightMm'>): number {
  return Math.max(1, tree.panelHeightMm ?? DEFAULT_PANEL_HEIGHT_MM);
}

/** 上玻下板单叶的分块（元素局部坐标） */
export interface PanelLeafLayout {
  /** 下部横板（实测 `#636568` 填充，高 = panelH） */
  panel: { x: number; y: number; w: number; h: number };
  /** 板顶中横档的中心 y（实测扇料在此断开，即一根扇料宽的横档） */
  railY: number;
  /** 上部玻璃 */
  glass: { x: number; y: number; w: number; h: number };
}

/**
 * 把单叶分成「上玻 + 中横档 + 下板」：
 * 实测（§5.3 肯德基门）下部横板 200mm、扇料在板顶 `y1227/1249` 处断开（差 22 = 扇料宽）。
 * 叶高不够同时放下板与玻璃时返回 null（调用方按普通扇画，不产出负尺寸）。
 */
export function panelLeafLayout(w: number, h: number, inset: number, panelH: number): PanelLeafLayout | null {
  const bar = Math.max(1, inset);
  const usable = h - 2 * bar;
  const panel = Math.min(Math.max(0, panelH), usable - bar * 2);
  if (w <= 0 || panel <= 0 || usable - panel - bar * 2 <= 0) return null;
  const panelTop = h - bar - panel;
  return {
    panel: { x: bar, y: panelTop, w: Math.max(1, w - 2 * bar), h: panel },
    railY: panelTop - bar / 2,
    glass: { x: bar, y: bar, w: Math.max(1, w - 2 * bar), h: Math.max(1, panelTop - bar * 2) },
  };
}

/** 把手（扇上的独立构件）：水平=相对自由边竖料中心线偏移（mm，可负），垂直=中心距扇底（mm） */
export interface SashHandleSpec {
  /** 仅显式 false 才隐藏；缺省即自动存在（有开启扇就有把手） */
  show?: boolean;
  /** 沿料宽方向的偏移（mm），0=料中心线 */
  offsetMm?: number;
  /** 中心点距扇底边（mm）；缺省 = 扇高 / 2 */
  fromBottomMm?: number;
}

export interface WindowSashNode {
  id: string;
  kind: 'sash';
  windowType: SashType;
  hingeSide?: 'left' | 'right' | 'top' | 'bottom';
  openDirection?: 'in' | 'out';
  label: string;
  /** 构件类型注册表 id（windoorcraft 体系扩展；空=回退 windowType 判定） */
  roleType?: string;
  /** 把手（独立构件，位置可调 + 画布标注） */
  handle?: SashHandleSpec;
}

export interface WindowSashSpec {
  windowType: SashType;
  hingeSide?: 'left' | 'right' | 'top' | 'bottom';
  openDirection?: 'in' | 'out';
  label: string;
  /** 构件类型注册表 id（空=回退 windowType 判定，旧数据无损） */
  roleType?: string;
  /** 把手（独立构件，位置可调 + 画布标注） */
  handle?: SashHandleSpec;
  /**
   * 扇叶数：缺省/1=单扇；2=**对开扇**（一个构件两片扇，中缝是两根「对开料」而不是中梃，
   * 两叶各自以外侧为合页、把手贴自由边＝中缝侧，玻璃拆成两块）。
   */
  leaves?: number;
  /**
   * 扇面填充（对齐对方「其他」面板的填充物一族：玻璃/纱网/板材/百叶/空填充物）：
   * 缺省/`glass`=玻璃；`louver`=**百叶帘片**（百叶窗 / 对开百叶窗，不出玻璃与压线，改出帘片）；
   * `panel`=**上玻下板**（肯德基门：下部横板 + 板顶中横档，玻璃只剩上半）。
   */
  infill?: 'glass' | 'louver' | 'panel';
}

export interface WindowBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 分割线距容器边缘的最小比例（避免产生不可加工的极窄格） */
export const MIN_RATIO = 0.08;
/** 默认中梃厚度（mm） */
export const DEFAULT_MUNTIN_MM = 40;
/** 扇料相对外框料的加成宽度（mm）：扇料应略宽于框料（未显式配置 sashWidthMm 时生效） */
export const SASH_WIDTH_BONUS_MM = 10;
/** 把手尺寸（mm，windoorcraft 实测：44×65 本体 + 70 传动杆，圆角 6/5） */
export const HANDLE_W_MM = 44;
export const HANDLE_H_MM = 65;
export const HANDLE_ARM_MM = 70;

/** 扇料宽（mm）：显式配置优先，否则外框宽 + 加成 */
export function sashWidthOf(tree: Pick<WindowTree, 'frameWidthMm' | 'sashWidthMm'>): number {
  return Math.max(1, tree.sashWidthMm ?? tree.frameWidthMm + SASH_WIDTH_BONUS_MM);
}

/** 生效的缺边集合：未配置或四边全缺（无意义状态）都归一为空 */
export function frameOpenSidesOf(tree: Pick<WindowTree, 'frameOpenSides'>): FrameSide[] {
  const s = tree.frameOpenSides ?? [];
  return s.length >= 4 ? [] : s;
}

/** 中梃料厚（mm）：整窗可配（实测直梃 40 / 弧梃 50 属分档），缺省走默认 */
export function muntinWidthOf(tree: Pick<WindowTree, 'muntinWidthMm'>): number {
  return Math.max(1, tree.muntinWidthMm ?? DEFAULT_MUNTIN_MM);
}

/** 新建中梃的默认弧高（mm）：0 / 缺省 = 直梃 */
export function muntinSagittaOf(tree: Pick<WindowTree, 'muntinSagittaMm'>): number {
  return tree.muntinSagittaMm ?? 0;
}

/** 对开扇中缝料默认宽度（mm）：实测 windoorcraft 扇料 22mm 时对开料 60mm */
export const DEFAULT_MEETING_MM = 60;

/** 中缝料（对开料）宽度（mm） */
export function meetingWidthOf(tree: Pick<WindowTree, 'meetingWidthMm'>): number {
  return Math.max(1, tree.meetingWidthMm ?? DEFAULT_MEETING_MM);
}

/** 扇叶数：只有显式 2 才算对开扇（旧数据无损） */
export function sashLeavesOf(sash?: Pick<WindowSashSpec, 'leaves'> | null): number {
  return sash?.leaves === 2 ? 2 : 1;
}

/** 对开扇单叶的几何（元素局部坐标）：合页侧沿用扇料宽，自由边是中缝料宽 */
export interface SashLeafRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 该叶合页在哪一侧（对开扇两叶外向合页） */
  hinge: 'left' | 'right';
  /** 自由边（中缝）料宽（mm）：对开扇为中缝料，单扇为普通扇料 */
  freeBarMm: number;
}

/**
 * 把格子按扇叶数分成单叶矩形。对开扇两叶在中缝**重叠一个中缝料宽**（实测：左扇右边
 * `1289..1349` 与右扇左边同段），所以 `leafW = (w + meeting) / 2`，且**没有中梃**。
 */
export function sashLeafRects(w: number, h: number, leaves: number, meetingMm: number): SashLeafRect[] {
  if (leaves !== 2) return [{ x: 0, y: 0, w, h, hinge: 'left', freeBarMm: meetingMm }];
  const m = Math.max(1, meetingMm);
  const leafW = Math.max(1, (w + m) / 2);
  return [
    { x: 0, y: 0, w: leafW, h, hinge: 'left', freeBarMm: m },
    { x: w - leafW, y: 0, w: leafW, h, hinge: 'right', freeBarMm: m },
  ];
}

/** 玻璃格条（装饰条）图案；厚度规则取自 windoorcraft 实测：外环 40、直条 20、圆环带 10、菱形斜条 28 */
export type GlassBarPattern =
  | 'colonial'
  | 'rect'
  | 'diamond'
  | 'wheel'
  | 'chinese'
  | 'prairie'
  | 'rightAngle'
  | 'halfWheel'
  | 'spoke'
  | 'innerArc'
  | 'semiArc'
  | 'quarterArc'
  | 'shallowArc'
  | 'doubleArc'
  | 'extendableArc'
  | 'crabapple';

/** 格条图案清单（与 GlassBarPattern 同源，供 UI 遍历与防漂移校验） */
export const GLASS_BAR_PATTERN_IDS: readonly GlassBarPattern[] = [
  'colonial', 'chinese', 'rect', 'prairie', 'rightAngle', 'diamond',
  'wheel', 'spoke', 'halfWheel', 'innerArc', 'semiArc', 'quarterArc',
  'shallowArc', 'doubleArc', 'extendableArc', 'crabapple',
];

/** 格条图案中文名 */
export const GLASS_BAR_LABEL: Record<GlassBarPattern, string> = {
  colonial: '均分格条',
  chinese: '中式格条',
  rect: '矩形格条',
  prairie: '经典格条',
  rightAngle: '直角格条',
  diamond: '菱形格条',
  wheel: '圆环格条',
  spoke: '车轮辐条',
  halfWheel: '半圆轮',
  innerArc: '内弧',
  semiArc: '半弧轮',
  quarterArc: '对开弧',
  shallowArc: '浅弧',
  doubleArc: '双弧',
  extendableArc: '伸缩弧',
  crabapple: '海棠角',
};

/** 格条图案分组（直条形 / 弧形式）；摊平后必须覆盖 GLASS_BAR_PATTERN_IDS */
export const GLASS_BAR_GROUPS: { label: string; value: readonly GlassBarPattern[] }[] = [
  { label: '直条形', value: ['colonial', 'chinese', 'rect', 'prairie', 'rightAngle', 'diamond'] },
  {
    label: '弧形式',
    value: ['wheel', 'spoke', 'halfWheel', 'innerArc', 'semiArc', 'quarterArc', 'shallowArc', 'doubleArc', 'extendableArc', 'crabapple'],
  },
];

export interface GlassBarSpec {
  pattern: GlassBarPattern;
  /** 竖向分格数（colonial/chinese 用），默认 2 */
  cols?: number;
  /** 横向分格数，默认 2 */
  rows?: number;
  /** 顶部横档（对应实测 *_topBar 变体）：在玻璃上部加一根 20mm 横条 */
  topBar?: boolean;
  /** 仅显式 false 才不画（缺省自动画） */
  show?: boolean;
}

/** 格条出料描述子（mm，玻璃局部坐标：原点在玻璃左上角） */
export interface GlassBarLine { x1: number; y1: number; x2: number; y2: number; widthMm: number }
export interface GlassBarRing { insetMm: number; widthMm: number }
/** 弧带：startDeg/sweepDeg 省略时为整圆 */
export interface GlassBarArcBand { cx: number; cy: number; rMm: number; widthMm: number; startDeg?: number; sweepDeg?: number }

export interface GlassBarGeometry {
  rings: GlassBarRing[];
  lines: GlassBarLine[];
  arcs: GlassBarArcBand[];
}

export const BAR_W_OUTER = 40;
export const BAR_W_STRAIGHT = 20;
export const BAR_W_ARC = 10;
export const BAR_W_DIAGONAL = 28;

/**
 * 玻璃格条几何（厚度与半径比例取自 windoorcraft 实测，见 docs/WINDOORCRAFT_COMPONENT_DRAW_SPECS.md §7）：
 * - 除 `colonial` 外先有一圈 40mm 外环；直条 20mm、弧带 10mm、菱形斜条 28mm；
 * - `colonial`/`chinese`：按 cols×rows 等分直条，chinese 另加四角短条；`rect` 内嵌 20mm 环；
 * - `prairie`（经典）中央方环 + 四条连接条；`rightAngle` 四条角部直条；`diamond` 两条对角斜条；
 * - `wheel` 单根同心环带（实测 10×1）；`spoke`（实测 half_wheel）3 根过心直条；`halfWheel` 为我方扩展（半圆 + 辐条）；
 * - `innerArc`/`semiArc` 底边为轴的同心上半弧 + 竖条；`quarterArc`/`shallowArc`/`doubleArc`/`extendableArc` 为大半径浅弧带（半径比 0.74~4.27）；
 * - `crabapple` 海棠角 = 实测 `decoration_bar_crabapple`：绕心旋转 ~29° 的方形环带 + 6 根连到玻璃四边的短条；
 *   `crabapple_inner`（实测数据里短条位置与底图相同，疑似叠加绘制）暂不实现；`topBar` 为任一图案叠加顶部横档。
 * 所有描述子都落在 [0,w]×[0,h] 内（弧段给出 startDeg/sweepDeg，越界部分由渲染层裁到玻璃），渲染层无需再求交。
 */
export function glassBarGeometry(w: number, h: number, bars?: GlassBarSpec): GlassBarGeometry | null {
  if (!bars || bars.show === false) return null;
  const W = Math.max(1, w);
  const H = Math.max(1, h);
  const rings: GlassBarRing[] = [];
  const lines: GlassBarLine[] = [];
  const arcs: GlassBarArcBand[] = [];
  const inner = { x: 0, y: 0, w: W, h: H };

  if (bars.pattern !== 'colonial') {
    rings.push({ insetMm: 0, widthMm: BAR_W_OUTER });
    const t = Math.min(BAR_W_OUTER, W / 4, H / 4);
    inner.x = t; inner.y = t; inner.w = Math.max(1, W - 2 * t); inner.h = Math.max(1, H - 2 * t);
  }

  const vCount = Math.max(0, Math.min(12, (bars.cols ?? 2) - 1));
  const hCount = Math.max(0, Math.min(12, (bars.rows ?? 2) - 1));
  const putGrid = () => {
    for (let i = 1; i <= vCount; i++) {
      const x = Math.round(inner.x + (inner.w * i) / (vCount + 1));
      lines.push({ x1: x, y1: inner.y, x2: x, y2: Math.round(inner.y + inner.h), widthMm: BAR_W_STRAIGHT });
    }
    for (let j = 1; j <= hCount; j++) {
      const y = Math.round(inner.y + (inner.h * j) / (hCount + 1));
      lines.push({ x1: inner.x, y1: y, x2: Math.round(inner.x + inner.w), y2: y, widthMm: BAR_W_STRAIGHT });
    }
  };

  /** 弧半径不得超过玻璃半宽，否则弧段会跑到玻璃外 */
  const clampR = (v: number) => Math.round(Math.min(inner.w / 2, Math.max(1, v)));
  /** 以玻璃底边为弦、向玻璃内凸起的浅弧：半径越大拱高越小（实测 r 比短边 1.51/4.27 等换算） */
  const arcAcrossBottom = (rRaw: number) => {
    const r = Math.round(Math.max(1, rRaw));
    const delta = (Math.asin(Math.min(1, inner.w / 2 / r)) * 180) / Math.PI;
    const cy = inner.y + inner.h + r * Math.cos((delta * Math.PI) / 180);
    arcs.push({
      cx: Math.round(inner.x + inner.w / 2),
      cy: Math.round(cy),
      rMm: r,
      widthMm: BAR_W_ARC,
      startDeg: Math.round(270 - delta),
      sweepDeg: Math.round(2 * delta),
    });
  };

  /** 过玻璃中心的直条，端点解析裁到 inner 矩形（实测射线越界靠裁剪，我们在几何层裁好） */
  const chordThroughCenter = (deg: number, widthMm: number) => {
    const cx = inner.x + inner.w / 2;
    const cy = inner.y + inner.h / 2;
    const a = (deg * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const span = (o: number, d: number, lo: number, hi: number): [number, number] => {
      if (Math.abs(d) < 1e-9) return [-Infinity, Infinity];
      const t1 = (lo - o) / d;
      const t2 = (hi - o) / d;
      return t1 <= t2 ? [t1, t2] : [t2, t1];
    };
    const [tx1, tx2] = span(cx, dx, inner.x, inner.x + inner.w);
    const [ty1, ty2] = span(cy, dy, inner.y, inner.y + inner.h);
    const t0 = Math.max(tx1, ty1);
    const t1 = Math.min(tx2, ty2);
    if (!(t1 > t0)) return;
    lines.push({
      x1: Math.round(cx + dx * t0), y1: Math.round(cy + dy * t0),
      x2: Math.round(cx + dx * t1), y2: Math.round(cy + dy * t1),
      widthMm,
    });
  };

  switch (bars.pattern) {
    case 'colonial':
    case 'chinese':
      putGrid();
      if (bars.pattern === 'chinese') {
        // 中式角花：四角各一段短斜条（20mm）
        const k = Math.round(Math.min(inner.w, inner.h) * 0.18);
        const corners: [number, number, number, number][] = [
          [inner.x, inner.y, inner.x + k, inner.y + k],
          [inner.x + inner.w, inner.y, inner.x + inner.w - k, inner.y + k],
          [inner.x + inner.w, inner.y + inner.h, inner.x + inner.w - k, inner.y + inner.h - k],
          [inner.x, inner.y + inner.h, inner.x + k, inner.y + inner.h - k],
        ];
        for (const [x1, y1, x2, y2] of corners) lines.push({ x1: Math.round(x1), y1: Math.round(y1), x2: Math.round(x2), y2: Math.round(y2), widthMm: BAR_W_STRAIGHT });
      }
      break;
    case 'rect':
      rings.push({ insetMm: Math.round(Math.min(W, H) * 0.12), widthMm: BAR_W_STRAIGHT });
      break;
    case 'diamond': {
      const x0 = inner.x, y0 = inner.y, x1 = inner.x + inner.w, y1 = inner.y + inner.h;
      lines.push(
        { x1: Math.round(x0), y1: Math.round(y0), x2: Math.round(x1), y2: Math.round(y1), widthMm: BAR_W_DIAGONAL },
        { x1: Math.round(x1), y1: Math.round(y0), x2: Math.round(x0), y2: Math.round(y1), widthMm: BAR_W_DIAGONAL },
      );
      break;
    }
    case 'wheel': {
      // 实测 idx10 `wheel`：40 外环 + 一根 10mm 环带，r588/578（≈内框短边一半）
      arcs.push({ cx: Math.round(W / 2), cy: Math.round(H / 2), rMm: clampR(Math.min(inner.w, inner.h) / 2), widthMm: BAR_W_ARC });
      break;
    }
    case 'spoke': {
      // 实测 idx9 `half_wheel`：3 根 20mm 条过玻璃中心向两侧延长（对方靠裁剪），端点裁到内框
      for (const deg of [0, 60, 120]) chordThroughCenter(deg, BAR_W_STRAIGHT);
      break;
    }
    case 'halfWheel': {
      // 我方扩展（半圆环带 + 一根竖向辐条），非实测原样
      const cx = Math.round(inner.x + inner.w / 2), cy = Math.round(inner.y + inner.h * 0.5);
      const r = clampR(Math.min(inner.w, inner.h) * 0.45);
      arcs.push({ cx, cy, rMm: r, widthMm: BAR_W_ARC, startDeg: 0, sweepDeg: 180 });
      lines.push({ x1: cx, y1: cy - r, x2: cx, y2: cy + r, widthMm: BAR_W_ARC });
      break;
    }
    case 'prairie': {
      // 实测 20mm×8：中央方环 4 条 + 到外环四边中点的连接条 4 条
      const k = 0.22;
      const sx = Math.round(inner.x + inner.w * k), sy = Math.round(inner.y + inner.h * k);
      const ex = Math.round(inner.x + inner.w * (1 - k)), ey = Math.round(inner.y + inner.h * (1 - k));
      lines.push(
        { x1: sx, y1: sy, x2: ex, y2: sy, widthMm: BAR_W_STRAIGHT },
        { x1: sx, y1: ey, x2: ex, y2: ey, widthMm: BAR_W_STRAIGHT },
        { x1: sx, y1: sy, x2: sx, y2: ey, widthMm: BAR_W_STRAIGHT },
        { x1: ex, y1: sy, x2: ex, y2: ey, widthMm: BAR_W_STRAIGHT },
        { x1: Math.round(inner.w / 2 + inner.x), y1: inner.y, x2: Math.round(inner.w / 2 + inner.x), y2: sy, widthMm: BAR_W_STRAIGHT },
        { x1: Math.round(inner.w / 2 + inner.x), y1: ey, x2: Math.round(inner.w / 2 + inner.x), y2: Math.round(inner.y + inner.h), widthMm: BAR_W_STRAIGHT },
        { x1: inner.x, y1: Math.round(inner.h / 2 + inner.y), x2: sx, y2: Math.round(inner.h / 2 + inner.y), widthMm: BAR_W_STRAIGHT },
        { x1: ex, y1: Math.round(inner.h / 2 + inner.y), x2: Math.round(inner.x + inner.w), y2: Math.round(inner.h / 2 + inner.y), widthMm: BAR_W_STRAIGHT },
      );
      break;
    }
    case 'rightAngle': {
      // 实测 20mm×4：四条角部直条组成风车式直角花
      const q = 0.25;
      const x25 = Math.round(inner.x + inner.w * q), x75 = Math.round(inner.x + inner.w * (1 - q));
      const y25 = Math.round(inner.y + inner.h * q), y75 = Math.round(inner.y + inner.h * (1 - q));
      lines.push(
        { x1: x25, y1: Math.round(inner.y), x2: x25, y2: y75, widthMm: BAR_W_STRAIGHT },
        { x1: x75, y1: y25, x2: x75, y2: Math.round(inner.y + inner.h), widthMm: BAR_W_STRAIGHT },
        { x1: Math.round(inner.x), y1: y25, x2: x75, y2: y25, widthMm: BAR_W_STRAIGHT },
        { x1: x25, y1: y75, x2: Math.round(inner.x + inner.w), y2: y75, widthMm: BAR_W_STRAIGHT },
      );
      break;
    }
    case 'halfWheel': {
      // 实测弧带 r588/578（带宽 10）+ 直条：下半圆 + 一根竖向辐条
      const cx = Math.round(inner.x + inner.w / 2), cy = Math.round(inner.y + inner.h * 0.5);
      const r = clampR(Math.min(inner.w, inner.h) * 0.45);
      arcs.push({ cx, cy, rMm: r, widthMm: BAR_W_ARC, startDeg: 0, sweepDeg: 180 });
      lines.push({ x1: cx, y1: cy - r, x2: cx, y2: cy + r, widthMm: BAR_W_ARC });
      break;
    }
    case 'innerArc': {
      // 实测同心弧带 r588/578 与 r255/265（带宽均 10）+ 直条 3 根
      const cx = Math.round(inner.x + inner.w / 2), cy = Math.round(inner.y + inner.h);
      const S = Math.min(inner.w, inner.h);
      const r1 = clampR(S * 0.45), r2 = clampR(S * 0.196);
      arcs.push(
        { cx, cy, rMm: r1, widthMm: BAR_W_ARC, startDeg: 180, sweepDeg: 180 },
        { cx, cy, rMm: r2, widthMm: BAR_W_ARC, startDeg: 180, sweepDeg: 180 },
      );
      for (const f of [0.25, 0.5, 0.75]) {
        const x = Math.round(inner.x + inner.w * f);
        lines.push({ x1: x, y1: cy - r1, x2: x, y2: cy, widthMm: BAR_W_ARC });
      }
      break;
    }
    case 'semiArc': {
      // 实测弧带 r746/736（短边比≈0.39）+ 直条 7 根
      const S = Math.min(inner.w, inner.h);
      const r = clampR(S * 0.39);
      const cx = Math.round(inner.x + inner.w / 2), cy = Math.round(inner.y + inner.h);
      arcs.push({ cx, cy, rMm: r, widthMm: BAR_W_ARC, startDeg: 180, sweepDeg: 180 });
      for (let i = 1; i <= 5; i++) {
        const x = Math.round(inner.x + (inner.w * i) / 6);
        lines.push({ x1: x, y1: cy - r, x2: x, y2: cy, widthMm: BAR_W_ARC });
      }
      lines.push(
        { x1: Math.round(inner.x), y1: cy - r, x2: Math.round(inner.x + inner.w), y2: cy - r, widthMm: BAR_W_ARC },
        { x1: Math.round(inner.x), y1: cy - Math.round(r / 2), x2: Math.round(inner.x + inner.w), y2: cy - Math.round(r / 2), widthMm: BAR_W_ARC },
      );
      break;
    }
    case 'quarterArc':
    case 'shallowArc': {
      // 实测 r1965/1975 + r968/978（quarterArc）；shallowArc 为 r5551/5561 + r2733/2743（更浅），直条 4 根
      const S = Math.min(inner.w, inner.h);
      const [rBig, rSmall] = bars.pattern === 'shallowArc' ? [S * 4.27, S * 2.1] : [S * 1.51, S * 0.74];
      arcAcrossBottom(rBig);
      arcAcrossBottom(rSmall);
      for (const f of [0.2, 0.4, 0.6, 0.8]) {
        const x = Math.round(inner.x + inner.w * f);
        lines.push({ x1: x, y1: inner.y, x2: x, y2: Math.round(inner.y + inner.h), widthMm: BAR_W_ARC });
      }
      break;
    }
    case 'doubleArc': {
      // 实测 r598/588（≈短边 0.45）对称双弧 + 直条 5 根
      const S = Math.min(inner.w, inner.h);
      const r = Math.round(S * 0.45);
      arcs.push(
        { cx: Math.round(inner.x), cy: Math.round(inner.y + inner.h), rMm: r, widthMm: BAR_W_ARC, startDeg: 270, sweepDeg: 90 },
        { cx: Math.round(inner.x + inner.w), cy: Math.round(inner.y + inner.h), rMm: r, widthMm: BAR_W_ARC, startDeg: 180, sweepDeg: 90 },
      );
      for (const f of [0.17, 0.34, 0.5, 0.66, 0.83]) {
        const x = Math.round(inner.x + inner.w * f);
        lines.push({ x1: x, y1: inner.y, x2: x, y2: Math.round(inner.y + inner.h), widthMm: BAR_W_ARC });
      }
      break;
    }
    case 'extendableArc': {
      // 实测 r3349/2242（比例 2.58 / 1.72）双浅弧 + 13 根竖条（风琴式）
      const S = Math.min(inner.w, inner.h);
      for (const ratio of [2.58, 1.72]) arcAcrossBottom(S * ratio);
      for (let i = 1; i <= 13; i++) {
        const x = Math.round(inner.x + (inner.w * i) / 14);
        lines.push({ x1: x, y1: inner.y, x2: x, y2: Math.round(inner.y + inner.h), widthMm: BAR_W_ARC });
      }
      break;
    }
    case 'crabapple': {
      // 实测 decoration_bar_crabapple：绕心旋转 ~29° 的方形环带（20mm）+ 6 根 20mm 连接短条
      const S = Math.min(inner.w, inner.h);
      const R = 0.433 * S;
      const rot = (28.9 * Math.PI) / 180;
      const cx = inner.x + inner.w / 2;
      const cy = inner.y + inner.h / 2;
      const cs = [0, 1, 2, 3].map((k) => ({ x: cx + R * Math.cos(rot + (k * Math.PI) / 2), y: cy + R * Math.sin(rot + (k * Math.PI) / 2) }));
      for (let k = 0; k < 4; k++) {
        const a = cs[k];
        const b = cs[(k + 1) % 4];
        lines.push({ x1: Math.round(a.x), y1: Math.round(a.y), x2: Math.round(b.x), y2: Math.round(b.y), widthMm: BAR_W_STRAIGHT });
      }
      const bx0 = Math.min(...cs.map((p) => p.x));
      const bx1 = Math.max(...cs.map((p) => p.x));
      const by0 = Math.min(...cs.map((p) => p.y));
      const by1 = Math.max(...cs.map((p) => p.y));
      const yLeft = cs.reduce((a, p) => (p.x < a.x ? p : a)).y;
      const yRight = cs.reduce((a, p) => (p.x > a.x ? p : a)).y;
      for (const [x1, x2, y] of [
        [inner.x, bx0, yLeft], [inner.x + inner.w, bx1, yLeft],
        [inner.x, bx0, yRight], [inner.x + inner.w, bx1, yRight],
      ] as [number, number, number][]) {
        lines.push({ x1: Math.round(x1), y1: Math.round(y), x2: Math.round(x2), y2: Math.round(y), widthMm: BAR_W_STRAIGHT });
      }
      lines.push(
        { x1: Math.round(cx), y1: Math.round(inner.y), x2: Math.round(cx), y2: Math.round(by0), widthMm: BAR_W_STRAIGHT },
        { x1: Math.round(cx), y1: Math.round(inner.y + inner.h), x2: Math.round(cx), y2: Math.round(by1), widthMm: BAR_W_STRAIGHT },
      );
      break;
    }
  }

  if (bars.topBar) {
    const y = Math.round(inner.y + Math.min(inner.h * 0.22, 220));
    lines.push({ x1: inner.x, y1: y, x2: Math.round(inner.x + inner.w), y2: y, widthMm: BAR_W_STRAIGHT });
  }
  return { rings, lines, arcs };
}
/**
 * 格条逐根下料长度（mm，中心线量取）：环带按 45° 拼角拆 4 根（横根取全宽、竖根扣两端料厚），
 * 直条取端点距离，弧带取中心线弧长。`show:false` 或未配置返回空数组。
 */
export function glassBarCutLengths(w: number, h: number, bars?: GlassBarSpec): number[] {
  const geo = glassBarGeometry(w, h, bars);
  if (!geo) return [];
  const out: number[] = [];
  for (const r of geo.rings) {
    const cw = Math.max(1, w - 2 * r.insetMm);
    const ch = Math.max(1, h - 2 * r.insetMm);
    out.push(Math.round(cw), Math.round(cw), Math.round(ch - r.widthMm), Math.round(ch - r.widthMm));
  }
  for (const l of geo.lines) out.push(Math.round(Math.hypot(l.x2 - l.x1, l.y2 - l.y1)));
  for (const a of geo.arcs) {
    const sweepDeg = a.startDeg === undefined ? 360 : Math.abs(a.sweepDeg ?? 0);
    out.push(Math.round((a.rMm * Math.PI * sweepDeg) / 180));
  }
  return out.filter((v) => v > 0);
}

/**
 * 派生配件（只进 BOM/报价，不写回树数据）：开启扇自动带把手、带格条的分格按逐根长度出格条料。
 * 树模型与装配模型共用，宿主 id 由 ns 加单元前缀。
 */
export function autoFittingsOfTree(tree: WindowTree, ctx: WindowLayoutContext, ns: (id: string) => string): DesignFitting[] {
  const out: DesignFitting[] = [];
  const sashInset = sashWidthOf(tree);
  const boxes = layoutTree(tree, ctx).boxes;
  walkAreas(tree, (area) => {
    const has = (t: FittingType): boolean => (area.fittings ?? []).some((f) => f.type === t);
    const sash = area.sash;
    const leaves = sashLeavesOf(sash);
    // 固定玻璃、显式隐藏把手、或已手工添加过 → 不重复派生
    if (sash && sash.windowType !== 'fixed' && sash.handle?.show !== false && !has('handleHardware')) {
      out.push({ type: 'handleHardware', hostId: ns(area.id), hostKind: 'area', count: sash.windowType === 'sliding' ? 2 : leaves });
    }
    // 对开扇：自动挂中挺锁（已手工添加过同类型就不重复）
    if (sash && leaves === 2 && !has('doubleSashAddon')) {
      out.push({ type: 'doubleSashAddon', hostId: ns(area.id), hostKind: 'area', count: 1 });
    }
    if (!area.bars || has('glassGridAddon')) return;
    const box = boxes.get(area.id);
    if (!box) return;
    const inset = sash ? sashInset : 0;
    const lengthsMm = glassBarCutLengths(Math.max(1, box.w - 2 * inset), Math.max(1, box.h - 2 * inset), area.bars);
    if (lengthsMm.length) out.push({ type: 'glassGridAddon', hostId: ns(area.id), hostKind: 'area', count: lengthsMm.length, lengthsMm });
  });
  return out;
}

export interface SashHandlePlacement {
  cx: number;
  cy: number;
  w: number;
  h: number;
  arm: number;
  /** 夹紧后实际生效的料中心线偏移（mm） */
  offsetMm: number;
  /** 夹紧后实际生效的距扇底高度（mm） */
  fromBottomMm: number;
  /** 画布标注文案 */
  label: string;
}

/**
 * 计算把手在扇上的位置：
 * - 左/右合页 → 把手在自由边竖料上，`offsetMm` 沿料宽方向偏移（0=料中心线），`fromBottomMm` 距扇底；
 * - 上/下合页（悬窗）→ 把手在底横料上，`offsetMm` 变为沿水平方向偏移。
 * 缺省：显示、料中心线、扇高一半。返回值均按扇尺寸夹紧，可直接用于 UI 回填。
 */
export function sashHandlePlacement(
  sashW: number,
  sashH: number,
  sashBarWidth: number,
  handle?: SashHandleSpec,
  hingeSide?: 'left' | 'right' | 'top' | 'bottom',
): SashHandlePlacement | null {
  if (handle?.show === false) return null;
  const w = sashW;
  const h = sashH;
  const bar = Math.max(1, sashBarWidth);
  const hw = HANDLE_W_MM;
  const hh = HANDLE_H_MM;
  const arm = HANDLE_ARM_MM;
  const vertical = hingeSide === 'top' || hingeSide === 'bottom';
  const rawOffset = handle?.offsetMm ?? 0;
  const rawBottom = handle?.fromBottomMm ?? h / 2;

  // 可移动范围 = 扇料边框的长与宽：水平不超过料宽一半，垂直中心可在 [本体高/2, 扇高-本体高/2]
  const maxOffset = vertical ? Math.max(0, w / 2 - hw / 2) : Math.max(0, bar / 2);
  const offsetMm = Math.min(maxOffset, Math.max(-maxOffset, rawOffset));
  const lowLimit = hh / 2;
  const highLimit = Math.max(lowLimit, h - hh / 2);
  const fromBottomMm = Math.min(highLimit, Math.max(lowLimit, rawBottom));

  const cx = vertical ? w / 2 + offsetMm : hingeSide === 'right' ? bar / 2 + offsetMm : w - bar / 2 + offsetMm;
  const cy = h - fromBottomMm;
  const sign = offsetMm >= 0 ? '+' : '';
  return {
    cx,
    cy,
    w: hw,
    h: hh,
    arm,
    offsetMm: Math.round(offsetMm),
    fromBottomMm: Math.round(fromBottomMm),
    label: `执手 ${sign}${Math.round(offsetMm)} / 距底 ${Math.round(fromBottomMm)}`,
  };
}

export function createWindowTree(opts: {
  openingW: number;
  openingH: number;
  seriesId: string;
  glassId: string;
  frameWidthMm: number;
  /** 扇料宽（mm），缺省 = frameWidthMm + SASH_WIDTH_BONUS_MM */
  sashWidthMm?: number;
  /** 中梃料厚（mm），缺省 = DEFAULT_MUNTIN_MM */
  muntinWidthMm?: number;
  /** 新建中梃的默认弧高（mm） */
  muntinSagittaMm?: number;
  name: string;
  /** 异形外框形状（缺省 rect） */
  frameShape?: FrameShape;
  topRatio?: number;
  /** 缺边（开放框/传递窗/落地门洞） */
  frameOpenSides?: FrameSide[];
  /** 自定义外框轮廓（局部坐标，见 WindowTree.frameContour） */
  frameContour?: Pt[];
}): WindowTree {
  return {
    id: randomId(),
    name: opts.name,
    openingW: opts.openingW,
    openingH: opts.openingH,
    seriesId: opts.seriesId,
    glassId: opts.glassId,
    frameWidthMm: opts.frameWidthMm,
    sashWidthMm: opts.sashWidthMm,
    muntinWidthMm: opts.muntinWidthMm,
    muntinSagittaMm: opts.muntinSagittaMm,
    frameShape: opts.frameShape,
    topRatio: opts.topRatio,
    frameOpenSides: opts.frameOpenSides,
    frameContour: opts.frameContour,
    root: { id: randomId(), kind: 'area', xr: 0, yr: 0, wr: 1, hr: 1 },
  };
}

// ── 查找工具 ──────────────────────────────────────────────────

/** 前序遍历全部区域节点 */
export function walkAreas(tree: WindowTree, visit: (area: WindowTreeArea) => void): void {
  const stack: WindowTreeArea[] = tree.root ? [tree.root] : [];
  while (stack.length) {
    const a = stack.pop()!;
    visit(a);
    if (a.children) {
      stack.push(a.children[2], a.children[0]);
    }
  }
}

export function findArea(tree: WindowTree, areaId: string): WindowTreeArea | null {
  let found: WindowTreeArea | null = null;
  walkAreas(tree, (a) => {
    if (a.id === areaId) found = a;
  });
  return found;
}

export function findMuntin(tree: WindowTree, muntinId: string): { muntin: WindowMuntin; area: WindowTreeArea } | null {
  let found: { muntin: WindowMuntin; area: WindowTreeArea } | null = null;
  walkAreas(tree, (a) => {
    if (!a.children) return;
    const m = a.children[1];
    if (m.id === muntinId) found = { muntin: m, area: a };
  });
  return found;
}

// ── 结构操作 ──────────────────────────────────────────────────

/**
 * 分割区域：在指定区域上按方向生成 [子区A, 中梃, 子区B]。
 * 约束：区域必须存在且未分割；比例须在 (MIN_RATIO, 1-MIN_RATIO)。
 * 已放扇的叶子格同样可分（实测 windoorcraft 语义：加一根梃＝拆成两个**独立扇**）——
 * 父格扇规格深拷贝给两侧子格，两侧各自重算扇料/压线/玻璃/把手出料，父格不再挂扇。
 */
export function splitArea(
  tree: WindowTree,
  areaId: string,
  direction: WindowMuntin['direction'],
  ratio: number,
  thicknessMm?: number,
  sagittaMm?: number,
  parentBoxMm?: { w: number; h: number },
): boolean {
  if (!(ratio > MIN_RATIO && ratio < 1 - MIN_RATIO)) return false;
  const area = findArea(tree, areaId);
  if (!area || area.children) return false;
  const thickness = Math.max(1, thicknessMm ?? muntinWidthOf(tree));
  const slope = slopeOf(direction);
  // 斜梃没有弧高语义（弧高只对轴对齐带有意义），且切不动就拒绝——没有"降级成直梃"这种合理退路
  const sag = slope ? 0 : sagittaMm ?? muntinSagittaOf(tree);
  if (slope && parentBoxMm) {
    const cut = clipByDiagonalBand(
      rectPtsOf({ x: 0, y: 0, w: parentBoxMm.w, h: parentBoxMm.h }),
      slope,
      ratio,
      thickness,
    );
    if (!cut) return false;
  }

  const vertical = direction === 'vertical';
  const parentSash = area.sash;
  const leaf = (xr: number, yr: number, wr: number, hr: number): WindowTreeArea => ({
    id: randomId(),
    kind: 'area',
    xr,
    yr,
    wr,
    hr,
    sash: parentSash ? { ...parentSash, handle: parentSash.handle ? { ...parentSash.handle } : undefined } : undefined,
  });
  // 斜梃切出的是三角形/五边形，矩形分数表达不了：这里只存占位，真实包围盒由 layoutTree 按带裁剪算
  const slopeRect: [number, number, number, number] = [0, 0, 1, 1];
  area.children = [
    slope ? leaf(...slopeRect) : leaf(0, 0, vertical ? ratio : 1, vertical ? 1 : ratio),
    {
      id: randomId(),
      kind: 'muntin',
      direction,
      ratio,
      thicknessMm: thickness,
      curve: Math.abs(sag) > 1e-6 ? { sagittaMm: sag } : undefined,
    },
    slope ? leaf(...slopeRect) : leaf(vertical ? ratio : 0, vertical ? 0 : ratio, vertical ? 1 - ratio : 1, vertical ? 1 : 1 - ratio),
  ];
  area.sash = undefined;
  area.label = undefined;
  const right = area.children[2];
  if (right.kind === 'area' && right.sash?.label) {
    const label = nextSashLabel(tree, right.sash.label, right.id) ?? right.sash.label;
    right.sash = { ...right.sash, label };
    right.label = label;
  }
  return true;
}

/** 删除某区域的分割：合并 [子区A, 中梃, 子区B] 还原为单区（构件随子区清除） */
export function removeSplit(tree: WindowTree, areaId: string): boolean {
  const area = findArea(tree, areaId);
  if (!area || !area.children) return false;
  area.children = undefined;
  area.sash = undefined;
  area.label = undefined;
  return true;
}

/**
 * 等分工具：把未分割区域按 n 等分（竖直/水平）生成 n 片叶子。
 * 毫米感知：每层按宿主当前布局宽度反推比例（扣除中梃厚度占位），
 * 使各片可见宽度严格相等（首片让渡半厚）。n ∈ [2..12]；等分后仍可 moveMuntin 微调。
 */
export function equalDivide(
  tree: WindowTree,
  areaId: string,
  direction: WindowMuntin['direction'],
  n: number,
  installGap = DEFAULT_INSTALL_GAP_MM,
): boolean {
  if (!Number.isInteger(n) || n < 2 || n > 12) return false;
  const area = findArea(tree, areaId);
  if (!area || area.children) return false; // 已放扇的格子同样可等分：splitArea 会把扇派生给每一格
  // 斜梃只做二分：多条平行斜带要等分的是"面积"而不是 ratio，且子区已非矩形
  if (slopeOf(direction) && n !== 2) return false;
  const th = muntinWidthOf(tree);
  const rec = (a: WindowTreeArea, count: number): void => {
    if (count <= 1) return;
    const lay = layoutTree(tree, { installGap });
    const box = lay.boxes.get(a.id);
    if (count === 2) {
      // 对称二分天然均等（左右各含半厚）
      splitArea(tree, a.id, direction, 0.5, th, muntinSagittaOf(tree), box && { w: box.w, h: box.h });
      return;
    }
    const span = box ? (direction === 'vertical' ? box.w : box.h) : 1;
    const target = Math.max(1, (span - (count - 1) * th) / count);
    const ratio = Math.min(0.92, Math.max(0.08, (target + th / 2) / span));
    splitArea(tree, a.id, direction, ratio, th, muntinSagittaOf(tree), box && { w: box.w, h: box.h });
    const [, , right] = a.children!;
    rec(right, count - 1);
  };
  rec(area, n);
  return true;
}

/**
 * 扇位标注去重：树内已有同名时按「字母前缀 + 序号」顺延到空号（`A1`→`A2`，无数字后缀的 `WC`→`WC2`）；
 * 无冲突则原样返回。`exceptAreaId` 用于"覆盖同一格原构件"的场景——不该因自身旧标号而改名。
 */
export function nextSashLabel(tree: WindowTree, wanted?: string, exceptAreaId?: string): string | undefined {
  if (!wanted) return undefined;
  const used = new Set<string>();
  walkAreas(tree, (a) => {
    if (a.id !== exceptAreaId && a.sash?.label) used.add(a.sash.label);
  });
  if (!used.has(wanted)) return wanted;
  const m = /^(.*?)(\d*)$/.exec(wanted);
  const prefix = m?.[1] || wanted;
  const tail = m?.[2] ? Number(m[2]) : 1;
  let n = Math.max(used.size + 1, tail + 1);
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

/** 放置构件到叶子区域（已分割的区域不可放；再次放置覆盖原构件，标号冲突时自动顺延） */
export function setSash(tree: WindowTree, areaId: string, spec: WindowSashSpec): boolean {
  const area = findArea(tree, areaId);
  if (!area || area.children) return false;
  const label = nextSashLabel(tree, spec.label, areaId) ?? spec.label;
  area.sash = { ...spec, label };
  area.label = label;
  return true;
}

/** 移除叶子区域的构件 */
export function removeSash(tree: WindowTree, areaId: string): boolean {
  const area = findArea(tree, areaId);
  if (!area || area.children || !area.sash) return false;
  area.sash = undefined;
  area.label = undefined;
  return true;
}

/** 调整中梃位置（比例），随即同步两侧子区比例；厚度占位由 layout 按 mm 精算 */
export function moveMuntin(
  tree: WindowTree,
  muntinId: string,
  newRatio: number,
  parentBoxMm?: { w: number; h: number },
): boolean {
  if (!(newRatio > MIN_RATIO && newRatio < 1 - MIN_RATIO)) return false;
  const found = findMuntin(tree, muntinId);
  if (!found) return false;
  const { muntin, area } = found;
  const slope = slopeOf(muntin.direction);
  if (slope && parentBoxMm) {
    const cut = clipByDiagonalBand(
      rectPtsOf({ x: 0, y: 0, w: parentBoxMm.w, h: parentBoxMm.h }),
      slope,
      newRatio,
      muntin.thicknessMm,
    );
    if (!cut) return false;
  }

  muntin.ratio = newRatio;
  if (area.children && !slope) {
    const [a1, , a2] = area.children;
    if (muntin.direction === 'vertical') {
      a1.wr = newRatio;
      a2.xr = newRatio;
      a2.wr = 1 - newRatio;
    } else {
      a1.hr = newRatio;
      a2.yr = newRatio;
      a2.hr = 1 - newRatio;
    }
  }
  return true;
}

// ── 几何布局 ──────────────────────────────────────────────────

export interface WindowLayoutContext {
  /** 安装间隙（mm），外框相对洞口的缩进 */
  installGap: number;
}

export interface WindowLayoutResult {
  /** 外框绝对矩形（mm） */
  frame: WindowBox;
  /** 节点 id → 绝对矩形（mm）：area / muntin / sash 节点 */
  boxes: Map<string, WindowBox>;
}

/**
 * 计算容器树全部节点的绝对几何（mm）。
 * 外框外轮廓 = 洞口内缩 installGap；内腔 = 外框再缩 frameWidthMm；root 区域即内腔。
 * 分割时中梃按厚度占位，两侧子区依次排布。
 */
export function layoutTree(tree: WindowTree, ctx: WindowLayoutContext): WindowLayoutResult {
  const ox = tree.offsetX ?? 0;
  const oy = tree.offsetY ?? 0;
  const frame: WindowBox = {
    x: ctx.installGap + ox,
    y: ctx.installGap + oy,
    w: Math.max(1, tree.openingW - 2 * ctx.installGap),
    h: Math.max(1, tree.openingH - 2 * ctx.installGap),
  };
  const boxes = new Map<string, WindowBox>();
  if (!tree.root) return { frame, boxes };

  const inner: WindowBox = {
    x: frame.x + tree.frameWidthMm,
    y: frame.y + tree.frameWidthMm,
    w: Math.max(1, frame.w - 2 * tree.frameWidthMm),
    h: Math.max(1, frame.h - 2 * tree.frameWidthMm),
  };

  const layoutArea = (area: WindowTreeArea, parent: WindowBox): void => {
    // area 的几何即传入的精确矩形：根 = 内腔；子区由分割公式推导
    boxes.set(area.id, parent);

    if (!area.children) return;
    const [a1, m, a2] = area.children;
    const slope = slopeOf(m.direction);
    if (slope) {
      // 斜梃：子区是三角形/五边形，矩形分数不可用 → 按带裁剪取真实包围盒
      const cut = clipByDiagonalBand(rectPtsOf(parent), slope, m.ratio, m.thicknessMm);
      if (cut) {
        boxes.set(m.id, bBoxOf(cut.muntin));
        layoutArea(a1, bBoxOf(cut.a));
        layoutArea(a2, bBoxOf(cut.b));
        return;
      }
      boxes.set(m.id, { ...parent });
      layoutArea(a1, { ...parent });
      layoutArea(a2, { ...parent });
      return;
    }
    const vertical = m.direction === 'vertical';
    if (vertical) {
      const cx = parent.x + parent.w * m.ratio;
      const half = m.thicknessMm / 2;
      boxes.set(m.id, { x: cx - half, y: parent.y, w: m.thicknessMm, h: parent.h });
      layoutArea(a1, { x: parent.x, y: parent.y, w: cx - half - parent.x, h: parent.h });
      layoutArea(a2, { x: cx + half, y: parent.y, w: parent.x + parent.w - (cx + half), h: parent.h });
    } else {
      const cy = parent.y + parent.h * m.ratio;
      const half = m.thicknessMm / 2;
      boxes.set(m.id, { x: parent.x, y: cy - half, w: parent.w, h: m.thicknessMm });
      layoutArea(a1, { x: parent.x, y: parent.y, w: parent.w, h: cy - half - parent.y });
      layoutArea(a2, { x: parent.x, y: cy + half, w: parent.w, h: parent.y + parent.h - (cy + half) });
    }
  };

  layoutArea(tree.root, inner);
  return { frame, boxes };
}

/** 外框绝对矩形（mm）= 洞口内缩安装间隙 */
function frameBoxOf(tree: WindowTree, ctx: WindowLayoutContext): WindowBox {
  const ox = tree.offsetX ?? 0;
  const oy = tree.offsetY ?? 0;
  return {
    x: ctx.installGap + ox,
    y: ctx.installGap + oy,
    w: Math.max(1, tree.openingW - 2 * ctx.installGap),
    h: Math.max(1, tree.openingH - 2 * ctx.installGap),
  };
}

/**
 * 异形外框的轮廓布局（world mm，闭合多边形）：
 * 返回节点 id → 轮廓。root 与全部叶子/容器区域的轮廓由外框形状经 clipByAxis 递归裁剪得到；
 * 中梃 = 两条平行线之间的带。矩形外框（frameShape 缺省）轮廓退化为矩形，等价于 boxes。
 * 渲染 / 描述 / 吸附统一读这里，保证分割几何与矩形布局 boxes 语义一致。
 */
export function layoutContours(tree: WindowTree, ctx: WindowLayoutContext): Map<string, Pt[]> {
  const map = new Map<string, Pt[]>();
  const frame = frameBoxOf(tree, ctx);
  const shape = tree.frameShape ?? 'rect';
  const framePts = tree.frameContour && tree.frameContour.length >= 3
    ? tree.frameContour.map((p) => ({ x: frame.x + p.x, y: frame.y + p.y }))
    : sampleOutline(shape, frame, { inset: 0, topRatio: tree.topRatio });
  // 内腔轮廓：legacy 质心内缩语义（凸形状近似等距）
  const inner = insetPolygon(framePts, tree.frameWidthMm);

  const rec = (area: WindowTreeArea, parentPts: Pt[]): void => {
    map.set(area.id, parentPts);
    if (!area.children) return;
    const [a1, m, a2] = area.children;
    const slope = slopeOf(m.direction);
    const r = slope
      ? clipByDiagonalBand(parentPts, slope, m.ratio, m.thicknessMm)
      : (m.curve ? clipByArcBand(parentPts, m.direction as 'vertical' | 'horizontal', m.ratio, m.thicknessMm, m.curve.sagittaMm) : null) ??
        clipByAxis(parentPts, m.direction as 'vertical' | 'horizontal', m.ratio, m.thicknessMm);
    if (!r) return; // 退化分割：子区沿用父轮廓（视觉兜底，不崩溃）
    map.set(m.id, r.muntin);
    rec(a1, r.a);
    rec(a2, r.b);
  };

  if (tree.root) rec(tree.root, inner);
  return map;
}

/** 树里是否存在弧梃（决定描述层是否需要按轮廓渲染子区） */
export function treeHasCurvedMuntin(tree: WindowTree): boolean {
  let found = false;
  walkAreas(tree, (a) => {
    if (a.children?.[1]?.curve) found = true;
  });
  return found;
}

/** 树里是否存在斜梃（子区已非轴对齐矩形，必须走轮廓路径） */
export function treeHasSlopeMuntin(tree: WindowTree): boolean {
  let found = false;
  walkAreas(tree, (a) => {
    if (slopeOf(a.children?.[1]?.direction ?? 'horizontal')) found = true;
  });
  return found;
}

/** 描述/出料层是否需要按轮廓而非矩形 box 渲染子区与中梃 */
export function treeNeedsContours(tree: WindowTree): boolean {
  return (
    (!!tree.frameContour && tree.frameContour.length >= 3) ||
    treeHasCurvedMuntin(tree) ||
    treeHasSlopeMuntin(tree)
  );
}

// ── 树 → DesignModel 转换（复用既有 BOM/报价/校验链路） ──────

export interface TreeToDesignOptions {
  installGap: number;
  name: string;
  seriesId: string;
  glassId: string;
}

/** 树 → 平铺 DesignModel（外框 + 中梃 + 各叶构件），全部构件父级为外框 */
export function toDesignComponents(
  tree: WindowTree,
  ctx: TreeToDesignOptions,
  namespace?: string,
): DesignComponent[] {
  const ns = (id: string): string => (namespace ? `${namespace}:${id}` : id);
  const layout = layoutTree(tree, { installGap: ctx.installGap });
  const frameId = ns('frame');
  const shape = tree.frameShape ?? 'rect';
  const contours = layoutContours(tree, { installGap: ctx.installGap });
  // 自定义轮廓必须按外轮廓输出（旧方案迁移保真）；沿用形状采样的路径保持原口径（内腔轮廓）不变
  const customFrameContour = tree.frameContour && tree.frameContour.length >= 3
    ? tree.frameContour.map((p) => ({ x: p.x + layout.frame.x, y: p.y + layout.frame.y }))
    : null;
  const frameContour = customFrameContour ?? (shape !== 'rect' && tree.root ? contours.get(tree.root.id) : undefined);
  const frameComponent: DesignComponent = {
    id: frameId,
    kind: 'outerFrame',
    x: Math.round(layout.frame.x),
    y: Math.round(layout.frame.y),
    w: Math.round(layout.frame.w),
    h: Math.round(layout.frame.h),
    shape,
    topRatio: shape === 'trapezoid' ? tree.topRatio : undefined,
    openSides: frameOpenSidesOf(tree).length ? frameOpenSidesOf(tree) : undefined,
    contour: frameContour?.flatMap((p) => [p.x, p.y]),
    label: tree.name,
  };
  const components: DesignComponent[] = [frameComponent];

  const flush = (nodeId: string) => {
    const box = layout.boxes.get(nodeId);
    if (!box) return null;
    return {
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.max(1, Math.round(box.w)),
      h: Math.max(1, Math.round(box.h)),
    };
  };

  // 异形框 / 弧梃 / 斜梃时，子区与中梃都要带轮廓（矩形直梃沿用 box 解析路径，数字不变）
  const useContours = shape !== 'rect' || treeNeedsContours(tree);

  walkAreas(tree, (area) => {
    if (area.children) {
      const m = area.children[1];
      const r = flush(m.id);
      if (!r) return;
      const mc = useContours ? contours.get(m.id) : undefined;
      const slope = slopeOf(m.direction);
      // 弧带真按弧切开时轮廓才带采样点；回退成直线带（4 点）不算弧长，避免行名与长度错配
      const isArcBand = !!m.curve && !!mc && mc.length > 8;
      // 斜带必须是真斜带（退化回矩形带时轮廓只有 4 点且方向仍按 box 算）
      const isSlopeBand = !!slope && !!mc && bandIsOblique(mc);
      components.push({
        id: ns(m.id),
        kind: 'mullion',
        ...r,
        parentId: frameId,
        windowType: 'fixed',
        slope: isSlopeBand ? slope : undefined,
        thicknessMm: m.thicknessMm,
        sagittaMm: m.curve?.sagittaMm,
        contour: mc ? mc.flatMap((p) => [p.x, p.y]) : undefined,
        // 非轴对齐带的中心线长 = 闭合轮廓周长/2 − 料厚（弧带与斜带同一公式）
        arcLenMm:
          isArcBand || isSlopeBand ? Math.max(1, Math.round(polygonLen(mc!) / 2 - m.thicknessMm)) : undefined,
      });
      return;
    }
    if (!area.sash) return;
    const r = flush(area.id);
    if (!r) return;
    const spec = area.sash;
    const role = spec.roleType ? resolveComponentType(spec.roleType) : null;
    components.push({
      id: ns(area.id),
      kind: (role?.kind as DesignComponent['kind']) ?? kindFromSashType(spec.windowType),
      ...r,
      parentId: frameId,
      windowType: spec.windowType === 'screen' ? undefined : spec.windowType,
      roleType: spec.roleType,
      hingeSide: spec.hingeSide,
      openDirection: spec.openDirection,
      label: spec.label,
      leaves: sashLeavesOf(spec) === 2 ? 2 : undefined,
      meetingWidthMm: sashLeavesOf(spec) === 2 ? meetingWidthOf(tree) : undefined,
      infill: sashInfillOf(spec) === 'glass' ? undefined : sashInfillOf(spec),
      panelHeightMm: sashInfillOf(spec) === 'panel' ? panelHeightOf(tree) : undefined,
      contour: useContours ? contours.get(area.id)?.flatMap((p) => [p.x, p.y]) : undefined,
    });
  });

  return components;
}

export function toDesignModel(tree: WindowTree, ctx: TreeToDesignOptions): DesignModel {
  const frameId = 'frame';
  const fittings: DesignFitting[] = [];
  for (const f of tree.fittings ?? []) {
    fittings.push({ type: f.type, hostId: frameId, hostKind: 'tree', hostLabel: tree.name, count: f.count, side: f.side });
  }
  walkAreas(tree, (area) => {
    for (const f of area.fittings ?? []) {
      fittings.push({ type: f.type, hostId: area.id, hostKind: 'area', count: f.count, side: f.side });
    }
  });
  fittings.push(...autoFittingsOfTree(tree, { installGap: ctx.installGap }, (id) => id));
  return {
    id: tree.id,
    name: tree.name,
    openingW: tree.openingW,
    openingH: tree.openingH,
    seriesId: ctx.seriesId,
    glassId: ctx.glassId,
    components: toDesignComponents(tree, ctx),
    fittings: fittings.length ? fittings : undefined,
  };
}

export function kindFromSashType(type: SashType): DesignComponent['kind'] {
  switch (type) {
    case 'fixed':
      return 'fixedGlass';
    case 'casement':
    case 'casementUp':
    case 'tiltSlide':
      return 'casementSash';
    case 'sliding':
      return 'slidingSash';
    case 'topHinged':
      return 'topHungSash';
    case 'screen':
      return 'screen';
    default:
      return 'fixedGlass';
  }
}
