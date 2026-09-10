import Konva from 'konva';
import { walkAreas, sashWidthOf, sashHandlePlacement, sashLeavesOf, sashLeafRects, DEFAULT_MEETING_MM, sashInfillOf, louverSlats, DEFAULT_LOUVER_PITCH_MM, panelLeafLayout, DEFAULT_PANEL_HEIGHT_MM, glassBarGeometry, autoFittingsOfTree, type WindowTree, type WindowSashSpec, type FrameSide } from './window-tree.js';
import { describeWindowTree, type TreeRenderElement } from './window-tree-describe.js';
import { insetPolygon, bBoxOf, regionAnchor, pointInPoly, polygonArea, type Pt } from './outline.js';

/**
 * 容器树 → Konva 物化（浏览器 shape 层使用）：
 * 由 describeWindowTree 输出元素描述，逐条创建 Konva.Group。
 * 每个逻辑节点（外框 / 中梃 / 叶子）为独立 Group，携带 id 与 name(kind)，
 * 供命中测试、选中高亮与编辑工具使用。
 * 注意：本文件依赖 Konva，仅浏览器/具备 canvas 环境使用；纯逻辑测试面向描述层。
 */

export interface WindowTreeRenderOptions {
  installGap: number;
  /** 扇料视觉内缩（mm），默认 24 */
  sashInsetMm?: number;
  showLabels?: boolean;
  colors?: {
    frame?: string;
    glass?: string;
    sash?: string;
    screen?: string;
    panel?: string;
    inner?: string;
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
};

export function renderWindowTree(tree: WindowTree, opts: WindowTreeRenderOptions): WindowTreeRenderResult {
  const colors = { ...DEFAULT_COLORS, ...opts.colors };
  const sashInset = opts.sashInsetMm ?? sashWidthOf(tree);
  const showLabels = opts.showLabels !== false;

  const group = new Konva.Group({ listening: true });
  const nodes = new Map<string, Konva.Group>();

  // 宿主 → 配件数量（外框 = tree.fittings；分格 = area.fittings + 派生的把手/格条），角标与下料表同源
  const fitCounts = new Map<string, number>();
  if (tree.fittings?.length) fitCounts.set('frame', tree.fittings.length);
  walkAreas(tree, (a) => {
    if (a.fittings?.length) fitCounts.set(a.id, a.fittings.length);
  });
  for (const f of autoFittingsOfTree(tree, { installGap: opts.installGap }, (id) => id)) {
    fitCounts.set(f.hostId, (fitCounts.get(f.hostId) ?? 0) + 1);
  }

  for (const el of describeWindowTree(tree, opts.installGap)) {
    const g = new Konva.Group({ id: el.id, name: el.kind });
    g.position({ x: el.x, y: el.y });
    drawElement(g, el, colors, sashInset, showLabels);
    const fc = fitCounts.get(el.id) ?? 0;
    if (fc > 0) {
      const r = Math.max(9, Math.min(22, Math.min(el.w, el.h) / 16));
      const elPts = el.points ? toPts(el.points) : undefined;
      const badge = elPts && elPts.length > 3
        ? (() => { const a = regionAnchor(elPts); return { x: a.x, y: Math.max(r + 3, a.y - el.h * 0.18) }; })()
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
  inset: number,
  showLabels: boolean,
): void {
  const pts = el.points ? toPts(el.points) : undefined;
  // 构件体系扩展：roleType 存在时走注册类型绘制（windoorcraft 对齐），否则旧 switch 兼容
  if (el.sash?.roleType) {
    drawRoleType(g, el, el.sash.roleType, colors, inset, pts);
  } else {
    drawLegacyElement(g, el, colors, inset, pts);
  }

  // 叶子分格统一追加：把手（开启扇自动带）+ 玻璃格条（装饰条）——覆盖 roleType 与 legacy 两条路径
  if (el.kind === 'area') {
    if (el.sash) drawSashHandle(g, el, inset);
    drawGlassBars(g, el, el.sash ? inset : 0);
  }

  if (showLabels && el.label) {
    // 带轮廓的子区（异形框 / 弧梃切出的格）按面积质心定位，否则沿用包围盒中心
    const anchor = pts && pts.length > 3 ? regionAnchor(pts) : { x: el.w / 2, y: el.h / 2 };
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

/** 旧 5 构件类型 + 框架/中梃/空 的原始绘制（迁移自原 switch） */
function drawLegacyElement(
  g: Konva.Group,
  el: TreeRenderElement,
  colors: Required<typeof DEFAULT_COLORS>,
  inset: number,
  pts: Pt[] | undefined,
): void {
  switch (el.type) {
    case 'frame':
      if (pts && el.points) {
        drawOutlineFrame(g, el.points, el.frameWidthMm ?? Math.min(el.w, el.h), colors);
      } else {
        drawFrameParts(g, el.w, el.h, el.frameWidthMm ?? Math.min(el.w, el.h), colors, el.openSides);
      }
      return;
    case 'muntin':
      if (pts) {
        g.add(
          new Konva.Line({
            points: el.points,
            closed: true,
            fill: colors.frame,
            stroke: 'rgba(0,0,0,0.25)',
            strokeWidth: 1,
            listening: true,
          }),
        );
      } else {
        g.add(
          new Konva.Rect({
            width: el.w,
            height: el.h,
            fill: colors.frame,
            stroke: 'rgba(0,0,0,0.25)',
            strokeWidth: 1,
            cornerRadius: Math.min(3, el.w / 2, el.h / 2),
          }),
        );
      }
      return;
    case 'empty':
      if (pts) {
        g.add(new Konva.Line({ points: el.points, closed: true, fill: colors.panel, stroke: 'rgba(0,0,0,0.08)', strokeWidth: 1, listening: true }));
      } else {
        g.add(new Konva.Rect({ width: el.w, height: el.h, fill: colors.panel, stroke: 'rgba(0,0,0,0.08)', strokeWidth: 1 }));
      }
      return;
    case 'fixed':
      if (pts) {
        g.add(new Konva.Line({ points: el.points, closed: true, fill: colors.glass, stroke: 'rgba(0,0,0,0.12)', strokeWidth: 1, listening: true }));
      } else {
        g.add(new Konva.Rect({ width: el.w, height: el.h, fill: colors.glass, stroke: 'rgba(0,0,0,0.12)', strokeWidth: 1 }));
      }
      break;
    case 'casement':
    case 'casementUp': {
      const tilted = el.type === 'casementUp';
      const infill = sashInfillOf(el.sash);
      const louverPitch = infill === 'louver' ? Math.max(10, el.louverPitchMm ?? DEFAULT_LOUVER_PITCH_MM) : undefined;
      const panelHeight = infill === 'panel' ? Math.max(1, el.panelHeightMm ?? DEFAULT_PANEL_HEIGHT_MM) : undefined;
      if (louverPitch) {
        if (sashLeavesOf(el.sash) === 2) drawDoubleSash(g, el, colors, inset, tilted, { louverPitch });
        else if (pts) {
          drawPolySash(g, pts, colors, inset, el.sash);
          drawSlatsClippedToPane(g, el, inset, louverPitch);
        } else drawSashAndGlass(g, el.w, el.h, colors, inset, tilted, { louverPitch });
        if (sashLeavesOf(el.sash) !== 2) drawShadeMarks(g, el.w, el.h, inset);
        break;
      }
      if (panelHeight) {
        if (sashLeavesOf(el.sash) === 2) drawDoubleSash(g, el, colors, inset, tilted, { panelHeight });
        else {
          drawSashAndGlass(g, el.w, el.h, colors, inset, tilted, { panelHeight });
          drawOpeningMark(g, el.w, el.h, inset, el.sash?.hingeSide ?? 'left', el.sash?.openDirection ?? 'out');
        }
        break;
      }
      if (sashLeavesOf(el.sash) === 2) {
        drawDoubleSash(g, el, colors, inset, tilted);
      } else if (pts) {
        drawPolySash(g, pts, colors, inset, el.sash);
        drawOpeningMark(g, el.w, el.h, inset, el.sash?.hingeSide ?? 'left', el.sash?.openDirection ?? 'out');
      } else {
        drawSashAndGlass(g, el.w, el.h, colors, inset, tilted);
        drawOpeningMark(g, el.w, el.h, inset, el.sash?.hingeSide ?? 'left', el.sash?.openDirection ?? 'out');
      }
      break;
    }
    case 'tiltSlide':
      drawTiltSlide(g, el.w, el.h, colors, inset);
      break;
    case 'sliding':
      if (pts) {
        drawPolySash(g, pts, colors, inset, undefined);
      } else {
        drawSliding(g, el.w, el.h, colors, inset);
      }
      break;
    case 'topHinged':
      if (pts) {
        drawPolySash(g, pts, colors, inset, el.sash);
        drawTopHinge(g, el.w, el.h, inset);
      } else {
        drawSashAndGlass(g, el.w, el.h, colors, inset, false);
        drawTopHinge(g, el.w, el.h, inset);
      }
      break;
    case 'screen':
      if (sashLeavesOf(el.sash) === 2) {
        const meeting = Math.max(inset, el.meetingWidthMm ?? DEFAULT_MEETING_MM);
        for (const leaf of sashLeafRects(el.w, el.h, 2, meeting)) {
          const lg = new Konva.Group({ x: leaf.x, y: leaf.y });
          drawScreen(lg, leaf.w, leaf.h, colors);
          g.add(lg);
        }
      } else if (pts) {
        drawPolySash(g, pts, colors, inset, undefined);
      } else {
        drawScreen(g, el.w, el.h, colors);
      }
      break;
  }
}

/**
 * 构件体系（windoorcraft 对齐）的类型级绘制：按 roleType 分发。
 * 所有类型基于面板轮廓（pts 存在则多边形，否则矩形 bbox）。
 */
function drawRoleType(
  g: Konva.Group,
  el: TreeRenderElement,
  role: string,
  colors: Required<typeof DEFAULT_COLORS>,
  inset: number,
  pts: Pt[] | undefined,
): void {
  const local = pts ? flatOf(pts) : [0, 0, el.w, 0, el.w, el.h, 0, el.h];
  const poly = (fill: string, stroke = 'rgba(0,0,0,0.15)', lw = 1): void => {
    g.add(new Konva.Line({ points: local, closed: true, fill, stroke, strokeWidth: lw, listening: false }));
  };
  const line = (x1: number, y1: number, x2: number, y2: number, color = 'rgba(0,0,0,0.4)', w = 2, dash?: number[]): void => {
    g.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke: color, strokeWidth: w, dash, listening: false }));
  };
  const rectPts = (rx: number, ry: number, rw: number, rh: number): number[] => [rx, ry, rx + rw, ry, rx + rw, ry + rh, rx, ry + rh];
  const band = Math.max(10, Math.min(el.w, el.h) * 0.12);
  const cx = el.w / 2;
  const cy = el.h / 2;

  // 命中区：roleType 的视觉图形全部 listening:false，若不补一个透明可点区域，
  // getIntersection 会穿透到外框，导致该分格无法被选中/删除/高亮/加配件。
  // Konva 对 'transparent' 填充仍视为 hasFill，可正常命中，且不影响视觉。
  g.add(new Konva.Line({ points: local, closed: true, fill: 'transparent', listening: true }));

  switch (role) {
    case 'frostedGlass': {
      glassPane(g, 0, 0, el.w, el.h, colors.glass, true);
      // 磨砂纹理：细密斜线（半透明，不扰视线）
      for (let x = -el.h; x < el.w + el.h; x += 16) {
        line(x, el.h, x + el.h, 0, 'rgba(160,190,200,0.35)', 1);
      }
      break;
    }
    case 'securityFrame': {
      // 真实防盗框：沿面板四边的框料环 + 竖直中柱 + 中部锁点
      glassPane(g, 0, 0, el.w, el.h, colors.glass, true);
      const barW = band * 0.9;
      barRing(g, 0, 0, el.w, el.h, barW, colors.sash);
      // 竖直中柱
      g.add(new Konva.Line({ points: rectPts(cx - barW / 2, barW, barW, el.h - 2 * barW), closed: true, fill: colors.sash, stroke: '#333', strokeWidth: 1, listening: false }));
      // 中部锁点
      g.add(new Konva.Rect({ x: cx - 4, y: cy - 4, width: 8, height: 8, fill: '#333', cornerRadius: 1, listening: false }));
      break;
    }
    case 'securityBar': {
      // 完整防盗杆格栅：横向贯穿杆 + 竖向中杆（杆料有厚度）
      glassPane(g, 0, 0, el.w, el.h, colors.glass, true);
      const rod = Math.max(4, band * 0.5);
      const rows = Math.max(2, Math.round(el.h / 300));
      for (let i = 1; i <= rows; i++) {
        const y = (el.h / (rows + 1)) * i;
        g.add(new Konva.Rect({ x: 0, y: y - rod / 2, width: el.w, height: rod, fill: colors.sash, stroke: '#333', strokeWidth: 1, listening: false }));
      }
      g.add(new Konva.Rect({ x: cx - rod / 2, y: 0, width: rod, height: el.h, fill: colors.sash, stroke: '#333', strokeWidth: 1, listening: false }));
      break;
    }
    case 'waterGuard': {
      // 底部防水挡板：实心横条 + 斜面高边
      poly(colors.glass, 'rgba(0,0,0,0.12)');
      const bh = Math.max(14, el.h * 0.2);
      g.add(new Konva.Rect({ x: 0, y: el.h - bh, width: el.w, height: bh, fill: colors.sash, stroke: '#333', strokeWidth: 1, listening: false }));
      line(0, el.h - bh, el.w, el.h - bh, '#fff', 1.5);
      break;
    }
    case 'decorBar': {
      // 真实分格式装饰条：按宽高比 2x2 或 1x3 分格，格线为细料条
      glassPane(g, 0, 0, el.w, el.h, colors.glass, true);
      const cell = Math.max(6, Math.min(el.w, el.h) * 0.06);
      const cols = el.w >= el.h * 1.4 ? 3 : 2;
      const rows2 = cols === 3 ? 2 : 2;
      for (let i = 1; i < cols; i++) {
        g.add(new Konva.Rect({ x: (el.w / cols) * i - cell / 2, y: 0, width: cell, height: el.h, fill: colors.sash, stroke: 'rgba(0,0,0,0.3)', strokeWidth: 1, listening: false }));
      }
      for (let j = 1; j < rows2; j++) {
        g.add(new Konva.Rect({ x: 0, y: (el.h / rows2) * j - cell / 2, width: el.w, height: cell, fill: colors.sash, stroke: 'rgba(0,0,0,0.3)', strokeWidth: 1, listening: false }));
      }
      break;
    }
    case 'subSash': {
      // 子母扇：左大扇 + 右下小扇（小扇为独立扇料环）
      const smallW = el.w * 0.34;
      const smallH = el.h * 0.52;
      const sx = el.w - inset - smallW;
      const sy = el.h - inset - smallH;
      barRing(g, 0, 0, el.w, el.h, Math.max(6, inset * 0.8), colors.sash);
      glassPane(g, inset, inset, el.w - 2 * inset, el.h - 2 * inset, colors.glass, true);
      barRing(g, sx, sy, smallW, smallH, Math.max(4, inset * 0.6), colors.sash);
      glassPane(g, sx + 4, sy + 4, smallW - 8, smallH - 8, colors.glass, true);
      break;
    }
    case 'sashInSash': {
      // 扇中扇：居中完整内嵌小扇（扇料环 + 玻璃）
      const sw = el.w * 0.42;
      const sh = el.h * 0.55;
      const sx = cx - sw / 2;
      const sy = cy - sh / 2;
      barRing(g, 0, 0, el.w, el.h, Math.max(6, inset * 0.8), colors.sash);
      glassPane(g, inset, inset, el.w - 2 * inset, el.h - 2 * inset, colors.glass, true);
      barRing(g, sx, sy, sw, sh, Math.max(5, inset * 0.7), colors.sash);
      glassPane(g, sx + 5, sy + 5, sw - 10, sh - 10, colors.glass, true);
      break;
    }
    case 'pushIn': {
      // 内平推：扇料环 + 玻璃 + 中央内推把手（竖线 + 推行箭头）
      barRing(g, 0, 0, el.w, el.h, Math.max(6, inset * 0.8), colors.sash);
      glassPane(g, inset, inset, el.w - 2 * inset, el.h - 2 * inset, colors.glass, true);
      line(cx, cy - band, cx, cy + band, '#444', 2.5);
      line(cx, cy - band, cx - band * 0.6, cy - band * 0.5, '#444', 2.5);
      line(cx, cy - band, cx + band * 0.6, cy - band * 0.5, '#444', 2.5);
      break;
    }
    case 'foldSash':
    case 'foldScreen': {
      // 折叠扇：多页折叠（每页独立扇料 + 玻璃/纱，页间铰链深色线）
      const isScreen = role === 'foldScreen';
      const pages = 4;
      const pw = el.w / pages;
      const hinge = Math.max(2, Math.min(4, inset * 0.25));
      for (let p = 0; p < pages; p++) {
        const px0 = pw * p;
        const fx = px0 + inset;
        const fw = pw - 2 * inset;
        polyLocal(g, rectPts(px0, 0, pw, el.h), colors.sash, 'rgba(0,0,0,0.2)');
        if (fw > 4 && el.h > 2 * inset) {
          glassPane(g, fx, inset, fw, el.h - 2 * inset, isScreen ? colors.screen : colors.glass, true);
        }
        if (p > 0) {
          g.add(new Konva.Line({ points: [px0, inset, px0, el.h - inset], stroke: '#555', strokeWidth: hinge, listening: false }));
        }
      }
      break;
    }
    case 'fakeMullion': {
      // 顶部假中梃：完整条状（与真实中梃同宽感），45° 端头由条宽表达
      glassPane(g, 0, 0, el.w, el.h, colors.glass, true);
      const mh = Math.max(10, el.h * 0.15);
      g.add(new Konva.Rect({ x: 0, y: mh / 2, width: el.w, height: mh, fill: colors.sash, stroke: 'rgba(0,0,0,0.3)', strokeWidth: 1, listening: false }));
      break;
    }
    case 'sashBead':
    case 'screenBead':
    case 'panelBead': {
      // 真实压线：玻璃/纱/板材内缘的细压线框（整圈）
      const f = role === 'sashBead' ? colors.glass : role === 'screenBead' ? colors.screen : '#e5d3b3';
      const bw = Math.max(3, inset * 0.35);
      barRing(g, 0, 0, el.w, el.h, bw, f === colors.glass ? colors.sash : colors.sash);
      glassPane(g, bw, bw, el.w - 2 * bw, el.h - 2 * bw, f, false);
      // 压线线脚（四内边细亮线）
      const pi = bw;
      line(pi, pi, el.w - pi, pi, 'rgba(255,255,255,0.55)', 1);
      line(pi, el.h - pi, el.w - pi, el.h - pi, 'rgba(255,255,255,0.55)', 1);
      line(pi, pi, pi, el.h - pi, 'rgba(255,255,255,0.55)', 1);
      line(el.w - pi, pi, el.w - pi, el.h - pi, 'rgba(255,255,255,0.55)', 1);
      break;
    }
    case 'sashMullion':
    case 'screenMullion': {
      // 玻扇/纱扇中梃：中间完整竖中梃（条状），两侧玻璃/纱
      const f = role === 'sashMullion' ? colors.glass : colors.screen;
      const mw = Math.max(5, band * 0.7);
      glassPane(g, 0, 0, el.w, el.h, f, false);
      g.add(new Konva.Rect({ x: cx - mw / 2, y: 0, width: mw, height: el.h, fill: colors.sash, stroke: '#333', strokeWidth: 1, listening: false }));
      break;
    }
    default:
      poly(colors.panel);
  }
}

/** 玻璃面板 + 可选顶部高光渐变（对齐对方玻璃质感） */
function glassPane(g: Konva.Group, x: number, y: number, w: number, h: number, fill: string, gradient: boolean): void {
  g.add(
    new Konva.Rect({
      x,
      y,
      width: Math.max(1, w),
      height: Math.max(1, h),
      fill,
      stroke: 'rgba(0,0,0,0.12)',
      strokeWidth: 1,
      listening: false,
      ...(gradient
        ? {
            fillLinearGradientStartPoint: { x, y },
            fillLinearGradientEndPoint: { x, y: y + h },
            fillLinearGradientColorStops: [0, shade(fill, 0.06), 1, shade(fill, -0.05)],
          }
        : {}),
    }),
  );
}

/** 立体感色：浅化/加深颜色（用于玻璃渐变） */
function shade(hex: string, f: number): string {
  const m = hex.replace('#', '');
  const n = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const num = parseInt(n, 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + Math.round(255 * f)));
  const g2 = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + Math.round(255 * f)));
  const b = Math.min(255, Math.max(0, (num & 0xff) + Math.round(255 * f)));
  return `#${((r << 16) | (g2 << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * 闭合矩形环（料条），用于扇料/防盗框等结构件：由上/下/左/右四根料条拼成，中心镂空透出下层玻璃。
 * 注意：不能用「外实心矩形 + 内透明矩形」——Konva 的 transparent 填充只是不画像素，
 * 不会擦除已填充的外矩形，结果会是实心色块盖住玻璃。
 */
function barRing(g: Konva.Group, x: number, y: number, w: number, h: number, bar: number, fill: string): void {
  const stroke = 'rgba(0,0,0,0.25)';
  const b = Math.max(1, bar);
  if (b * 2 >= w || b * 2 >= h) {
    // 退化保护：料厚超过一半时整体填充，避免出现负尺寸
    g.add(new Konva.Rect({ x, y, width: Math.max(1, w), height: Math.max(1, h), fill, stroke, strokeWidth: 1, listening: false }));
    return;
  }
  const bars: [number, number, number, number][] = [
    [x, y, w, b], // 上
    [x, y + h - b, w, b], // 下
    [x, y + b, b, h - 2 * b], // 左
    [x + w - b, y + b, b, h - 2 * b], // 右
  ];
  for (const [bx, by, bw, bh] of bars) {
    g.add(new Konva.Rect({ x: bx, y: by, width: Math.max(1, bw), height: Math.max(1, bh), fill, stroke, strokeWidth: 1, listening: false }));
  }
}

/** 任意闭合多边形（本地矩形） */
function polyLocal(g: Konva.Group, pts: number[], fill: string, stroke: string): void {
  g.add(new Konva.Line({ points: pts, closed: true, fill, stroke, strokeWidth: 1, listening: false }));
}

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
function drawOutlineFrame(g: Konva.Group, flatPts: number[], fw: number, colors: Required<typeof DEFAULT_COLORS>): void {
  const outer = toPts(flatPts);
  const inner = insetPolygon(outer, Math.max(1, fw));
  g.add(
    new Konva.Line({ points: flatPts, closed: true, fill: colors.frame, stroke: 'rgba(0,0,0,0.18)', strokeWidth: 1, listening: false }),
  );
  g.add(
    new Konva.Line({ points: flatOf(inner), closed: true, fill: colors.inner, stroke: 'rgba(0,0,0,0.08)', strokeWidth: 1, listening: true }),
  );
  // 四边透明命中带（厚 = 框料宽），供逐边拖拽；加在内腔之后 → 周边命中优先于内腔平移
  const box = bBoxOf(outer);
  const t = Math.max(1, fw);
  const bands: [number, number, number, number, 'top' | 'bottom' | 'left' | 'right'][] = [
    [box.x, box.y, box.w, t, 'top'],
    [box.x, box.y + box.h - t, box.w, t, 'bottom'],
    [box.x, box.y, t, box.h, 'left'],
    [box.x + box.w - t, box.y, t, box.h, 'right'],
  ];
  for (const [bx, by, bw, bh, edge] of bands) {
    const r = new Konva.Rect({
      x: bx,
      y: by,
      width: Math.max(1, bw),
      height: Math.max(1, bh),
      fill: 'transparent',
      listening: true,
    });
    r.setAttr('data-edge', edge);
    g.add(r);
  }
}

/** 异形叶子内的扇/玻璃绘制：轮廓填充扇色 + 内缩玻璃（近似扇料内缩） */
function drawPolySash(g: Konva.Group, pts: Pt[], colors: Required<typeof DEFAULT_COLORS>, inset: number, _sash?: WindowSashSpec): void {
  const glass = insetPolygon(pts, Math.max(4, inset));
  g.add(new Konva.Line({ points: flatOf(pts), closed: true, fill: colors.sash, stroke: 'rgba(0,0,0,0.15)', strokeWidth: 1, listening: true }));
  g.add(new Konva.Line({ points: flatOf(glass), closed: true, fill: colors.glass, stroke: 'rgba(0,0,0,0.12)', strokeWidth: 1, listening: false }));
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
  // 内腔（可点：空白窗也能命中用于平移选中）
  g.add(new Konva.Rect({ x: fw, y: fw, width: w - 2 * fw, height: h - 2 * fw, fill: colors.inner, stroke: 'rgba(0,0,0,0.08)', strokeWidth: 1, listening: true }));
  // 四根框料：45° 斜角梯形，四角严丝合缝拼成环（可单独命中/拖拽）；缺边则不画该根
  const bar = (pts: number[], edge: 'top' | 'bottom' | 'left' | 'right'): void => {
    const r = new Konva.Line({
      points: pts,
      closed: true,
      fill: colors.frame,
      stroke: 'rgba(0,0,0,0.18)',
      strokeWidth: 1,
    });
    r.setAttr('data-edge', edge);
    g.add(r);
  };
  if (!isOpen('up')) bar([0, 0, w, 0, w - fw, fw, fw, fw], 'top'); // 顶料
  if (!isOpen('right')) bar([w, 0, w, h, w - fw, h - fw, w - fw, fw], 'right'); // 右料
  if (!isOpen('down')) bar([0, h, w, h, w - fw, h - fw, fw, h - fw], 'bottom'); // 底料
  if (!isOpen('left')) bar([0, 0, 0, h, fw, h - fw, fw, fw], 'left'); // 左料
  // 四角 45° 拼接缝：黑色斜线（外角 → 内角）；涉及缺边的角不画
  const miters: [number, number, number, number, FrameSide, FrameSide][] = [
    [0, 0, fw, fw, 'up', 'left'],
    [w, 0, w - fw, fw, 'up', 'right'],
    [w, h, w - fw, h - fw, 'down', 'right'],
    [0, h, fw, h - fw, 'down', 'left'],
  ];
  for (const [x1, y1, x2, y2, s1, s2] of miters) {
    if (isOpen(s1) || isOpen(s2)) continue;
    g.add(new Konva.Line({ points: [x1, y1, x2, y2], stroke: '#000000', strokeWidth: 1.5, listening: false }));
  }
}

function drawSashAndGlass(
  g: Konva.Group,
  w: number,
  h: number,
  colors: Required<typeof DEFAULT_COLORS>,
  inset: number,
  tilted: boolean,
  opts?: { free?: { side: 'left' | 'right'; mm: number }; louverPitch?: number; panelHeight?: number },
): void {
  // 对开扇的自由边是中缝料（比扇料宽），其余三边仍是普通扇料
  const free = opts?.free;
  const louverPitch = opts?.louverPitch;
  const l = free?.side === 'left' ? free.mm : inset;
  const r = free?.side === 'right' ? free.mm : inset;
  g.add(new Konva.Rect({ width: w, height: h, fill: colors.sash, stroke: 'rgba(0,0,0,0.15)', strokeWidth: 1 }));
  const pane = !louverPitch && opts?.panelHeight ? panelLeafLayout(w, h, inset, opts.panelHeight) : null;
  if (louverPitch) {
    drawLouverSlats(g, w, h, l, r, inset, louverPitch);
  } else if (pane) {
    // 上玻下板（实测肯德基门）：玻璃只占上半，中间留出扇料宽的中横档，下部横板 `#636568`
    g.add(
      new Konva.Rect({
        x: pane.glass.x,
        y: pane.glass.y,
        width: Math.max(1, pane.glass.w),
        height: Math.max(1, pane.glass.h),
        fill: colors.glass,
        stroke: 'rgba(0,0,0,0.12)',
        strokeWidth: 1,
      }),
    );
    g.add(
      new Konva.Rect({
        x: pane.panel.x,
        y: pane.panel.y,
        width: Math.max(1, pane.panel.w),
        height: Math.max(1, pane.panel.h),
        fill: '#636568',
        stroke: 'rgba(0,0,0,0.25)',
        strokeWidth: 1,
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
        stroke: 'rgba(0,0,0,0.12)',
        strokeWidth: 1,
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
      g.add(new Konva.Line({ points: [c[0], c[1], c[2], c[3]], stroke: '#000000', strokeWidth: 1.5, listening: false }));
    }
  }
  if (tilted) {
    g.add(new Konva.Line({ points: [l, inset, w - r, inset], stroke: 'rgba(120,120,160,0.5)', strokeWidth: 2, dash: [6, 4] }));
  }
}

