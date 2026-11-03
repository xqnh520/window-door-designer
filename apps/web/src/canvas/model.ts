/**
 * 旧图形编辑模型（新增 gothic 尖拱）。仅供兼容几何工具使用，不是运行时业务状态。
 * 图形节点统一为 Konva.Group（放在 bbox 原点，子图形用相对坐标 0..w/0..h），
 * 便于 Konva.Transformer 缩放后把 scale 烘焙回模型。
 */
import type { ComponentKind, WindowType } from '@wdd/schema';
import {
  sampleOutline as coreSampleOutline,
  insetPolygon as coreInsetPolygon,
  trapezoidCorners as coreTrapezoidCorners,
  gothicArchPath as coreGothicArchPath,
  archpath as coreArchpath,
  shapeCentroid as coreShapeCentroid,
  type FrameShape,
  type Pt,
} from '@wdd/core';

export type ShapeType = 'rect' | 'trapezoid' | 'gothic' | 'arch' | 'line' | 'text';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ShapeModel {
  id: string;
  type: ShapeType;
  bbox: Box;
  topRatio: number;
  corners?: Pt[];
  p1?: Pt;
  p2?: Pt;
  text: string;
  /** 平开窗：铰链侧 / 开启方向 / 构件类型 / 扇位标注 */
  side?: 'left' | 'right';
  openDir?: 'in' | 'out';
  isDoor?: boolean;
  label?: string;
  /** 容器内绘制的平开扇列表（容器局部坐标） */
  sashes?: SashData[];
  /** 型材系列ID（关联型材库） */
  seriesId?: string;
  /** 型材宽度（mm） */
  frameWidth?: number;
  /** 玻璃内缩量（mm） */
  glassInset?: number;
  /** 门窗业务构件类型；用于 DesignModel/BOM 转换 */
  componentKind?: ComponentKind;
  /** BOM 材料角色 */
  materialRole?: string;
  /** 明确窗型 */
  windowType?: WindowType;
}

/**
 * 动态计算内腔边界，替代Controller硬编码
 */
export function calcInnerBox(m: ShapeModel): Box {
  const fw = m.frameWidth ?? 60;
  return { x: fw, y: fw, w: Math.max(0, m.bbox.w - fw*2), h: Math.max(0, m.bbox.h - fw*2) };
}

/**
 * 校验并添加扇区，写入前校验扇区矩形是否完全在宿主内腔范围内
 */
export function validateAndAddSash(m: ShapeModel, sash: SashData): boolean {
  if (!m.sashes) m.sashes = [];
  
  const innerBox = calcInnerBox(m);
  // 检查扇区是否完全在内腔范围内
  const sashRight = sash.rect.x + sash.rect.w;
  const sashBottom = sash.rect.y + sash.rect.h;
  
  if (sash.rect.x < innerBox.x ||
      sash.rect.y < innerBox.y ||
      sashRight > innerBox.x + innerBox.w ||
      sashBottom > innerBox.y + innerBox.h) {
    console.warn('扇区超出内腔范围', { sash, innerBox });
    return false;
  }
  
  m.sashes.push(sash);
  return true;
}

export type HingeSide = 'left' | 'right' | 'top' | 'bottom';

/** 平开扇数据（相对于宿主容器的局部坐标） */
export interface SashData {
  hingeSide: HingeSide;
  openDirection: 'in' | 'out';
  rect: Box;
  label: string;
}

export const cloneModel = (m: ShapeModel): ShapeModel => ({
  ...m,
  bbox: { ...m.bbox },
  corners: m.corners ? m.corners.map((c) => ({ ...c })) : undefined,
  p1: m.p1 ? { ...m.p1 } : undefined,
  p2: m.p2 ? { ...m.p2 } : undefined,
  sashes: m.sashes ? m.sashes.map((s) => ({ ...s, rect: { ...s.rect } })) : undefined,
  frameWidth: m.frameWidth,
  glassInset: m.glassInset,
  seriesId: m.seriesId,
  componentKind: m.componentKind,
  materialRole: m.materialRole,
  windowType: m.windowType,
});

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
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

export function trapezoidCorners(m: ShapeModel): Pt[] {
  return coreTrapezoidCorners(m.bbox, m.topRatio || 0.6) as Pt[];
}

/** 尖拱（哥特拱）路径：底部从 BL 经两个弧线到 BR，顶部交于尖点 C=(x+w/2, y) */
export function gothicArchPath(m: ShapeModel): string {
  return coreGothicArchPath(m.bbox);
}

/** 尖拱路径近似长度（二次贝塞尔半段长度） */
export function gothicSideLen(m: ShapeModel): number {
  const b = m.bbox;
  const blv = Math.hypot(b.w / 2, b.h);
  return Math.round(blv * 0.9 + b.h * 0.15);
}

/** 多边形按距离向质心内缩 */
export function insetPolygon(pts: Pt[], inset: number): Pt[] {
  return coreInsetPolygon(pts, inset) as Pt[];
}

/**
 * 门窗外框轮廓采样：返回闭合多边形（世界 mm）。
 * inset=0 为外框外轮廓；inset=series.frameWidth 为内轮廓（玻璃区）。
 * 矩形/梯形取角点；拱形/尖拱对弧线二次贝塞尔采样（每段 8 点）。
 */
