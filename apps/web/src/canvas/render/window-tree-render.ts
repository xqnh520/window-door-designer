import Konva from 'konva';
import type { WindowTree, WindowSashSpec, FrameSide } from '@wdd/core';
import { describeWindowTree, type TreeRenderElement } from '@wdd/core';
import type { Pt } from '@wdd/core';
import { describeOutlineFrameVisual } from './outline-frame-visual';
import { paintPanelBead, paintSashBead, paintScreenBead } from './painters/bead';
import { paintDecorBar, paintFakeMullion, paintSashMullion, paintScreenMullion } from './painters/decor';
import { paintFoldSash, paintFoldScreen } from './painters/fold';
import { paintPushIn, paintSashInSash, paintSubSash } from './painters/sash-composite';
import { paintFrostedGlass, paintSecurityBar, paintSecurityFrame, paintWaterGuard } from './painters/security';

/**
 * 容器树 → Konva 物化（浏览器 shape 层使用）：
 * 由 describeWindowTree 输出元素描述，逐条创建 Konva.Group。
 * 每个逻辑节点（外框 / 中梃 / 叶子）为独立 Group，携带 id 与 name(kind)，
 * 供命中测试、选中高亮与编辑工具使用。
 * 注意：本文件依赖 Konva，仅浏览器/具备 canvas 环境使用；纯逻辑测试面向描述层。
 */

export interface WindowTreeRenderOptions {
  installGap: number;
  /** 压线视觉宽（mm）：真实取系列 beadWidth，缺省 15 */
  beadWidthMm?: number;
  /** 压线拼接方式：miter=四角 45° 斜连接（默认），butt=直边搭接收口 */
  beadJoint?: 'miter' | 'butt';
  showLabels?: boolean;
  colors?: {
    frame?: string;
    glass?: string;
    sash?: string;
    screen?: string;
    panel?: string;
    inner?: string;
    bead?: string;
  };
}

export interface WindowTreeRenderResult {
  /** 根渲染组（绝对坐标 0,0，挂在 shape 层） */
  group: Konva.Group;
  /** 节点 id → 渲染组（'frame' 外框 / muntin.id 中梃 / area.id 叶子） */
  nodes: Map<string, Konva.Group>;
  /** 外框组（含绝对 position） */
  frame: Konva.Group;
}

const DEFAULT_COLORS = {
  frame: '#636568',
  glass: '#D3DDDA',
  sash: '#7B7F81',
  screen: '#e9ebee',
  panel: '#f9f8f7',
  inner: '#f0edea',
  bead: '#aeb3b6',
};

/** 压线构件绘制配置（由 renderWindowTree 归一化后逐元素传递） */
interface BeadConfig {
  widthMm: number;
  joint: 'miter' | 'butt';
}

export function renderWindowTree(tree: WindowTree, opts: WindowTreeRenderOptions): WindowTreeRenderResult {
  const colors = { ...DEFAULT_COLORS, ...opts.colors };
  const showLabels = opts.showLabels !== false;
  const bead: BeadConfig = { widthMm: opts.beadWidthMm ?? 15, joint: opts.beadJoint ?? 'miter' };

  const group = new Konva.Group({ listening: true });
  const nodes = new Map<string, Konva.Group>();

  for (const el of describeWindowTree(tree, opts.installGap)) {
    const g = new Konva.Group({ id: el.id, name: el.kind });
    g.position({ x: el.x, y: el.y });
    drawElement(g, el, colors, showLabels, bead);
    const fc = el.fittingCount ?? 0;
    if (fc > 0) {
      const r = Math.max(9, Math.min(22, Math.min(el.w, el.h) / 16));
      const badge = el.points && el.contentAnchor
        ? { x: el.contentAnchor.x, y: Math.max(r + 3, el.contentAnchor.y - el.h * 0.18) }
        : { x: el.w - r - 3, y: r + 3 };
      drawFittingBadge(g, badge.x, badge.y, r, fc);
    }
    group.add(g);
    nodes.set(el.id, g);
    if (el.kind === 'frame') {
      // frame 保持引用（数据结构对齐既有约定）
    }
  }

  const frame = nodes.get('frame')!;
  return { group, nodes, frame };
}

// ── 元素绘制 ─────────────────────────────────────────────────

function drawElement(
  g: Konva.Group,
  el: TreeRenderElement,
  colors: Required<typeof DEFAULT_COLORS>,
  showLabels: boolean,
  bead: BeadConfig,
): void {
  const pts = el.points ? toPts(el.points) : undefined;
  const inset = el.sashInsetMm ?? 0;
  // 构件体系扩展：roleType 存在时走注册类型绘制（windoorcraft 对齐），否则旧 switch 兼容
  if (el.sash?.roleType) {
    drawRoleType(g, el, el.sash.roleType, colors, inset, pts);
  } else {
    drawLegacyElement(g, el, colors, inset, pts, bead);
  }

  // 压线构件：围绕矩形玻璃宿主绘制（与下料 dm-bead-{areaId} 同一宿主，可选中/命中）
  // 异形/弧/格子子区（有 pts 轮廓）与 roleType 装饰构件、纱窗/空/百叶不在此出压线
  if (!pts && !el.sash?.roleType && el.kind === 'area') {
    const hasGlass = el.type === 'fixed' || (!!el.sash && el.sashInfill !== 'louver' && el.sashInfill !== 'panel');
    if (hasGlass) {
      const pane =
        el.type === 'fixed'
          ? { x: 0, y: 0, w: el.w, h: el.h }
          : { x: inset, y: inset, w: el.w - 2 * inset, h: el.h - 2 * inset };
      drawBeadRing(g, pane, bead, colors, el.id);
    }
  }

  // 叶子分格统一追加：把手（开启扇自动带）+ 玻璃格条（装饰条）——覆盖 roleType 与 legacy 两条路径
  if (el.kind === 'area') {
    if (el.sash) drawSashHandle(g, el);
    drawGlassBars(g, el, el.sash ? inset : 0);
  }

  if (showLabels && el.label) {
    // 带轮廓的子区（异形框 / 弧梃切出的格）按面积质心定位，否则沿用包围盒中心
    const anchor = el.contentAnchor ?? { x: el.w / 2, y: el.h / 2 };
    g.add(
      new Konva.Text({
        x: anchor.x - el.w / 2,
        y: anchor.y - el.h / 2,
        width: el.w,
        height: el.h,
        align: 'center',
        verticalAlign: 'middle',
        text: el.label,
        fontSize: Math.max(14, Math.round(Math.min(el.w, el.h) / 14)),
        fontStyle: 'bold',
        fill: '#000000',
        listening: false,
      }),
    );
  }
}

