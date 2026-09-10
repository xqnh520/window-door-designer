import type {
  DesignComponent,
  DesignModel,
  MaterialLibrary,
  SeriesConstraints,
  SeriesSpec,
  WindowTemplate,
} from '@wdd/schema';
import { isTemplateCompatible } from './window-template.js';
import { pointInPoly } from './outline.js';

export type ValidationLevel = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  level: ValidationLevel;
  code: string;
  message: string;
  componentId?: string;
}

/** 系列未配置约束时使用的默认工艺值 */
const DEFAULT_CONSTRAINTS: Required<SeriesConstraints> = {
  minSashW: 300,
  minSashH: 400,
  maxSashW: 1600,
  maxSashH: 2400,
  minGlassW: 100,
  minGlassH: 100,
  maxGlassAreaM2: 4,
  minComponentSize: 40,
};

/** 几何容差（mm）：小于该值视为相连/包含 */
const EPS = 2;

const PANEL_KINDS = new Set(['fixedGlass', 'casementSash', 'slidingSash', 'topHungSash', 'screen']);
const SASH_KINDS = new Set(['casementSash', 'slidingSash', 'topHungSash']);

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

export function validateDesignModel(
  model: DesignModel | null,
  series: SeriesSpec,
  template?: WindowTemplate | null,
  library?: MaterialLibrary | null,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!model) {
    issues.push({ level: 'error', code: 'EMPTY_MODEL', message: '当前没有可计算的设计结构' });
    return issues;
  }

  const byId = new Map(model.components.map((c) => [c.id, c] as const));
  const family = seriesFamily(series);
  const constraints = { ...DEFAULT_CONSTRAINTS, ...(series.constraints ?? {}) };

  const frames = model.components.filter((c) => c.kind === 'outerFrame');
  if (!frames.length) {
    issues.push({ level: 'error', code: 'NO_FRAME', message: '缺少外框构件，无法计算材料清单' });
  }
  if (frames.length > 1) {
    const overlapped = frames.some((f, i) => i > 0 && overlapArea(rectOf(frames[0]), rectOf(f)) > 500);
    if (overlapped) {
      issues.push({ level: 'warning', code: 'MULTI_FRAME', message: '检测到多个相互重叠的外框，请整理为单一总外框', componentId: frames[1]?.id });
    } else {
      issues.push({ level: 'info', code: 'MULTI_FRAME', message: `检测到组合窗：${frames.length} 樘外框并排/叠放，将按樘独立算料并汇总` });
    }
  }
  const frame = frames[0];
  const frameRect = frame ? rectOf(frame) : null;
  const frameRects = frames.map(rectOf);

  // ── 孤立父引用 ──────────────────────────────────────────────
  for (const c of model.components) {
    if (c.parentId && !byId.has(c.parentId)) {
      issues.push({ level: 'error', code: 'ORPHAN_PARENT', message: '构件引用了不存在的父构件', componentId: c.id });
    }
  }

  // ── 构件级归属：越界与包含关系 ──────────────────────────────
  for (const c of model.components) {
    if (c.kind === 'outerFrame') continue;
    // 拼樘料本就横跨相邻两框边界，不做单框包含校验（否则误报 OUT_OF_FRAME 阻断下料）
    if (c.kind === 'combiner') continue;
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    const bound = parent ? rectOf(parent) : frameRect;
    if (!bound) continue;
    if (!contains(bound, rectOf(c), EPS)) {
      const escaped = parent && parent.kind !== 'outerFrame';
      issues.push({
        level: 'error',
        code: escaped ? 'CONTAINER_ESCAPE' : 'OUT_OF_FRAME',
        message: escaped
          ? `构件「${labelOf(c)}」超出其父构件范围，归属关系可能不正确`
          : `构件「${labelOf(c)}」超出外框边界`,
        componentId: c.id,
      });
    }
  }

  // ── 中梃连接：端点应接触所属外框（内缘或外缘）或其他中梃 ────
  const mullions = model.components.filter((c) => c.kind === 'mullion');
  if (mullions.length) {
    const tol = Math.max(5, Math.floor(series.frameWidth / 2));
    // 分割式中梃通常从外框内缘跨到另一内缘（容器树/分割交互产物），也判定为连接
    const innerRects = frameRects.map((r) => ({
      x: r.x + series.frameWidth,
      y: r.y + series.frameWidth,
      w: Math.max(1, r.w - 2 * series.frameWidth),
      h: Math.max(1, r.h - 2 * series.frameWidth),
    }));
    for (const m of mullions) {
      // 斜梃的端点取自 bbox 边中点，不在料上；容器树产出的斜带必然横跨宿主区，跳过此检查
      if (m.slope) continue;
      const [a, b] = mullionEndpoints(m);
      const others = mullions.filter((o) => o.id !== m.id);
      const connected = [a, b].every(
        (p) =>
          frameRects.some((r) => touchesFrameEdge(p, r, tol)) ||
          innerRects.some((r) => touchesInnerEdge(p, r, Math.max(4, series.frameWidth / 4))) ||
          others.some((o) => touchesMullion(p, o, tol)),
      );
      if (!connected) {
        issues.push({
          level: 'warning',
          code: 'MULLION_DISCONNECTED',
          message: '中梃未连接外框或其他中梃，分格可能未闭合',
          componentId: m.id,
        });
      }
    }
  }

  // ── 同级构件重叠检测 ────────────────────────────────────────
  const panels = model.components.filter((c) => PANEL_KINDS.has(c.kind));
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i];
      const b = panels[j];
      if (a.parentId !== b.parentId) continue;
      const area = paneOverlap(a, b);
      if (area <= 0) continue;
      const minArea = Math.min(areaOf(a), areaOf(b));
      if (area < Math.max(500, minArea * 0.03)) continue; // 仅贴边或极小重叠忽略
      issues.push({
        level: 'warning',
        code: 'OVERLAP',
        message: `构件「${labelOf(a)}」与「${labelOf(b)}」相互重叠，分格可能重复`,
        componentId: b.id,
      });
    }
  }

  // ── 格子封闭：中梃与外框是否形成完整分格 ────────────────────
  // 该分析走「竖线 × 横线」格点，表达不了斜向分隔线 → 有斜梃时整族跳过（否则会误报 UNSEGMENTED / CELL_UNCOVERED）
  if (!mullions.some((m) => m.slope)) {
    frames.forEach((f, idx) => {
      const framePanels = panels.filter((p) => p.parentId === f.id || (!p.parentId && idx === 0));
      analyzeGridCellIssues(f, framePanels, mullions, issues);
    });
  }

  // ── 尺寸限制：构件下限 / 开启扇 / 玻璃 ──────────────────────
  for (const c of model.components) {
    if (c.kind === 'outerFrame' || c.kind === 'mullion' || c.kind === 'combiner' || c.kind === 'annotation') continue;
    if (Math.min(c.w, c.h) < constraints.minComponentSize) {
      issues.push({
        level: 'warning',
        code: 'TOO_SMALL',
        message: `构件「${labelOf(c)}」过小（${c.w}×${c.h}mm），可能无法正常加工`,
        componentId: c.id,
      });
    }
  }

  for (const c of model.components) {
    if (!SASH_KINDS.has(c.kind)) continue;
    const w = sashLeafWidth(c);
    const below: string[] = [];
    const over: string[] = [];
    if (w < constraints.minSashW) below.push(`宽 ${w}<最小 ${constraints.minSashW}`);
    if (c.h < constraints.minSashH) below.push(`高 ${c.h}<最小 ${constraints.minSashH}`);
    if (w > constraints.maxSashW) over.push(`宽 ${w}>上限 ${constraints.maxSashW}`);
    if (c.h > constraints.maxSashH) over.push(`高 ${c.h}>上限 ${constraints.maxSashH}`);
    if (below.length) {
      issues.push({ level: 'warning', code: 'SASH_SIZE', message: `开启扇「${labelOf(c)}」尺寸偏小：${below.join('；')}`, componentId: c.id });
    }
    if (over.length) {
      issues.push({ level: 'error', code: 'SASH_SIZE', message: `开启扇「${labelOf(c)}」超出系列工艺上限：${over.join('；')}`, componentId: c.id });
    }
  }

  for (const c of model.components) {
    if (!PANEL_KINDS.has(c.kind)) continue;
    if (c.infill === 'louver') continue; // 百叶扇无玻璃，玻璃上下限不适用
    const glassW = c.kind === 'fixedGlass' ? c.w : Math.max(1, sashLeafWidth(c) - 2 * series.frameWidth);
    const glassH = c.kind === 'fixedGlass'
      ? c.h
      : Math.max(
        1,
        c.h - 2 * series.frameWidth - (c.infill === 'panel' ? Math.max(1, c.panelHeightMm ?? 200) + series.sashWidth : 0),
      );
    if (glassW < constraints.minGlassW || glassH < constraints.minGlassH) {
      issues.push({
        level: 'warning',
        code: 'GLASS_SIZE',
        message: `构件「${labelOf(c)}」玻璃 ${glassW}×${glassH}mm 小于系列下限 ${constraints.minGlassW}×${constraints.minGlassH}mm`,
        componentId: c.id,
      });
    }
    const areaM2 = (glassW * glassH) / 1e6;
    if (areaM2 > constraints.maxGlassAreaM2) {
      issues.push({
        level: 'error',
        code: 'GLASS_SIZE',
        message: `构件「${labelOf(c)}」玻璃面积 ${areaM2.toFixed(2)}㎡ 超过系列上限 ${constraints.maxGlassAreaM2}㎡，存在破碎/吊装风险`,
        componentId: c.id,
      });
    }
  }

  // ── 构件归属（树）与窗型匹配 ────────────────────────────────
  for (const c of model.components) {
    if (!c.parentId) continue;
    const parent = byId.get(c.parentId);
    if (!parent) continue;
    if (c.kind === 'fixedGlass' && !PANEL_KINDS.has(parent.kind)) {
      issues.push({ level: 'warning', code: 'GLASS_PARENT', message: '固定玻璃应归属到外框或开启扇', componentId: c.id });
    }
    if (SASH_KINDS.has(c.kind) && parent.kind !== 'outerFrame') {
      issues.push({ level: 'warning', code: 'SASH_PARENT', message: '开启扇通常应直接挂在外框下', componentId: c.id });
    }
    if (c.kind === 'mullion' && parent.kind !== 'outerFrame' && parent.kind !== 'mullion') {
      issues.push({ level: 'warning', code: 'MULLION_PARENT', message: '中梃应连接外框或其他中梃', componentId: c.id });
    }
  }
  for (const m of mullions) {
    const parent = m.parentId ? model.components.find((c) => c.id === m.parentId) : frame;
    if (!parent || parent.kind !== 'outerFrame') {
      issues.push({ level: 'warning', code: 'MULLION_ROOT', message: '中梃缺少明确外框归属', componentId: m.id });
    }
  }

  // ── 面板存在性与系列兼容 ────────────────────────────────────
  const glassCount = model.components.filter((c) => c.kind === 'fixedGlass').length;
  const sashCount = model.components.filter((c) => SASH_KINDS.has(c.kind)).length;
  const panelCount = model.components.filter((c) => PANEL_KINDS.has(c.kind)).length;
  if (!panelCount) {
    issues.push({ level: 'error', code: 'NO_PANEL', message: '未识别到固定玻璃、开启扇或纱窗面板，无法出料' });
  }

  for (const c of model.components) {
    if (family === 'sliding' && (c.kind === 'casementSash' || c.kind === 'topHungSash')) {
      issues.push({
        level: 'error',
        code: 'FAMILY_MISMATCH',
        message: `推拉系列不允许平开/上悬构件「${labelOf(c)}」，请改用推拉扇或更换系列`,
        componentId: c.id,
      });
    }
    if (family === 'casement' && c.kind === 'slidingSash') {
      issues.push({
        level: 'error',
        code: 'FAMILY_MISMATCH',
        message: `平开系列不允许推拉构件「${labelOf(c)}」，请改用平开扇或更换系列`,
        componentId: c.id,
      });
    }
  }
  if (family === 'sliding' && !model.components.some((c) => c.kind === 'slidingSash')) {
    issues.push({ level: 'warning', code: 'SLIDING_SASH_MISSING', message: '当前是推拉系列，但未识别到推拉扇' });
  }
  if (family === 'casement' && !model.components.some((c) => c.kind === 'casementSash' || c.kind === 'topHungSash')) {
    issues.push({ level: 'warning', code: 'CASEMENT_SASH_MISSING', message: '当前是平开系列，但未识别到开启扇' });
  }

  // ── 五金限制：开启方式与铰链侧 ──────────────────────────────
  const allowedWindowTypes: Record<string, readonly string[]> = {
    casementSash: ['casement', 'casementUp', 'tiltSlide'],
    slidingSash: ['sliding'],
    topHungSash: ['topHinged'],
    fixedGlass: ['fixed'],
  };
  for (const c of model.components) {
    const allowed = allowedWindowTypes[c.kind];
    if (!allowed) continue;
    if (c.windowType && !allowed.includes(c.windowType)) {
      issues.push({
        level: 'warning',
        code: 'WINDOW_TYPE_MISMATCH',
        message: `构件「${labelOf(c)}」开启方式「${c.windowType}」与构件类型不匹配`,
        componentId: c.id,
      });
    }
    if (c.kind === 'casementSash' && !c.hingeSide) {
      issues.push({ level: 'warning', code: 'HINGE_SIDE_MISSING', message: `平开扇「${labelOf(c)}」未指定开向（左开/右开），五金配置可能不完整`, componentId: c.id });
    }
    if (c.kind === 'casementSash' && c.hingeSide === 'top') {
      issues.push({ level: 'warning', code: 'HINGE_SIDE_MISMATCH', message: `平开扇「${labelOf(c)}」铰链侧为顶部，疑似应为上悬扇`, componentId: c.id });
    }
    if (c.kind === 'topHungSash' && c.hingeSide && c.hingeSide !== 'top') {
      issues.push({ level: 'warning', code: 'HINGE_SIDE_MISMATCH', message: `上悬扇「${labelOf(c)}」铰链侧应为顶部`, componentId: c.id });
    }
  }

  // ── 模板与系列基础配置 ──────────────────────────────────────
  if (template && !isTemplateCompatible(template, series)) {
    issues.push({ level: 'error', code: 'TPL_SERIES', message: `模板「${template.name}」与系列「${series.name}」不兼容` });
  }

  if (series.frameWidth <= 0 || series.sashWidth <= 0 || series.installGap <= 0) {
    issues.push({ level: 'error', code: 'SERIES_INVALID', message: '系列配置不完整，框宽或扇宽无效' });
  }

  // ── 材料配置完整性 ──────────────────────────────────────────
  if (!series.profileRoles?.frame) {
    issues.push({ level: 'warning', code: 'ROLE_FRAME_MISSING', message: '系列未配置框料角色，算料将回退到通用规则' });
  }
  if (sashCount > 0 && !series.profileRoles?.sash) {
    issues.push({ level: 'warning', code: 'ROLE_SASH_MISSING', message: '系列未配置扇料角色，扇料算料将回退到通用规则' });
  }
  if (mullions.length > 0 && !series.profileRoles?.mullion) {
    issues.push({ level: 'warning', code: 'ROLE_MULLION_MISSING', message: '系列未配置中梃角色，中梃算料将回退到通用规则' });
  }
  if (panels.length > 0 && !series.profileRoles?.bead) {
    issues.push({ level: 'warning', code: 'ROLE_BEAD_MISSING', message: '系列未配置压线角色，压线算料将回退到通用规则' });
  }
  if (model.components.some((c) => c.kind === 'slidingSash') && !series.profileRoles?.track) {
    issues.push({ level: 'warning', code: 'ROLE_TRACK_MISSING', message: '推拉系列未配置上滑角色，上滑算料将回退到通用规则' });
  }
  if (model.components.some((c) => c.kind === 'slidingSash') && !series.profileRoles?.sill) {
    issues.push({ level: 'warning', code: 'ROLE_SILL_MISSING', message: '推拉系列未配置下滑角色，下滑算料将回退到通用规则' });
  }
  if (library && !library.glass.some((g) => g.id === model.glassId)) {
    issues.push({ level: 'error', code: 'GLASS_MISSING', message: `玻璃「${model.glassId}」不在材料库中，无法生成玻璃清单` });
  }

  issues.push({
    level: 'info',
    code: 'MODEL_INFO',
    message: `模型包含 ${model.components.length} 个构件：外框 ${frames.length}、开启扇 ${sashCount}、固定玻璃 ${glassCount}、中梃 ${mullions.length}`,
  });

  return issues;
}