export function sampleOutline(m: ShapeModel, inset: number): Pt[] {
  return coreSampleOutline(m.type as FrameShape, m.bbox, { inset, topRatio: m.topRatio || 0.6 }) as Pt[];
}

/** 半圆拱（拱形）路径：底部横边 + 顶部半圆弧 */
export function archpath(m: ShapeModel): string {
  return coreArchpath(m.bbox);
}

export function shapeCentroid(m: ShapeModel): Pt {
  if (m.type === 'line') {
    return { x: (m.p1!.x + m.p2!.x) / 2, y: (m.p1!.y + m.p2!.y) / 2 };
  }
  return coreShapeCentroid(m.type as FrameShape, m.bbox, m.topRatio) as Pt;
}

/** 由拖拽两点生成初始模型（外框/固定玻璃/梯形/尖拱/直线/文字） */
export function buildModel(
  type: ShapeType,
  a: Pt,
  b: Pt,
  defaults?: { seriesId?: string; frameWidth?: number; glassInset?: number; componentKind?: ComponentKind; materialRole?: string; windowType?: WindowType }
): ShapeModel {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.max(Math.abs(b.x - a.x), 20);
  const h = Math.max(Math.abs(b.y - a.y), 20);
  const bbox: Box = { x, y, w, h };
  
  if (type === 'line') {
    return { 
      id: '', type, bbox, topRatio: 1, p1: { ...a }, p2: { ...b }, text: '',
      seriesId: defaults?.seriesId,
      frameWidth: defaults?.frameWidth,
      glassInset: defaults?.glassInset
      ,componentKind: defaults?.componentKind ?? 'annotation',
      materialRole: defaults?.materialRole,
      windowType: defaults?.windowType
    };
  }
  if (type === 'text') {
    return { 
      id: '', type, bbox: { x, y, w: Math.max(w, 120), h: Math.max(h, 40) }, topRatio: 1, text: '文本',
      seriesId: defaults?.seriesId,
      frameWidth: defaults?.frameWidth,
      glassInset: defaults?.glassInset
      ,componentKind: defaults?.componentKind ?? 'annotation',
      materialRole: defaults?.materialRole,
      windowType: defaults?.windowType
    };
  }
  if (type === 'trapezoid') {
    const tw = w * 0.6;
    const tlx = x + (w - tw) / 2;
    const corners: Pt[] = [
      { x: tlx, y },
      { x: tlx + tw, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
    return { 
      id: '', type, bbox, topRatio: 0.6, corners, text: '',
      seriesId: defaults?.seriesId,
      frameWidth: defaults?.frameWidth,
      glassInset: defaults?.glassInset
      ,componentKind: defaults?.componentKind ?? 'annotation',
      materialRole: defaults?.materialRole,
      windowType: defaults?.windowType
    };
  }
  const base: ShapeModel = { 
    id: '', type, bbox, topRatio: 1, text: '',
    seriesId: defaults?.seriesId,
    frameWidth: defaults?.frameWidth,
    glassInset: defaults?.glassInset,
    componentKind: defaults?.componentKind,
    materialRole: defaults?.materialRole,
    windowType: defaults?.windowType
  };
  if (type === 'rect') {
    // 矩形默认作为固定玻璃构件；平开扇由 sashes/openWindow 工具表达。
    base.isDoor = false;
    base.label = 'A1';
    base.componentKind = 'fixedGlass';
    base.materialRole = 'glass';
    base.windowType = 'fixed';
  }
  return base;
}


/** 标注文本编辑 → 几何补丁（由 React 层在提交标注输入时调用） */
export function applyLabelEdit(m: ShapeModel, key: string, value: number): Partial<ShapeModel> {
  const v = Math.max(value, 20);
  switch (m.type) {
    case 'rect': {
      const b = { ...m.bbox };
      if (key === 'top' || key === 'bottom') b.w = v;
      else b.h = v;
      return { bbox: b };
    }
    case 'trapezoid': {
      const c = trapezoidCorners(m).map((p) => ({ ...p }));
      if (key === 'top') {
        const bottomW = Math.max(dist(c[2], c[3]), 1);
        const tw = Math.min(v, bottomW);
        const midX = (c[2].x + c[3].x) / 2;
        c[0] = { x: midX - tw / 2, y: c[0].y };
        c[1] = { x: midX + tw / 2, y: c[1].y };
      } else if (key === 'bottom') {
        c[2] = { x: c[3].x + v, y: c[2].y };
      }
      return { corners: c, bbox: bBoxOf(c) };
    }
    case 'gothic': {
      const b = { ...m.bbox };
      if (key === 'bottom') b.w = v;
      else b.h = v;
      return { bbox: b };
    }
    case 'arch': {
      const b = { ...m.bbox };
      if (key === 'bottom') b.w = v;
      else b.h = v;
      return { bbox: b };
    }
    case 'line': {
      const p1 = m.p1!;
      const p2 = m.p2!;
      const d = dist(p1, p2);
      if (d < 1) return {};
      const u = { x: (p2.x - p1.x) / d, y: (p2.y - p1.y) / d };
      return { p2: { x: p1.x + u.x * v, y: p1.y + u.y * v } };
    }
    default:
      return {};
  }
}