/** 配件角标：在宿主组内画一个橙色小圆徽章 + 白色数量（world mm，非交互，不干扰命中） */
export function drawFittingBadge(g: Konva.Group, cx: number, cy: number, radius: number, count: number): void {
  g.add(
    new Konva.Circle({
      x: cx,
      y: cy,
      radius,
      fill: '#fa8c16',
      stroke: '#ffffff',
      strokeWidth: Math.max(1, radius / 6),
      listening: false,
    }),
  );
  g.add(
    new Konva.Text({
      x: cx - radius,
      y: cy - radius,
      width: radius * 2,
      height: radius * 2,
      text: String(count),
      align: 'center',
      verticalAlign: 'middle',
      fontSize: Math.round(radius * 1.15),
      fontStyle: 'bold',
      fill: '#ffffff',
      listening: false,
    }),
  );
}

interface LegacyPainterContext {
  group: Konva.Group;
  element: TreeRenderElement;
  colors: Required<typeof DEFAULT_COLORS>;
  insetMm: number;
  points?: Pt[];
  sashGlassPoints?: Pt[];
  bead: BeadConfig;
}

type LegacyPainter = (context: LegacyPainterContext) => void;
type LegacyElementType = Exclude<TreeRenderElement['type'], 'combiner'>;

/** 基础构件/开启方式的唯一 painter 注册表；新增类型未注册时由 TypeScript 直接报错。 */
const LEGACY_PAINTERS: Record<LegacyElementType, LegacyPainter> = {
  frame: paintFrame,
  muntin: paintMuntin,
  empty: paintEmpty,
  fixed: paintFixed,
  casement: paintCasement,
  casementUp: paintCasement,
  tiltSlide: paintTiltSlide,
  sliding: paintSliding,
  topHinged: paintTopHinged,
  screen: paintScreen,
};

function drawLegacyElement(
  group: Konva.Group,
  element: TreeRenderElement,
  colors: Required<typeof DEFAULT_COLORS>,
  insetMm: number,
  points: Pt[] | undefined,
  bead: BeadConfig,
): void {
  // combiner 由 window-assembly-render 独立物化，不进入单窗 painter。
  if (element.type === 'combiner') return;
  LEGACY_PAINTERS[element.type]({
    group,
    element,
    colors,
    insetMm,
    points,
    sashGlassPoints: element.sashGlassPoints ? toPts(element.sashGlassPoints) : points,
    bead,
  });
}

function paintFrame({ group, element, colors, points, bead }: LegacyPainterContext): void {
  const frameWidth = element.frameWidthMm ?? Math.min(element.w, element.h);
  if (points && element.points) drawOutlineFrame(group, element.points, frameWidth, colors, bead, element.id);
  else drawFrameParts(group, element.w, element.h, frameWidth, colors, element.openSides);
}

function paintMuntin({ group, element, colors, points }: LegacyPainterContext): void {
  if (points) {
    group.add(new Konva.Line({ points: element.points, closed: true, fill: colors.frame, stroke: 'rgba(0,0,0,0.25)', strokeWidth: 1, listening: true }));
    return;
  }
  group.add(new Konva.Rect({
    width: element.w,
    height: element.h,
    fill: colors.frame,
    stroke: 'rgba(0,0,0,0.25)',
    strokeWidth: 1,
    cornerRadius: Math.min(3, element.w / 2, element.h / 2),
  }));
}

function paintEmpty({ group, element, colors, points }: LegacyPainterContext): void {
  if (points) group.add(new Konva.Line({ points: element.points, closed: true, fill: colors.panel, stroke: 'rgba(0,0,0,0.08)', strokeWidth: 1, listening: true }));
  else group.add(new Konva.Rect({ width: element.w, height: element.h, fill: colors.panel, stroke: 'rgba(0,0,0,0.08)', strokeWidth: 1 }));
}

function paintFixed({ group, element, colors, points }: LegacyPainterContext): void {
  if (points) group.add(new Konva.Line({ points: element.points, closed: true, fill: colors.glass, stroke: 'rgba(0,0,0,0.12)', strokeWidth: 1, listening: true }));
  else group.add(new Konva.Rect({ width: element.w, height: element.h, fill: colors.glass, stroke: 'rgba(0,0,0,0.12)', strokeWidth: 1 }));
}

