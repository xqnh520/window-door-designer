import type { ComponentKind, DesignComponent, DesignModel, WindowDesign, WindowType } from '@wdd/schema';
import { arcFromChord, type FrameShape } from './outline.js';

/**
 * 旧版 ShapeModel 的持久化/交换格式（纯数据，无 UI 依赖）。
 *
 * 该类型只允许出现在旧方案导入、CRM 兼容输出与 3D 适配边界，不能作为运行时业务状态。
 * 迁移实现放在 core 而不是 apps/web，使其可被 Node 单测直接覆盖。
 */
export interface LegacyPoint {
  x: number;
  y: number;
}

/** 旧画布能表达的图形类型；新框形（六边形等）只出现在单向输出里，回读仍按旧六类校验 */
export type LegacyShapeType = FrameShape | 'line' | 'text';

export interface LegacySashData {
  hingeSide: 'left' | 'right' | 'top' | 'bottom';
  openDirection: 'in' | 'out';
  rect: { x: number; y: number; w: number; h: number };
  label: string;
}

export interface LegacyShape {
  id: string;
  type: LegacyShapeType;
  bbox: { x: number; y: number; w: number; h: number };
  topRatio: number;
  corners?: LegacyPoint[];
  p1?: LegacyPoint;
  p2?: LegacyPoint;
  widthMm?: number;
  curve?: { sagittaMm: number };
  contour?: LegacyPoint[];
  text: string;
  side?: 'left' | 'right';
  openDir?: 'in' | 'out';
  isDoor?: boolean;
  label?: string;
  sashes?: LegacySashData[];
  seriesId?: string;
  frameWidth?: number;
  glassInset?: number;
  componentKind?: ComponentKind;
  materialRole?: string;
  windowType?: WindowType;
  openSides?: ('up' | 'down' | 'left' | 'right')[];
}

export interface LegacyImportContext {
  design: Pick<WindowDesign, 'id' | 'name' | 'openingW' | 'openingH' | 'seriesId' | 'glassId'>;
}

/** 旧数据可接受的图形类型：只有这六类会进入迁移，新框形是单向输出 */
const READABLE_SHAPE_TYPES = new Set<string>(['rect', 'trapezoid', 'gothic', 'arch', 'line', 'text']);

const FRAME_SIDES = new Set<string>(['up', 'down', 'left', 'right']);

function readSides(value: unknown): ('up' | 'down' | 'left' | 'right')[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((side): side is 'up' | 'down' | 'left' | 'right' => typeof side === 'string' && FRAME_SIDES.has(side));
  return out.length ? out : undefined;
}

export interface LegacyNormalizeReport {
  shapes: LegacyShape[];
  /** 被丢弃的候选条目数（原始 JSON 仍应由调用方备份，不得只依赖迁移结果） */
  dropped: number;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readPoint(value: unknown): LegacyPoint | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const p = value as Record<string, unknown>;
  return finite(p.x) && finite(p.y) ? { x: p.x, y: p.y } : undefined;
}

function readPointList(value: unknown): LegacyPoint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const pts = value.map(readPoint).filter((p): p is LegacyPoint => !!p);
  return pts.length >= 3 ? pts : undefined;
}

function readBox(value: unknown): { x: number; y: number; w: number; h: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const b = value as Record<string, unknown>;
  if (!['x', 'y', 'w', 'h'].every((k) => finite(b[k]))) return undefined;
  if ((b.w as number) <= 0 || (b.h as number) <= 0) return undefined;
  return { x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number };
}

function readSashes(value: unknown): LegacySashData[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: LegacySashData[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const s = entry as Record<string, unknown>;
    const rect = readBox(s.rect);
    const hingeSide = s.hingeSide;
    const openDirection = s.openDirection;
    if (!rect) continue;
    if (hingeSide !== 'left' && hingeSide !== 'right' && hingeSide !== 'top' && hingeSide !== 'bottom') continue;
    if (openDirection !== 'in' && openDirection !== 'out') continue;
    out.push({ hingeSide, openDirection, rect, label: typeof s.label === 'string' ? s.label : '' });
  }
  return out.length ? out : undefined;
}