// ── 几何辅助 ─────────────────────────────────────────────────

function rectOf(c: DesignComponent): Rect {
  return { x: c.x, y: c.y, w: c.w, h: c.h };
}

/**
 * 单扇叶宽度（mm）：对开扇两叶在中缝重叠一根对开料，故可加工单元是 `(w + 中缝料) / 2`；
 * 工艺/玻璃上下限都按单叶判，否则对开扇会误报它本要避免的超限。
 */
function sashLeafWidth(c: DesignComponent): number {
  return c.leaves === 2 ? Math.round((c.w + (c.meetingWidthMm ?? 60)) / 2) : c.w;
}

function areaOf(c: DesignComponent): number {
  return c.w * c.h;
}

function contains(outer: Rect, inner: Rect, tol: number): boolean {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.w <= outer.x + outer.w + tol &&
    inner.y + inner.h <= outer.y + outer.h + tol
  );
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const contourOf = (c: DesignComponent): Point[] | null => {
  const flat = c.contour;
  if (!flat || flat.length < 6) return null;
  const pts: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) pts.push({ x: flat[i], y: flat[i + 1] });
  return pts;
};

/**
 * 两块面的重叠面积：都有轮廓时先按多边形判——斜梃切出的相邻两格 bbox 完全重叠却互不覆盖，
 * 只用 bbox 会误报 OVERLAP（顶点互不包含即视为不重叠，交叉成星形的罕见情形仍按 bbox 报）。
 */