function paintCasement({ group, element, colors, insetMm, points, sashGlassPoints }: LegacyPainterContext): void {
  const tilted = element.type === 'casementUp';
  if (element.sashInfill === 'louver') {
    if (element.sashLeaves === 2) drawDoubleSash(group, element, colors, insetMm, tilted);
    else if (points) {
      drawPolySash(group, points, sashGlassPoints ?? points, colors);
      drawSlatsClippedToPane(group, element, insetMm);
    } else drawSashAndGlass(group, element.w, element.h, colors, insetMm, tilted, { louver: element.louver });
    if (element.sashLeaves !== 2) drawShadeMarks(group, element.w, element.h, insetMm);
    return;
  }
  if (element.sashInfill === 'panel') {
    if (element.sashLeaves === 2) drawDoubleSash(group, element, colors, insetMm, tilted);
    else {
      drawSashAndGlass(group, element.w, element.h, colors, insetMm, tilted, { panel: element.panel });
      drawOpeningMark(group, element.w, element.h, insetMm, element.sash?.hingeSide ?? 'left', element.sash?.openDirection ?? 'out');
    }
    return;
  }
  if (element.sashLeaves === 2) drawDoubleSash(group, element, colors, insetMm, tilted);
  else if (points) {
    drawPolySash(group, points, sashGlassPoints ?? points, colors);
    drawOpeningMark(group, element.w, element.h, insetMm, element.sash?.hingeSide ?? 'left', element.sash?.openDirection ?? 'out');
  } else {
    drawSashAndGlass(group, element.w, element.h, colors, insetMm, tilted);
    drawOpeningMark(group, element.w, element.h, insetMm, element.sash?.hingeSide ?? 'left', element.sash?.openDirection ?? 'out');
  }
}

function paintTiltSlide({ group, element, colors, insetMm }: LegacyPainterContext): void {
  drawTiltSlide(group, element.w, element.h, colors, insetMm);
}

function paintSliding({ group, element, colors, insetMm, points, sashGlassPoints }: LegacyPainterContext): void {
  if (points) drawPolySash(group, points, sashGlassPoints ?? points, colors);
  else drawSliding(group, element.w, element.h, colors, insetMm);
}

function paintTopHinged({ group, element, colors, insetMm, points, sashGlassPoints }: LegacyPainterContext): void {
  if (points) drawPolySash(group, points, sashGlassPoints ?? points, colors);
  else drawSashAndGlass(group, element.w, element.h, colors, insetMm, false);
  drawTopHinge(group, element.w, element.h, insetMm);
}

function paintScreen({ group, element, colors, points, sashGlassPoints }: LegacyPainterContext): void {
  if (element.sashLeaves === 2) {
    for (const leaf of element.sashLeafGeometries ?? []) {
      const leafGroup = new Konva.Group({ x: leaf.x, y: leaf.y });
      drawScreen(leafGroup, leaf.w, leaf.h, colors);
      group.add(leafGroup);
    }
  } else if (points) drawPolySash(group, points, sashGlassPoints ?? points, colors);
  else drawScreen(group, element.w, element.h, colors);
}

interface RolePainterContext {
  group: Konva.Group;
  element: TreeRenderElement;
  role: string;
  colors: Required<typeof DEFAULT_COLORS>;
  insetMm: number;
  points?: Pt[];
}

type RolePainter = (context: RolePainterContext) => void;

/**
 * 构件体系的显式 painter 注册表。
 * 新 role 先在此登记，再逐步把实现从 legacy dispatcher 拆到独立 painter 文件。
 */
const ROLE_PAINTERS: Record<string, RolePainter> = {};
ROLE_PAINTERS.frostedGlass = paintFrostedGlass;
ROLE_PAINTERS.securityFrame = paintSecurityFrame;
ROLE_PAINTERS.securityBar = paintSecurityBar;
ROLE_PAINTERS.waterGuard = paintWaterGuard;
ROLE_PAINTERS.decorBar = paintDecorBar;
ROLE_PAINTERS.fakeMullion = paintFakeMullion;
ROLE_PAINTERS.sashMullion = paintSashMullion;
ROLE_PAINTERS.screenMullion = paintScreenMullion;
ROLE_PAINTERS.subSash = paintSubSash;
ROLE_PAINTERS.sashInSash = paintSashInSash;
ROLE_PAINTERS.pushIn = paintPushIn;
ROLE_PAINTERS.foldSash = paintFoldSash;
ROLE_PAINTERS.foldScreen = paintFoldScreen;
ROLE_PAINTERS.sashBead = paintSashBead;
ROLE_PAINTERS.screenBead = paintScreenBead;
ROLE_PAINTERS.panelBead = paintPanelBead;

function drawRoleType(
  g: Konva.Group,
  el: TreeRenderElement,
  role: string,
  colors: Required<typeof DEFAULT_COLORS>,
  inset: number,
  pts: Pt[] | undefined,
): void {
  const local = pts ? flatOf(pts) : [0, 0, el.w, 0, el.w, el.h, 0, el.h];
  // 所有角色共用透明命中区，视觉 painter 不承担交互元数据。
  g.add(new Konva.Line({ points: local, closed: true, fill: 'transparent', listening: true }));
  const painter = ROLE_PAINTERS[role] ?? ROLE_PAINTERS.fallback;
  painter({ group: g, element: el, role, colors, insetMm: inset, points: pts });
}

ROLE_PAINTERS.fallback = ({ group, element, colors, points }: RolePainterContext): void => {
  const local = points ? flatOf(points) : [0, 0, element.w, 0, element.w, element.h, 0, element.h];
  group.add(new Konva.Line({ points: local, closed: true, fill: colors.panel, stroke: 'rgba(0,0,0,0.15)', strokeWidth: 1, listening: false }));
};

const toPts = (flat: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
};

const flatOf = (pts: Pt[]): number[] => pts.flatMap((p) => [p.x, p.y]);