/** 宽松读取历史 JSON：保留能识别的字段，无法识别的条目计入 dropped，不静默当成空数据。 */
export function normalizeLegacyShapesWithReport(value: unknown): LegacyNormalizeReport {
  if (!Array.isArray(value)) return { shapes: [], dropped: 0 };
  const result: LegacyShape[] = [];
  let dropped = 0;
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      dropped += 1;
      continue;
    }
    const raw = candidate as Record<string, unknown>;
    const bbox = readBox(raw.bbox);
    if (typeof raw.id !== 'string' || !READABLE_SHAPE_TYPES.has(raw.type as string) || !bbox) {
      dropped += 1;
      continue;
    }
    const shape = raw as unknown as LegacyShape;
    const sashList = readSashes(raw.sashes);
    result.push({
      ...shape,
      id: raw.id,
      type: raw.type as LegacyShape['type'],
      bbox,
      topRatio: finite(raw.topRatio) ? raw.topRatio : 1,
      corners: readPointList(raw.corners),
      contour: readPointList(raw.contour),
      p1: readPoint(raw.p1),
      p2: readPoint(raw.p2),
      widthMm: finite(raw.widthMm) && raw.widthMm > 0 ? raw.widthMm : undefined,
      curve: raw.curve && typeof raw.curve === 'object' && finite((raw.curve as Record<string, unknown>).sagittaMm)
        ? { sagittaMm: (raw.curve as Record<string, number>).sagittaMm }
        : undefined,
      text: typeof raw.text === 'string' ? raw.text : '',
      label: typeof raw.label === 'string' ? raw.label : undefined,
      sashes: sashList,
      openSides: readSides(raw.openSides),
    });
  }
  return { shapes: result, dropped };
}

/** 宽松读取历史 JSON，并在导入边界补齐旧版本缺失的字段。 */
export function normalizeLegacyShapes(value: unknown): LegacyShape[] {
  return normalizeLegacyShapesWithReport(value).shapes;
}

const DEFAULT_MULLION_MM = 40;
const AREA_TYPES = new Set<LegacyShape['type']>(['rect', 'trapezoid', 'arch', 'gothic']);

/** 旧 ShapeModel JSON → DesignModel（一次性导入解析；不改变运行时状态）。 */
export function buildDesignModelFromLegacyShapes(shapes: LegacyShape[], state: LegacyImportContext): DesignModel | null {
  const areaShapes = shapes.filter((s) => AREA_TYPES.has(s.type));
  const lineShapes = shapes.filter((s) => s.type === 'line');
  if (!areaShapes.length) return null;

  // 组合窗支持：显式标记为外框的图形都作为外框；否则取最大图形兜底
  const explicitFrames = areaShapes.filter((s) => s.componentKind === 'outerFrame');
  const frameShapes = explicitFrames.length ? explicitFrames : [largestShape(areaShapes)];
  const frameIds = new Set(frameShapes.map((f) => f.id));
  const components: DesignComponent[] = frameShapes.map((fs) => {
    const shape = frameShapeOf(fs);
    const contour = frameContourOf(fs);
    return {
      id: `c-frame-${fs.id}`,
      kind: 'outerFrame',
      x: fs.bbox.x,
      y: fs.bbox.y,
      w: fs.bbox.w,
      h: fs.bbox.h,
      shape,
      topRatio: shape === 'trapezoid' ? clampRatio(fs.topRatio) : undefined,
      // 原始轮廓优先保留；即使识别成梯形/拱形也带上，避免拖拽过的角点被采样轮廓覆盖
      contour: contour ? flatten(contour) : undefined,
      openSides: fs.openSides?.length ? fs.openSides : undefined,
      sourceShapeId: fs.id,
    };
  });

  /** 面板/中梃归属：中心点所在的最近外框，未命中回退第一个外框 */
  const hostFrameId = (shape: LegacyShape): string => {
    const cx = shape.bbox.x + shape.bbox.w / 2;
    const cy = shape.bbox.y + shape.bbox.h / 2;
    const host = frameShapes.find(
      (f) => cx >= f.bbox.x && cx <= f.bbox.x + f.bbox.w && cy >= f.bbox.y && cy <= f.bbox.y + f.bbox.h,
    );
    return `c-frame-${(host ?? frameShapes[0]).id}`;
  };

  for (const shape of areaShapes) {
    if (frameIds.has(shape.id)) continue;
    const sashes = shape.sashes ?? [];
    if (sashes.length) {
      components.push(...sashComponentsOf(shape, hostFrameId(shape)));
      continue;
    }
    const kind = shape.componentKind ?? inferKind(shape);
    components.push({
      id: `c-glass-${shape.id}`,
      kind,
      x: shape.bbox.x,
      y: shape.bbox.y,
      w: shape.bbox.w,
      h: shape.bbox.h,
      sourceShapeId: shape.id,
      parentId: hostFrameId(shape),
      windowType: shape.windowType ?? inferWindowType(shape),
      hingeSide: shape.side,
      openDirection: shape.openDir,
      label: shape.label,
      contour: shape.contour ? flatten(shape.contour) : undefined,
    });
  }

  for (const line of lineShapes) {
    const kind = line.componentKind === 'mullion' || line.materialRole === 'mullion' ? 'mullion' : 'annotation';
    if (kind === 'annotation') continue;
    components.push({ ...mullionComponentOf(line), parentId: hostFrameId(line) });
  }

  return {
    id: state.design.id,
    name: state.design.name,
    openingW: state.design.openingW,
    openingH: state.design.openingH,
    seriesId: state.design.seriesId,
    glassId: state.design.glassId,
    components,
  };
}