function paneOverlap(a: DesignComponent, b: DesignComponent): number {
  const pa = contourOf(a);
  const pb = contourOf(b);
  if (!pa || !pb) return overlapArea(rectOf(a), rectOf(b));
  const touches = (from: Point[], into: Point[]) => from.some((p) => pointInPoly(p, into));
  return touches(pa, pb) || touches(pb, pa) ? overlapArea(rectOf(a), rectOf(b)) : 0;
}

function mullionEndpoints(c: DesignComponent): [Point, Point] {
  if (c.w >= c.h) {
    return [
      { x: c.x, y: c.y + c.h / 2 },
      { x: c.x + c.w, y: c.y + c.h / 2 },
    ];
  }
  return [
    { x: c.x + c.w / 2, y: c.y },
    { x: c.x + c.w / 2, y: c.y + c.h },
  ];
}

function touchesFrameEdge(p: Point, frame: Rect, tol: number): boolean {
  const insideX = p.x >= frame.x - tol && p.x <= frame.x + frame.w + tol;
  const insideY = p.y >= frame.y - tol && p.y <= frame.y + frame.h + tol;
  return (
    ((Math.abs(p.x - frame.x) <= tol || Math.abs(p.x - (frame.x + frame.w)) <= tol) && insideY) ||
    ((Math.abs(p.y - frame.y) <= tol || Math.abs(p.y - (frame.y + frame.h)) <= tol) && insideX)
  );
}