/**
 * 异形外框：外轮廓填充框料色 + 内腔轮廓（质心内缩 frameWidth）填充内腔色，形成闭合环。
 * 内腔可点击（空白窗命中用于平移选中）。
 * 另沿外轮廓包围盒四边补 4 条透明命中带（data-edge），让异形外框与矩形外框一样可逐边拖拽调洞口尺寸：
 * resizeTreeEdge 的 frame 分支按包围盒求解（与形状无关），故只需提供带 data-edge 的命中区即可复用既有拖拽链路。
 */
function drawOutlineFrame(g: Konva.Group, flatPts: number[], fw: number, colors: Required<typeof DEFAULT_COLORS>, bead: BeadConfig, hostId: string): void {
  const visual = describeOutlineFrameVisual(flatPts, fw, bead.widthMm);
  g.add(
    new Konva.Line({ points: visual.outerPoints, closed: true, fill: colors.frame, stroke: 'rgba(0,0,0,0.5)', strokeWidth: 1, strokeScaleEnabled: false, listening: false }),
  );
  g.add(
    new Konva.Line({ points: visual.innerPoints, closed: true, fill: colors.inner, stroke: 'rgba(0,0,0,0.3)', strokeWidth: 1, strokeScaleEnabled: false, listening: true }),
  );
  // 压线带：沿内腔玻璃边界的一圈扣条（异形框），粗 = beadWidth，可点选/命中并映射到宿主下料
  const beadRing = new Konva.Line({
    points: visual.beadCenterPoints,
    closed: true,
    stroke: colors.bead,
    strokeWidth: visual.beadWidthMm,
    fill: undefined,
    hitStrokeWidth: visual.beadWidthMm,
    listening: true,
  });
  beadRing.name('bead');
  beadRing.setAttr('data-bead-host', hostId);
  g.add(beadRing);
  // 压线内缘描边（恒定像素）：勾出扣条内边界，与矩形路径一致的拼缝观感
  g.add(
    new Konva.Line({ points: visual.beadInnerPoints, closed: true, stroke: 'rgba(0,0,0,0.5)', strokeWidth: 1, strokeScaleEnabled: false, fill: undefined, listening: false }),
  );
  // 四边透明命中带（厚 = 框料宽），供逐边拖拽；加在内腔之后 → 周边命中优先于内腔平移
  for (const band of visual.edgeBands) {
    const r = new Konva.Rect({
      x: band.x,
      y: band.y,
      width: Math.max(1, band.w),
      height: Math.max(1, band.h),
      fill: 'transparent',
      listening: true,
    });
    r.setAttr('data-edge', band.edge);
    g.add(r);
  }
}

/** 异形叶子内的扇/玻璃绘制：外轮廓与内缩玻璃轮廓均由 core 描述层给出。 */
function drawPolySash(g: Konva.Group, pts: Pt[], glass: Pt[], colors: Required<typeof DEFAULT_COLORS>): void {
  g.add(new Konva.Line({ points: flatOf(pts), closed: true, fill: colors.sash, stroke: 'rgba(0,0,0,0.5)', strokeWidth: 1, strokeScaleEnabled: false, listening: true }));
  g.add(new Konva.Line({ points: flatOf(glass), closed: true, fill: colors.glass, stroke: 'rgba(0,0,0,0.4)', strokeWidth: 1, strokeScaleEnabled: false, listening: false }));
}

/**
 * 外框 = 四根独立框料（顶/底/左/右）以 45° 斜角拼接成环，内腔居中：
 * 每根料为独立梯形（closed Line）并携带 data-edge，供画布按料命中/选中/拖拽调整；
 * 四角拼接缝用黑色斜线绘制（外角 → 内角）。
 */
function drawFrameParts(g: Konva.Group, w: number, h: number, fw: number, colors: Required<typeof DEFAULT_COLORS>, open?: FrameSide[]): void {
  const isOpen = (side: FrameSide): boolean => !!open?.includes(side);
  if (fw <= 0 || fw * 2 >= Math.min(w, h)) {
    // 退化保护：框宽参数异常时整体填充
    g.add(new Konva.Rect({ width: w, height: h, fill: colors.frame, listening: false }));
    return;
  }
  // 外框 = 四根独立框料拼成环（压线不在此绘制：压线属玻璃宿主构件，由 drawBeadRing 围绕玻璃绘制，与下料 dm-bead-* 同源）
  // 内腔（可点：空白窗也能命中用于平移选中）——内缘描边恒定像素，勾出框料内边界
  g.add(new Konva.Rect({ x: fw, y: fw, width: w - 2 * fw, height: h - 2 * fw, fill: colors.inner, stroke: 'rgba(0,0,0,0.28)', strokeWidth: 1, strokeScaleEnabled: false, listening: true }));
  // 四根框料：45° 斜角梯形，四角严丝合缝拼成环（可单独命中/拖拽）；缺边则不画该根
  // 每根料独立描边（恒定像素）→ 相邻料之间形成清晰拼缝，读作装配而非整块
  const bar = (pts: number[], edge: 'top' | 'bottom' | 'left' | 'right'): void => {
    const r = new Konva.Line({
      points: pts,
      closed: true,
      fill: colors.frame,
      stroke: 'rgba(0,0,0,0.5)',
      strokeWidth: 1,
      strokeScaleEnabled: false,
    });
    r.setAttr('data-edge', edge);
    g.add(r);
  };
  if (!isOpen('up')) bar([0, 0, w, 0, w - fw, fw, fw, fw], 'top'); // 顶料
  if (!isOpen('right')) bar([w, 0, w, h, w - fw, h - fw, w - fw, fw], 'right'); // 右料
  if (!isOpen('down')) bar([0, h, w, h, w - fw, h - fw, fw, h - fw], 'bottom'); // 底料
  if (!isOpen('left')) bar([0, 0, 0, h, fw, h - fw, fw, fw], 'left'); // 左料
  // 四角 45° 拼接缝：黑色斜线贯穿整条框带（外角 → 内角）；涉及缺边的角不画
  const miters: [number, number, number, number, FrameSide, FrameSide][] = [
    [0, 0, fw, fw, 'up', 'left'],
    [w, 0, w - fw, fw, 'up', 'right'],
    [w, h, w - fw, h - fw, 'down', 'right'],
    [0, h, fw, h - fw, 'down', 'left'],
  ];
  for (const [x1, y1, x2, y2, s1, s2] of miters) {
    if (isOpen(s1) || isOpen(s2)) continue;
    g.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke: 'rgba(0,0,0,0.6)', strokeWidth: 1.2, strokeScaleEnabled: false, listening: false }));
  }
}