/** 百叶帘片：横向片铺满扇口（间距来自整窗可配参数；对方未采到片厚，按间距比例取） */
function drawLouverSlats(g: Konva.Group, w: number, h: number, l: number, r: number, inset: number, pitch: number): void {
  const x0 = l;
  const x1 = w - r;
  const slat = Math.max(4, Math.min(16, pitch * 0.3));
  for (const y of louverSlats(h, inset, pitch)) {
    g.add(
      new Konva.Rect({
        x: x0,
        y: y - slat / 2,
        width: Math.max(1, x1 - x0),
        height: slat,
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

/** 叶子的玻璃多边形（元素局部坐标）；无轮廓（矩形子区）返回 null，走原 bbox 裁剪路径 */
function panePolygonOf(el: TreeRenderElement, inset: number): Pt[] | null {
  const flat = el.points;
  if (!flat || flat.length < 8) return null;
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ x: flat[i], y: flat[i + 1] });
  if (inset <= 0) return pts;
  const inner = insetPolygon(pts, inset);
  return inner.length >= 3 && Math.abs(polygonArea(inner)) > 1 ? inner : pts;
}

/** 玻璃格条：几何来自 glassBarGeometry()（纯函数、可单测），此处只负责物化 */
function drawGlassBars(g: Konva.Group, el: TreeRenderElement, glassInset: number): void {
  const gw = Math.max(1, el.w - 2 * glassInset);
  const gh = Math.max(1, el.h - 2 * glassInset);
  const geo = glassBarGeometry(gw, gh, el.bars);
  if (!geo) return;
  const bg = new Konva.Group({ x: glassInset, y: glassInset, listening: false });
  const arcGroup = new Konva.Group({ clipWidth: gw, clipHeight: gh, listening: false });
  // 非矩形子区（异形框叶 / 弧梃叶 / 斜梃叶）：格条必须裁到玻璃轮廓，否则直条会跨过被切掉的角
  const pane = panePolygonOf(el, glassInset);
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
function drawSashHandle(g: Konva.Group, el: TreeRenderElement, sashBarWidth: number): void {
  const s = el.sash;
  if (!s || s.windowType === 'fixed') return;
  // 斜梃/弧梃切出的子区不是矩形：按矩形算出的把手位可能落在被切掉的空角上，退回区域锚点
  const pane = panePolygonOf(el, 0);
  if (sashLeavesOf(s) === 2) {
    const meeting = Math.max(sashBarWidth, el.meetingWidthMm ?? DEFAULT_MEETING_MM);
    for (const leaf of sashLeafRects(el.w, el.h, 2, meeting)) drawHandleAt(g, leaf, s, sashBarWidth, el.id, pane);
    return;
  }
  drawHandleAt(g, { x: 0, y: 0, w: el.w, h: el.h, hinge: s.hingeSide === 'right' ? 'right' : 'left' }, s, sashBarWidth, el.id, pane);
}

/** 在一片扇叶上画把手（对开扇两叶各一个，共用同一份 handle 配置 → 左右镜像对称） */
function drawHandleAt(
  g: Konva.Group,
  box: { x: number; y: number; w: number; h: number; hinge: 'left' | 'right' },
  s: WindowSashSpec,
  sashBarWidth: number,
  hostId: string,
  pane: Pt[] | null,
): void {
  const p = sashHandlePlacement(box.w, box.h, sashBarWidth, s.handle, box.hinge);
  if (!p) return;
  const wanted = { x: box.x + p.cx, y: box.y + p.cy };
  const at = pane && !pointInPoly(wanted, pane) ? regionAnchor(pane) : wanted;
  const hg = new Konva.Group({ x: at.x, y: at.y, name: 'sashHandle', draggable: true });
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
  const onRight = at.x > box.x + box.w / 2;
  hg.add(
    new Konva.Text({
      x: onRight ? -p.w / 2 - 150 : p.w / 2 + 12,
      y: -12,
      width: 138,
      text: p.label,
      fontSize: Math.max(18, Math.round(Math.min(box.w, box.h) / 22)),
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
  opts?: { louverPitch?: number; panelHeight?: number },
): void {
  const s = el.sash;
  if (!s) return;
  const meeting = Math.max(inset, el.meetingWidthMm ?? DEFAULT_MEETING_MM);
  for (const leaf of sashLeafRects(el.w, el.h, 2, meeting)) {
    const lg = new Konva.Group({ x: leaf.x, y: leaf.y });
    drawSashAndGlass(lg, leaf.w, leaf.h, colors, inset, tilted, {
      free: { side: leaf.hinge === 'left' ? 'right' : 'left', mm: leaf.freeBarMm },
      louverPitch: opts?.louverPitch,
      panelHeight: opts?.panelHeight,
    });
    if (opts?.louverPitch) drawShadeMarks(lg, leaf.w, leaf.h, inset);
    else drawOpeningMark(lg, leaf.w, leaf.h, inset, leaf.hinge, s.openDirection ?? 'out');
    g.add(lg);
  }
  // 对开肯德基门（实测）：门扇中部一块 `#d4d1d9` 150×200 推板，跨在中缝上、与板顶横档同高
  if (opts?.panelHeight) {
    const lay = panelLeafLayout(el.w, el.h, inset, opts.panelHeight);
    if (lay) {
      const pw = Math.min(150, el.w * 0.14);
      const ph = Math.min(200, el.h * 0.14);
      g.add(
        new Konva.Rect({
          x: el.w / 2 - pw / 2,
          y: lay.railY - ph / 2,
          width: pw,
          height: ph,
          fill: '#d4d1d9',
          stroke: '#000000',
          strokeWidth: 3,
          listening: false,
        }),
      );
    }
  }
}

/** 非矩形子区（异形/弧梃/斜梃切出的格）里的百叶帘片：裁到玻璃轮廓内，避免跨过被切掉的角 */
function drawSlatsClippedToPane(g: Konva.Group, el: TreeRenderElement, inset: number, pitch: number): void {
  const pane = panePolygonOf(el, inset);
  if (!pane) return;
  const sg = new Konva.Group({ listening: false });
  sg.clipFunc((ctx: CanvasRenderingContext2D) => {
    ctx.beginPath();
    pane.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  });
  drawLouverSlats(sg, el.w, el.h, inset, inset, inset, pitch);
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