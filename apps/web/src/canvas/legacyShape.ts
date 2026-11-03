import type { ComponentKind, WindowType } from '@wdd/schema';

/**
 * 旧版 ShapeModel 的持久化/交换格式。
 *
 * 该类型只允许出现在旧方案导入、CRM 兼容输出与 3D 适配边界，不能作为运行时业务状态。
 */
export interface LegacyPoint {
  x: number;
  y: number;
}

export type LegacyShapeType = 'rect' | 'trapezoid' | 'gothic' | 'arch' | 'line' | 'text';

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
}