/**
 * 压线环（矩形玻璃宿主）：沿 pane 内缘画一圈宽 bw 的扣条，独立携带 data-bead-host 供选中/命中。
 * joint=miter 四角 45° 斜接；joint=butt 上下通长、左右直角搭接。压线宽取真实 beadWidth，颜色独立于外框。
 */
function drawBeadRing(
  g: Konva.Group,
  pane: { x: number; y: number; w: number; h: number },
  bead: BeadConfig,
  colors: Required<typeof DEFAULT_COLORS>,
  hostId: string,
): void {
  const { x, y, w, h } = pane;
  const bw = Math.max(1, Math.min(bead.widthMm, Math.min(w, h) / 2 - 1));
  if (w <= 2 * bw || h <= 2 * bw) return;
  const ix = x + bw;
  const iy = y + bw;
  const ir = x + w - bw;
  const ib = y + h - bw;
  const seg = (pts: number[]): void => {
    const r = new Konva.Line({ points: pts, closed: true, fill: colors.bead, stroke: 'rgba(0,0,0,0.5)', strokeWidth: 1, strokeScaleEnabled: false, listening: true });
    r.name('bead');
    r.setAttr('data-bead-host', hostId);
    g.add(r);
  };
  if (bead.joint === 'butt') {
    seg([x, y, x + w, y, x + w, iy, x, iy]); // 上（通长）
    seg([x, ib, x + w, ib, x + w, y + h, x, y + h]); // 下（通长）
    seg([x, iy, ix, iy, ix, ib, x, ib]); // 左（直角搭接）
    seg([ir, iy, x + w, iy, x + w, ib, ir, ib]); // 右（直角搭接）
    return;
  }
  seg([x, y, x + w, y, ir, iy, ix, iy]); // 上（45°）
  seg([x + w, y, x + w, y + h, ir, ib, ir, iy]); // 右（45°）
  seg([x, y + h, x + w, y + h, ir, ib, ix, ib]); // 下（45°）
  seg([x, y, x, y + h, ix, ib, ix, iy]); // 左（45°）
  const seams: [number, number, number, number][] = [
    [x, y, ix, iy],
    [x + w, y, ir, iy],
    [x + w, y + h, ir, ib],
    [x, y + h, ix, ib],
  ];
  for (const s of seams)
    g.add(new Konva.Line({ points: [s[0], s[1], s[2], s[3]], stroke: 'rgba(0,0,0,0.55)', strokeWidth: 1, strokeScaleEnabled: false, listening: false }));
}

function drawSashAndGlass(
  g: Konva.Group,
  w: number,
  h: number,
  colors: Required<typeof DEFAULT_COLORS>,
  inset: number,
  tilted: boolean,
  opts?: {
    free?: { side: 'left' | 'right'; mm: number };
    louver?: TreeRenderElement['louver'];
    panel?: TreeRenderElement['panel'];
  },
): void {
  // 对开扇的自由边是中缝料（比扇料宽），其余三边仍是普通扇料
  const free = opts?.free;
  const l = free?.side === 'left' ? free.mm : inset;
  const r = free?.side === 'right' ? free.mm : inset;
  g.add(new Konva.Rect({ width: w, height: h, fill: colors.sash, stroke: 'rgba(0,0,0,0.5)', strokeWidth: 1, strokeScaleEnabled: false }));
  const pane = opts?.panel;
  if (opts?.louver) {
    drawLouverSlats(g, w, l, r, opts.louver);
  } else if (pane) {
    // 上玻下板（实测肯德基门）：玻璃只占上半，中间留出扇料宽的中横档，下部横板 `#636568`
    g.add(
      new Konva.Rect({
        x: pane.glass.x,
        y: pane.glass.y,
        width: Math.max(1, pane.glass.w),
        height: Math.max(1, pane.glass.h),
        fill: colors.glass,
        stroke: 'rgba(0,0,0,0.4)',
        strokeWidth: 1,
        strokeScaleEnabled: false,
      }),
    );
    g.add(
      new Konva.Rect({
        x: pane.panel.x,
        y: pane.panel.y,
        width: Math.max(1, pane.panel.w),
        height: Math.max(1, pane.panel.h),
        fill: '#636568',
        stroke: 'rgba(0,0,0,0.4)',
        strokeWidth: 1,
        strokeScaleEnabled: false,
      }),
    );
  } else {
    g.add(
      new Konva.Rect({
        x: l,
        y: inset,
        width: Math.max(1, w - l - r),
        height: Math.max(1, h - 2 * inset),
        fill: colors.glass,
        stroke: 'rgba(0,0,0,0.4)',
        strokeWidth: 1,
        strokeScaleEnabled: false,
      }),
    );
  }
  // 扇料四角 45° 拼接缝：黑色斜线（外角 → 玻璃内角）
  if (inset > 0 && inset * 2 < Math.min(w, h)) {
    const smiters: [number, number, number, number][] = [
      [0, 0, l, inset],
      [w, 0, w - r, inset],
      [w, h, w - r, h - inset],
      [0, h, l, h - inset],
    ];
    for (const c of smiters) {
      g.add(new Konva.Line({ points: [c[0], c[1], c[2], c[3]], stroke: 'rgba(0,0,0,0.6)', strokeWidth: 1.2, strokeScaleEnabled: false, listening: false }));
    }
  }
  if (tilted) {
    g.add(new Konva.Line({ points: [l, inset, w - r, inset], stroke: 'rgba(120,120,160,0.5)', strokeWidth: 2, dash: [6, 4] }));
  }
}