/** 旧开口扇 → 单个/对开扇构件；宿主矩形只用于定位，树反推仍由外框内腔决定 */
function sashComponentsOf(host: LegacyShape, parentId: string): DesignComponent[] {
  const sashes = host.sashes ?? [];
  const frameParent = parentId;
  const double = detectDoubleSash(sashes);
  if (double) {
    const first = sashes.find((s) => s.rect.x === double.localX) ?? sashes[0];
    const kind = sashKindOf(host, first);
    return [{
      id: `c-sash-${host.id}-pair`,
      kind,
      x: host.bbox.x + double.localX,
      y: host.bbox.y + double.localY,
      w: Math.max(1, double.localW),
      h: Math.max(1, double.localH),
      sourceShapeId: host.id,
      parentId: frameParent,
      windowType: windowTypeOfSash(host, kind),
      openDirection: first.openDirection,
      label: host.label ?? first.label,
      leaves: 2,
      meetingWidthMm: double.meetingWidthMm,
    }];
  }
  return sashes.map((sash, i) => {
    const kind = sashKindOf(host, sash);
    return {
      id: `c-sash-${host.id}-${i}`,
      kind,
      x: host.bbox.x + sash.rect.x,
      y: host.bbox.y + sash.rect.y,
      w: Math.max(1, sash.rect.w),
      h: Math.max(1, sash.rect.h),
      sourceShapeId: host.id,
      parentId: frameParent,
      windowType: windowTypeOfSash(host, kind),
      hingeSide: sash.hingeSide,
      openDirection: sash.openDirection,
      label: sash.label || host.label,
    };
  });
}

interface DoubleSash {
  localX: number;
  localY: number;
  localW: number;
  localH: number;
  meetingWidthMm?: number;
}

/**
 * 对开扇识别：同一宿主内两片等高等宽、左右并排、外开铰链镜像的扇。
 * 旧数据结构没有 leaves 字段，只能据此还原；不满足条件时保持为两个独立扇，不做猜测。
 */
function detectDoubleSash(sashes: LegacySashData[]): DoubleSash | null {
  if (sashes.length !== 2) return null;
  const [a, b] = sashes;
  const eps = 2;
  if (Math.abs(a.rect.y - b.rect.y) > eps || Math.abs(a.rect.h - b.rect.h) > eps) return null;
  if (Math.abs(a.rect.w - b.rect.w) > eps) return null;
  const left = a.rect.x <= b.rect.x ? a : b;
  const right = a.rect.x <= b.rect.x ? b : a;
  if (left.hingeSide !== 'left' || right.hingeSide !== 'right') return null;
  const gap = right.rect.x - (left.rect.x + left.rect.w);
  if (gap < -5 || gap > 200) return null;
  return {
    localX: left.rect.x,
    localY: left.rect.y,
    localW: right.rect.x + right.rect.w - left.rect.x,
    localH: left.rect.h,
    meetingWidthMm: gap >= 10 ? gap : undefined,
  };
}

const SASH_KINDS = new Set<DesignComponent['kind']>([
  'casementSash', 'slidingSash', 'topHungSash', 'screen', 'foldSash', 'pushInSash', 'sashInSash',
]);

function sashKindOf(host: LegacyShape, sash: LegacySashData): DesignComponent['kind'] {
  if (host.componentKind && SASH_KINDS.has(host.componentKind)) return host.componentKind;
  switch (host.windowType) {
    case 'sliding':
      return 'slidingSash';
    case 'topHinged':
      return 'topHungSash';
    case 'casementUp':
    case 'tiltSlide':
      return 'casementSash';
    default:
      return sash.hingeSide === 'top' || sash.hingeSide === 'bottom' ? 'topHungSash' : 'casementSash';
  }
}

function windowTypeOfSash(host: LegacyShape, kind: DesignComponent['kind']): WindowType {
  if (host.windowType && host.windowType !== 'fixed') return host.windowType;
  switch (kind) {
    case 'slidingSash':
      return 'sliding';
    case 'topHungSash':
      return 'topHinged';
    default:
      return 'casement';
  }
}

function frameShapeOf(shape: LegacyShape): DesignComponent['shape'] {
  switch (shape.type) {
    case 'trapezoid':
      return 'trapezoid';
    case 'arch':
      return 'arch';
    case 'gothic':
      return 'gothic';
    default:
      return 'rect';
  }
}