/** 端点贴近内腔（外框内缘）边缘，用于容器树/分割式中梃的连接判定 */
function touchesInnerEdge(p: Point, inner: Rect, tol: number): boolean {
  const insideX = p.x >= inner.x - tol && p.x <= inner.x + inner.w + tol;
  const insideY = p.y >= inner.y - tol && p.y <= inner.y + inner.h + tol;
  return (
    ((Math.abs(p.x - inner.x) <= tol || Math.abs(p.x - (inner.x + inner.w)) <= tol) && insideY) ||
    ((Math.abs(p.y - inner.y) <= tol || Math.abs(p.y - (inner.y + inner.h)) <= tol) && insideX)
  );
}

function touchesMullion(p: Point, m: DesignComponent, tol: number): boolean {
  if (m.w >= m.h) {
    const my = m.y + m.h / 2;
    return Math.abs(p.y - my) <= tol && p.x >= m.x - tol && p.x <= m.x + m.w + tol;
  }
  const mx = m.x + m.w / 2;
  return Math.abs(p.x - mx) <= tol && p.y >= m.y - tol && p.y <= m.y + m.h + tol;
}

function labelOf(c: DesignComponent): string {
  return c.label ?? `构件(${c.kind})`;
}

// ── 格子封闭分析 ─────────────────────────────────────────────