/** 百叶帘片：横向片铺满扇口（间距来自整窗可配参数；对方未采到片厚，按间距比例取） */
function drawLouverSlats(g: Konva.Group, w: number, l: number, r: number, louver: NonNullable<TreeRenderElement['louver']>): void {
  const x0 = l;
  const x1 = w - r;
  for (const y of louver.slatYs) {
    g.add(
      new Konva.Rect({
        x: x0,
        y: y - louver.slatHeightMm / 2,
        width: Math.max(1, x1 - x0),
        height: louver.slatHeightMm,
        fill: '#cfc9bd',
        stroke: 'rgba(0,0,0,0.35)',
        strokeWidth: 1,
        listening: false,
      }),
    );
  }
}

/** 百叶/推板类的实测开启符号（§5.3）：一根 lw15 主斜线 + 每扇一个 r50 半圆 */
function drawShadeMarks(g: Konva.Group, w: number, h: number, inset: number): void {
  const bar = Math.max(1, Math.min(inset, h / 4));
  const x0 = bar + Math.min(40, w * 0.08);
  const x1 = w - x0;
  const yLow = h - bar - Math.min(60, h * 0.1);
  const yHigh = bar + Math.min(60, h * 0.1);
  g.add(
    new Konva.Line({ points: [x0, yLow, x1, yHigh], stroke: '#000000', strokeWidth: 15, listening: false }),
    new Konva.Arc({ x: x0, y: yLow, innerRadius: 50, outerRadius: 50, angle: Math.PI, clockwise: false, stroke: '#000000', strokeWidth: 15, listening: false }),
  );
}

function drawOpeningMark(g: Konva.Group, w: number, h: number, inset: number, hingeSide: string, openDir: string): void {
  // 实测规格：顶点在合页侧中点，两臂张到自由边的玻璃上/下角；实线=一种开向，dash[30,15]=另一种
  const hingeLeft = hingeSide === 'left';
  const hingeX = hingeLeft ? inset : w - inset;
  const freeX = hingeLeft ? w - inset : inset;
  const cy = h / 2;
  g.add(
    new Konva.Line({
      points: [freeX, h - inset, hingeX, cy, freeX, inset],
      stroke: '#000',
      strokeWidth: 9,
      lineJoin: 'miter',
      dash: openDir === 'out' ? [30, 15] : undefined,
      listening: false,
    }),
  );
}

/** 叶子的已解析玻璃口多边形（元素局部坐标）。 */
function panePolygonOf(el: TreeRenderElement): Pt[] | null {
  const flat = el.panePoints;
  if (!flat || flat.length < 8) return null;
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ x: flat[i], y: flat[i + 1] });
  return pts;
}

/** 玻璃格条：core 已按玻璃口尺寸给出几何，此处只负责物化。 */
function drawGlassBars(g: Konva.Group, el: TreeRenderElement, glassInset: number): void {
  const gw = Math.max(1, el.w - 2 * glassInset);
  const gh = Math.max(1, el.h - 2 * glassInset);
  const geo = el.glassBars;
  if (!geo) return;
  const bg = new Konva.Group({ x: glassInset, y: glassInset, listening: false });
  const arcGroup = new Konva.Group({ clipWidth: gw, clipHeight: gh, listening: false });
  // 非矩形子区（异形框叶 / 弧梃叶 / 斜梃叶）：格条必须裁到玻璃轮廓，否则直条会跨过被切掉的角
  const pane = panePolygonOf(el);
  if (pane) {
    bg.clipFunc((ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      pane.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x - glassInset, p.y - glassInset) : ctx.lineTo(p.x - glassInset, p.y - glassInset)));
      ctx.closePath();
    });
  }
  for (const r of geo.rings) {
    const w = gw - 2 * r.insetMm;
    const h = gh - 2 * r.insetMm;
    if (w <= 0 || h <= 0) continue;
    bg.add(new Konva.Rect({ x: r.insetMm, y: r.insetMm, width: w, height: h, stroke: '#636568', strokeWidth: r.widthMm, listening: false }));
  }
  for (const l of geo.lines) {
    bg.add(new Konva.Line({ points: [l.x1, l.y1, l.x2, l.y2], stroke: '#636568', strokeWidth: l.widthMm, lineCap: 'butt', listening: false }));
  }
  for (const a of geo.arcs) {
    if (a.startDeg === undefined || a.sweepDeg === undefined) {
      bg.add(new Konva.Ellipse({ x: a.cx, y: a.cy, radiusX: a.rMm, radiusY: a.rMm, stroke: '#636568', strokeWidth: a.widthMm, listening: false }));
      continue;
    }
    arcGroup.add(new Konva.Path({ data: arcBandPath(a.cx, a.cy, a.rMm, a.startDeg, a.sweepDeg), stroke: '#636568', strokeWidth: a.widthMm, lineCap: 'butt', listening: false }));
  }
  if (arcGroup.children.length) bg.add(arcGroup);
  g.add(bg);
}