/** 原始轮廓：拖拽后的四角点优先于自由轮廓，避免采样形状覆盖用户历史编辑 */
function frameContourOf(shape: LegacyShape): LegacyPoint[] | undefined {
  if (shape.corners && shape.corners.length >= 3) return shape.corners;
  if (shape.contour && shape.contour.length >= 3) return shape.contour;
  return undefined;
}

/**
 * 旧直线中梃 → 中梃构件。
 * bbox 必须按「中心线 ± 料厚/2」重建：旧数据 bbox 或 p1/p2 单边为 0 时，
 * 直接用 bbox 宽高会把竖梃判成横梃（P1 迁移丢失的根因）。
 */
function mullionComponentOf(line: LegacyShape): DesignComponent {
  const thickness = Math.max(1, line.widthMm ?? DEFAULT_MULLION_MM);
  const seg = centerlineOf(line);
  const dx = seg.b.x - seg.a.x;
  const dy = seg.b.y - seg.a.y;
  const len = Math.hypot(dx, dy) || Math.max(1, Math.max(line.bbox.w, line.bbox.h));
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy * (thickness / 2);
  const ny = ux * (thickness / 2);
  const band: LegacyPoint[] = [
    { x: seg.a.x + nx, y: seg.a.y + ny },
    { x: seg.b.x + nx, y: seg.b.y + ny },
    { x: seg.b.x - nx, y: seg.b.y - ny },
    { x: seg.a.x - nx, y: seg.a.y - ny },
  ];
  const box = boxOf(band);
  const slope = Math.abs(dx) > 0.5 && Math.abs(dy) > 0.5 ? (dx * dy > 0 ? 'diagonal' : 'antiDiagonal') : undefined;
  const sagittaMm = line.curve?.sagittaMm && Math.abs(line.curve.sagittaMm) > 1e-6 ? line.curve.sagittaMm : undefined;
  return {
    id: `c-mullion-${line.id}`,
    kind: 'mullion',
    x: round(box.x),
    y: round(box.y),
    w: Math.max(1, round(box.w)),
    h: Math.max(1, round(box.h)),
    sourceShapeId: line.id,
    windowType: 'fixed',
    slope,
    thicknessMm: thickness,
    sagittaMm,
    arcLenMm: slope ? Math.max(1, round(len)) : sagittaMm ? Math.max(1, round(arcLength(seg, sagittaMm))) : undefined,
    contour: slope ? flatten(band) : undefined,
  };
}

function centerlineOf(line: LegacyShape): { a: LegacyPoint; b: LegacyPoint } {
  const { x, y, w, h } = line.bbox;
  if (line.p1 && line.p2 && (line.p1.x !== line.p2.x || line.p1.y !== line.p2.y)) {
    return { a: line.p1, b: line.p2 };
  }
  return w >= h
    ? { a: { x, y: y + h / 2 }, b: { x: x + w, y: y + h / 2 } }
    : { a: { x: x + w / 2, y }, b: { x: x + w / 2, y: y + h } };
}

function arcLength(seg: { a: LegacyPoint; b: LegacyPoint }, sagittaMm: number): number {
  const arc = arcFromChord(seg.a, seg.b, sagittaMm);
  return arc ? Math.abs(arc.rMm * (arc.sweepDeg * Math.PI) / 180) : Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
}

function boxOf(pts: LegacyPoint[]): { x: number; y: number; w: number; h: number } {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(1, Math.max(...xs) - x), h: Math.max(1, Math.max(...ys) - y) };
}

function flatten(pts: LegacyPoint[]): number[] {
  return pts.flatMap((p) => [p.x, p.y]);
}

function largestShape(shapes: LegacyShape[]): LegacyShape {
  return shapes.reduce((best, next) => (area(next) > area(best) ? next : best), shapes[0]);
}

function clampRatio(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
}

function inferKind(shape: LegacyShape): DesignComponent['kind'] {
  if (shape.componentKind === 'mullion' || shape.materialRole === 'mullion') return 'mullion';
  if (shape.windowType === 'sliding') return 'slidingSash';
  if (shape.windowType === 'topHinged') return 'topHungSash';
  if (shape.componentKind === 'annotation') return 'annotation';
  if (shape.side || shape.openDir) return 'casementSash';
  return 'fixedGlass';
}

function inferWindowType(shape: LegacyShape): WindowType {
  if (shape.windowType) return shape.windowType;
  if (shape.side || shape.openDir) return 'casement';
  return 'fixed';
}

function area(shape: LegacyShape): number {
  return shape.bbox.w * shape.bbox.h;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