interface GridLine {
  fixed: number; // 竖线为 x，横线为 y
  from: number; // 竖线为 y0，横线为 x0
  to: number; // 竖线为 y1，横线为 x1
  /** 中梃带半宽：面板贴靠在带的任一侧面上不算跨越 */
  half: number;
}

const GRID_TOL = 6;

/**
 * 用中梃分割线把外框内部分成网格单元，做连通性分析：
 * - GRID_VIOLATION(error)：面板跨过分隔线，玻璃无法整块安装
 * - UNSEGMENTED(warning)：多个非推拉面板位于同一开放区域且无中梃分隔
 * - CELL_UNCOVERED(warning)：外框内存在未被玻璃/扇覆盖的分格区域
 */
function analyzeGridCellIssues(
  frame: DesignComponent | undefined,
  panels: DesignComponent[],
  mullions: DesignComponent[],
  issues: ValidationIssue[],
): void {
  if (!frame || !panels.length) return;

  const verticals: GridLine[] = [];
  const horizontals: GridLine[] = [];
  for (const m of mullions) {
    // 只丢弃块状/斜向构件：中梃必有细长边，通宽横梃的「长边>8」是常态，不能据此跳过
    if (Math.min(m.w, m.h) > Math.max(8, 0.12 * Math.min(frame.w, frame.h))) continue;
    if (m.h >= m.w) {
      const x = m.x + m.w / 2;
      if (x <= frame.x + EPS || x >= frame.x + frame.w - EPS) continue;
      verticals.push({ fixed: x, from: Math.max(m.y, frame.y), to: Math.min(m.y + m.h, frame.y + frame.h), half: m.w / 2 });
    } else {
      const y = m.y + m.h / 2;
      if (y <= frame.y + EPS || y >= frame.y + frame.h - EPS) continue;
      horizontals.push({ fixed: y, from: Math.max(m.x, frame.x), to: Math.min(m.x + m.w, frame.x + frame.w), half: m.h / 2 });
    }
  }
  if (!verticals.length && !horizontals.length) {
    // 无中梃：整个内框是一个分格，检查是否被多块非推拉面板占用
    const seen = new Map<string, DesignComponent>();
    for (const p of panels) {
      if (p.parentId && p.parentId !== frame.id) continue;
      if (contains(rectOf(frame), rectOf(p), EPS)) seen.set(p.id, p);
    }
    const nonSliding = [...seen.values()].filter((p) => p.kind !== 'slidingSash');
    if (nonSliding.length >= 2) {
      issues.push({
        level: 'warning',
        code: 'UNSEGMENTED',
        message: `面板「${labelOf(nonSliding[0])}」与「${labelOf(nonSliding[1])}」位于同一分格且之间缺少中梃分隔`,
        componentId: nonSliding[1].id,
      });
    }
    return;
  }

  // 中梃只跨越内腔（两端各留出外框料宽），而网格外边界是外框外缘 → 覆盖判定须让出这段内缩量
  const edgeInset = (): { x: number; y: number } => {
    if (!panels.length) return { x: 0, y: 0 };
    const x0 = Math.min(...panels.map((p) => p.x));
    const x1 = Math.max(...panels.map((p) => p.x + p.w));
    const y0 = Math.min(...panels.map((p) => p.y));
    const y1 = Math.max(...panels.map((p) => p.y + p.h));
    return {
      x: Math.max(0, Math.min(x0 - frame.x, frame.x + frame.w - x1, frame.w * 0.25)),
      y: Math.max(0, Math.min(y0 - frame.y, frame.y + frame.h - y1, frame.h * 0.25)),
    };
  };
  const inset = edgeInset();

  const xs = [...new Set([frame.x, frame.x + frame.w, ...verticals.map((v) => v.fixed)])].sort((a, b) => a - b);
  const ys = [...new Set([frame.y, frame.y + frame.h, ...horizontals.map((h) => h.fixed)])].sort((a, b) => a - b);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  if (nx < 1 || ny < 1) return;

  // 面板中心落格：只统计直接归属外框的面板（扇内玻璃随扇归属，不参与外框分格）
  const owners = new Map<string, DesignComponent[]>();
  for (const p of panels) {
    if (p.parentId && p.parentId !== frame.id) continue;
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    const ci = indexOf(xs, cx, nx);
    const cj = indexOf(ys, cy, ny);
    if (ci < 0 || cj < 0) continue;
    const key = `${ci},${cj}`;
    if (!owners.has(key)) owners.set(key, []);
    owners.get(key)!.push(p);
  }

  // 面板跨过分隔线 → 玻璃无法整块安装
  for (const p of panels) {
    const px0 = p.x;
    const px1 = p.x + p.w;
    const py0 = p.y;
    const py1 = p.y + p.h;
    // 跨越 = 从中梃带左侧一直伸到带右侧之外（只贴靠到带的一个面属正常接合，不算违规）
    const crossV = verticals.some(
      (v) => px0 < v.fixed - v.half - EPS && px1 > v.fixed + v.half + EPS && Math.min(v.to, py1) - Math.max(v.from, py0) > 10,
    );
    const crossH = horizontals.some(
      (h) => py0 < h.fixed - h.half - EPS && py1 > h.fixed + h.half + EPS && Math.min(h.to, px1) - Math.max(h.from, px0) > 10,
    );
    if (crossV || crossH) {
      issues.push({
        level: 'error',
        code: 'GRID_VIOLATION',
        message: `面板「${labelOf(p)}」跨越中梃分格线，玻璃无法整块安装`,
        componentId: p.id,
      });
    }
  }

  // 连通分量：被中梃分割的格子之间是否仍然连通
  const visited = new Set<string>();
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const start = `${i},${j}`;
      if (visited.has(start)) continue;
      const comp: string[] = [];
      const stack = [start];
      visited.add(start);
      while (stack.length) {
        const key = stack.pop()!;
        comp.push(key);
        const [ci, cj] = key.split(',').map(Number);
        const pushIf = (ni: number, nj: number) => {
          if (ni < 0 || ni >= nx || nj < 0 || nj >= ny) return;
          const nk = `${ni},${nj}`;
          if (visited.has(nk)) return;
          if (!edgeCovered(ci, cj, ni, nj, xs, ys, verticals, horizontals, ni !== ci ? inset.y : inset.x)) {
            visited.add(nk);
            stack.push(nk);
          }
        };
        pushIf(ci - 1, cj);
        pushIf(ci + 1, cj);
        pushIf(ci, cj - 1);
        pushIf(ci, cj + 1);
      }

      const seen = new Map<string, DesignComponent>();
      for (const key of comp) {
        for (const p of owners.get(key) ?? []) seen.set(p.id, p);
      }
      const uncovered = comp.filter((key) => !owners.has(key)).length;
      if (uncovered > 0) {
        issues.push({
          level: 'warning',
          code: 'CELL_UNCOVERED',
          message: `外框内存在 ${uncovered} 个未放置玻璃/开启扇的分格区域，可能漏画面板`,
          componentId: frame.id,
        });
      }
      const nonSliding = [...seen.values()].filter((p) => p.kind !== 'slidingSash');
      if (nonSliding.length >= 2) {
        issues.push({
          level: 'warning',
          code: 'UNSEGMENTED',
          message: `面板「${labelOf(nonSliding[0])}」与「${labelOf(nonSliding[1])}」位于同一分格且之间缺少中梃分隔`,
          componentId: nonSliding[1].id,
        });
      }
    }
  }
}

function indexOf(sorted: number[], value: number, maxIndex: number): number {
  for (let i = 0; i < maxIndex; i++) {
    if (sorted[i] - EPS <= value && value <= sorted[i + 1] + EPS) return i;
  }
  return -1;
}

function edgeCovered(
  ci: number,
  cj: number,
  ni: number,
  nj: number,
  xs: number[],
  ys: number[],
  verticals: GridLine[],
  horizontals: GridLine[],
  inset: number,
): boolean {
  if (ni !== ci) {
    const x = xs[Math.max(ci, ni)];
    return verticals.some(
      (v) => Math.abs(v.fixed - x) <= GRID_TOL && v.from <= ys[cj] + GRID_TOL + inset && v.to >= ys[cj + 1] - GRID_TOL - inset,
    );
  }
  const y = ys[Math.max(cj, nj)];
  return horizontals.some(
    (h) => Math.abs(h.fixed - y) <= GRID_TOL && h.from <= xs[ci] + GRID_TOL + inset && h.to >= xs[ci + 1] - GRID_TOL - inset,
  );
}

function seriesFamily(series: SeriesSpec): string {
  return (series as SeriesSpec & { windowFamily?: string }).windowFamily ?? 'mixed';
}