/** 圆环带弧段（SVG path）：角度以屏幕坐标系（y 轴向下）计，sweep 为正即顺时针 */
function arcBandPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number): string {
  const point = (deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  const [x1, y1] = point(startDeg);
  const [x2, y2] = point(startDeg + sweepDeg);
  const large = Math.abs(sweepDeg) > 180 ? 1 : 0;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${large} ${sweepDeg > 0 ? 1 : 0} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

/** 把手：开启扇上的独立构件（缺省自动存在），可拖动定位（范围=扇料边框长宽），并在画布标注实际值 */
function drawSashHandle(g: Konva.Group, el: TreeRenderElement): void {
  const s = el.sash;
  if (!s || s.windowType === 'fixed') return;
  for (const placement of el.handlePlacements ?? []) drawHandleAt(g, placement, s, el.id);
}

/** 在一片扇叶上画把手（对开扇两叶各一个，共用同一份 handle 配置 → 左右镜像对称） */
function drawHandleAt(
  g: Konva.Group,
  placement: NonNullable<TreeRenderElement['handlePlacements']>[number],
  s: WindowSashSpec,
  hostId: string,
): void {
  const p = placement;
  const hg = new Konva.Group({ x: p.drawX, y: p.drawY, name: 'sashHandle', draggable: true });
  hg.setAttr('data-handle-of', hostId);
  hg.setAttr('cursor', 'move');
  if (s.infill === 'louver') {
    // 实测（§5.3 百叶窗）：把手是 `#0000ff lw3` 的 46×46 斜切方块
    const side = 46;
    const cut = side * 0.26;
    hg.add(
      new Konva.Line({
        points: [-side / 2 + cut, -side / 2, side / 2, -side / 2, side / 2, side / 2, -side / 2, side / 2, -side / 2, -side / 2 + cut],
        closed: true,
        fill: 'rgba(0,0,255,0.08)',
        stroke: '#0000ff',
        strokeWidth: 3,
        listening: false,
      }),
    );
  } else {
    hg.add(
      new Konva.Rect({ x: -p.w / 2, y: -p.h / 2, width: p.w, height: p.h, cornerRadius: 6, fill: '#d4d1d9', stroke: '#000000', strokeWidth: 3 }),
      new Konva.Rect({ x: -p.w * 0.3, y: p.h / 2, width: p.w * 0.6, height: p.arm, cornerRadius: 5, fill: '#d4d1d9', stroke: '#000000', strokeWidth: 3, listening: false }),
    );
  }
  const onRight = p.hinge === 'right';
  hg.add(
    new Konva.Text({
      x: onRight ? -p.w / 2 - 150 : p.w / 2 + 12,
      y: -12,
      width: 138,
      text: p.label,
      fontSize: Math.max(18, Math.round(Math.min(p.w, p.h) / 2.2)),
      fontStyle: 'bold',
      fill: '#5c3b00',
      align: onRight ? 'right' : 'left',
      listening: false,
    }),
  );
  g.add(hg);
}

/**
 * 对开扇（实测 §5.3）：一个构件两片扇，中缝是两根「对开料」（比扇料宽、两叶重叠一段），
 * **没有中梃**；两叶各自以外侧为合页，各自一个把手贴自由边（=中缝侧）+ 各自开启符号。
 */
function drawDoubleSash(
  g: Konva.Group,
  el: TreeRenderElement,
  colors: Required<typeof DEFAULT_COLORS>,
  inset: number,
  tilted: boolean,
): void {
  const s = el.sash;
  if (!s) return;
  for (const leaf of el.sashLeafGeometries ?? []) {
    const lg = new Konva.Group({ x: leaf.x, y: leaf.y });
    drawSashAndGlass(lg, leaf.w, leaf.h, colors, inset, tilted, {
      free: { side: leaf.hinge === 'left' ? 'right' : 'left', mm: leaf.freeBarMm },
      louver: leaf.louver,
      panel: leaf.panel,
    });
    if (leaf.louver) drawShadeMarks(lg, leaf.w, leaf.h, inset);
    else drawOpeningMark(lg, leaf.w, leaf.h, inset, leaf.hinge, s.openDirection ?? 'out');
    g.add(lg);
  }
  // 对开肯德基门（实测）：门扇中部一块 `#d4d1d9` 150×200 推板，跨在中缝上、与板顶横档同高
  if (el.panelPushPlate) {
    const plate = el.panelPushPlate;
      g.add(
        new Konva.Rect({
          x: plate.x,
          y: plate.y,
          width: plate.w,
          height: plate.h,
          fill: '#d4d1d9',
          stroke: '#000000',
          strokeWidth: 3,
          listening: false,
        }),
      );
  }
}

/** 非矩形子区（异形/弧梃/斜梃切出的格）里的百叶帘片：裁到玻璃轮廓内，避免跨过被切掉的角 */
function drawSlatsClippedToPane(g: Konva.Group, el: TreeRenderElement, inset: number): void {
  const pane = panePolygonOf(el);
  if (!pane || !el.louver) return;
  const sg = new Konva.Group({ listening: false });
  sg.clipFunc((ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    pane.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  });
  drawLouverSlats(sg, el.w, inset, inset, el.louver);
  g.add(sg);
}

/**
 * 内倒平移扇（实测 `downWithSlideSash`）：扇环 + 玻璃 + 滑移等腰梯形（`lw15` 三线、两腰上外撇）
 * + 两端 `#0000ff lw3` 40×40 端挡 + `lw9` 方向箭头 + `#bd6736 lw3` 内倒标记字形。
 */
function drawTiltSlide(g: Konva.Group, w: number, h: number, colors: Required<typeof DEFAULT_COLORS>, inset: number): void {
  drawSashAndGlass(g, w, h, colors, inset, false);
  const bar = Math.max(1, Math.min(inset, h / 4));
  const x0 = bar + Math.min(40, w * 0.08);
  const x1 = w - x0;
  const yBase = h - bar - Math.min(60, h * 0.1);
  const yTop = yBase - Math.min(80, h * 0.12);
  const splay = Math.min(40, w * 0.06);
  g.add(
    new Konva.Line({ points: [x0, yBase, x1, yBase], stroke: '#000000', strokeWidth: 15, listening: false }),
    new Konva.Line({ points: [x0, yBase, x0 - splay, yTop], stroke: '#000000', strokeWidth: 15, listening: false }),
    new Konva.Line({ points: [x1, yBase, x1 + splay, yTop], stroke: '#000000', strokeWidth: 15, listening: false }),
    new Konva.Rect({ x: x0 - 20, y: yBase - 20, width: 40, height: 40, stroke: '#0000ff', strokeWidth: 3, fill: 'transparent', listening: false }),
    new Konva.Rect({ x: x1 - 20, y: yBase - 20, width: 40, height: 40, stroke: '#0000ff', strokeWidth: 3, fill: 'transparent', listening: false }),
  );
  const head = Math.min(55, Math.max(10, Math.min(w, h) * 0.06));
  const ay = yTop - head - 12;
  const ax0 = w * 0.34;
  const ax1 = w * 0.66;
  g.add(
    new Konva.Line({ points: [ax1, ay, ax0, ay], stroke: '#000000', strokeWidth: 9, listening: false }),
    new Konva.Line({ points: [ax0 + head, ay - head, ax0, ay, ax0 + head, ay + head], stroke: '#000000', strokeWidth: 9, listening: false }),
  );
  g.add(new Konva.Line({ points: [w / 2 - head, ay - head - 6, w / 2, ay - head - 6 - head, w / 2 + head, ay - head - 6], stroke: '#bd6736', strokeWidth: 3, listening: false }));
}

function drawTopHinge(g: Konva.Group, w: number, h: number, inset: number): void {
  g.add(new Konva.Line({ points: [inset, inset, w - inset, inset], stroke: '#555', strokeWidth: 2.5 }));
  const cx = w / 2;
  const bottomY = h - inset;
  const K = Math.min(16, Math.max(6, inset / 2));
  const apexY = bottomY + K;
  g.add(
    new Konva.Line({ points: [cx, apexY, w / 3, bottomY], stroke: '#000', strokeWidth: 2 }),
    new Konva.Line({ points: [cx, apexY, (w * 2) / 3, bottomY], stroke: '#000', strokeWidth: 2 }),
  );
}

function drawSliding(g: Konva.Group, w: number, h: number, colors: Required<typeof DEFAULT_COLORS>, inset: number): void {
  const half = Math.max(1, w / 2);
  for (const off of [0, half]) {
    g.add(new Konva.Rect({ x: off, y: 0, width: half, height: h, fill: colors.sash, stroke: 'rgba(0,0,0,0.15)', strokeWidth: 1 }));
    g.add(
      new Konva.Rect({ x: off + Math.min(inset, half / 2), y: Math.min(inset, h / 2), width: Math.max(1, half - 2 * inset), height: Math.max(1, h - 2 * inset), fill: colors.glass, stroke: 'rgba(0,0,0,0.12)', strokeWidth: 1 }),
    );
    // 实测规格：每扇一根 lw15 轨道线 + 端部 r50 半圆 + 两个 #0000ff 40×40 端挡
    const gx = off + Math.min(inset, half / 2) + 40;
    const gw = Math.max(60, half - 2 * inset - 80);
    const gy = h - Math.min(inset, h / 2) - 60;
    g.add(
      new Konva.Line({ points: [gx, gy, gx + gw, gy], stroke: '#000000', strokeWidth: 15, listening: false }),
      new Konva.Arc({ x: gx + gw, y: gy, innerRadius: 50, outerRadius: 50, angle: Math.PI, clockwise: false, stroke: '#000000', strokeWidth: 15, listening: false }),
      new Konva.Rect({ x: gx - 20, y: gy - 20, width: 40, height: 40, stroke: '#0000ff', strokeWidth: 3, fill: 'transparent', listening: false }),
      new Konva.Rect({ x: gx + gw - 20, y: gy - 20, width: 40, height: 40, stroke: '#0000ff', strokeWidth: 3, fill: 'transparent', listening: false }),
    );
  }
  g.add(new Konva.Line({ points: [half, 0, half, h], stroke: 'rgba(0,0,0,0.25)', strokeWidth: 1.5 }));
}

function drawScreen(g: Konva.Group, w: number, h: number, colors: Required<typeof DEFAULT_COLORS>): void {
  g.add(new Konva.Rect({ width: w, height: h, fill: colors.screen, stroke: 'rgba(0,0,0,0.12)', strokeWidth: 1 }));
  // 实测规格：纱网不是方格网，而是一条条横向贯穿的锯齿线（lw10、周期≈60mm、幅值≈24mm、竖向间距≈78mm）
  const period = 60, amp = 24, rowGap = 78;
  for (let y = amp + 6; y <= h - amp; y += rowGap) {
    const pts: number[] = [];
    for (let x = 6; x <= w - 6; x += period / 2) {
      const t = Math.round(x / (period / 2)) % 4;
      pts.push(x, y + (t === 1 ? amp : t === 3 ? -amp : 0));
    }
    if (pts.length >= 4) g.add(new Konva.Line({ points: pts, stroke: '#000000', strokeWidth: 10, lineJoin: 'miter', listening: false }));
  }
}
