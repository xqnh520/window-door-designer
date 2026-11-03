import { z } from 'zod';
import { WindowTypeSchema } from './material.js';

export const ComponentKindSchema = z.enum([
  'outerFrame',
  'fixedGlass',
  'casementSash',
  'slidingSash',
  'topHungSash',
  'mullion',
  'combiner',
  'screen',
  'annotation',
  // 构件体系扩展（windoorcraft 对齐）：安全 / 装饰 / 玻璃 / 组合 / 折叠 / 推拉家族
  'securityFrame',
  'securityBar',
  'waterGuard',
  'decorBar',
  'frostedGlass',
  'subSash',
  'sashInSash',
  'pushInSash',
  'foldSash',
  'foldScreen',
  'fakeMullion',
  'sashBead',
  'screenBead',
  'sashMullion',
  'screenMullion',
  'panelBead',
]);

export type ComponentKind = z.infer<typeof ComponentKindSchema>;

export const DesignComponentSchema = z.object({
  id: z.string(),
  kind: ComponentKindSchema,
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
  /** 异形外框轮廓（world mm，扁平 [x0,y0,...]；仅 outerFrame 且非矩形时携带） */
  contour: z.array(z.number()).optional(),
  /** 外框形状：与 core outline.ts 的 FRAME_SHAPE_IDS 同清单（单测防漂移，含方向变体） */
  shape: z
    .enum([
      'rect', 'roundedRect', 'trapezoid', 'trapezoidRight', 'trapezoidDown', 'trapezoidLeft', 'parallelogram',
      'lShape', 'notchTop', 'earsTop',
      'arch', 'gothic', 'peakPentagon', 'angledPentagon', 'halfCircle', 'quarterCircle', 'quarterCircleLeft',
      'triangle', 'rightTriangle', 'rightTriangleLeft', 'diamond', 'hexagon', 'hexagonTop', 'octagon', 'circle',
    ])
    .optional(),
  sourceShapeId: z.string().optional(),
  /** 异形外框梯形顶边宽比（0..1，仅 shape 为梯形族时有意义；旧数据由 topRatio 迁移） */
  topRatio: z.number().min(0).max(1).optional(),
  /** 外框缺边（开放框 / 传递窗 / 吧台窗 / 肯德基门落地洞）：被缺的那条边不画料、不出型材 */
  openSides: z.array(z.enum(['up', 'down', 'left', 'right'])).optional(),
  /** 非轴对齐中梃带（弧带 / 斜带）的中心线长度（mm）；有值时 BOM 按它出料而非 w/h */
  arcLenMm: z.number().positive().optional(),
  /** 中梃垂直于料的真实厚度（mm）：斜带 / 弧带的 bbox 看不出厚度，迁移与往返时必须显式携带 */
  thicknessMm: z.number().positive().optional(),
  /** 弧梃弧高（mm，相对中心线弦，正=朝左/上凸）：旧方案迁移与容器树往返用 */
  sagittaMm: z.number().optional(),
  /** 斜梃朝向：diagonal=↘（平行左上→右下对角线），antiDiagonal=↗；仅 mullion 使用 */
  slope: z.enum(['diagonal', 'antiDiagonal']).optional(),
  /** 扇叶数：2=对开扇（一个构件两片扇，中缝为两根对开料）；缺省=单扇 */
  leaves: z.number().int().min(1).max(2).optional(),
  /** 对开扇中缝料（对开料）宽度（mm），仅 leaves=2 时有值 */
  meetingWidthMm: z.number().positive().optional(),
  /** 扇面填充：louver=百叶帘片（不出玻璃与压线）；panel=上玻下板（玻璃只剩上半）；缺省=glass */
  infill: z.enum(['glass', 'louver', 'panel']).optional(),
  /** 肯德基门下板高度（mm），仅 infill='panel' 时有值 */
  panelHeightMm: z.number().positive().optional(),
  parentId: z.string().optional(),
  windowType: WindowTypeSchema.optional(),
  /** 构件类型注册表 id（windoorcraft 体系扩展） */
  roleType: z.string().optional(),
  hingeSide: z.enum(['left', 'right', 'top', 'bottom']).optional(),
  openDirection: z.enum(['in', 'out']).optional(),
  label: z.string().optional(),
});

export type DesignComponent = z.infer<typeof DesignComponentSchema>;

/** 配件（windoorcraft 16 类配件体系）：挂载在树/叶子/拼樘上，随 DesignModel 贯通 BOM/报价 */
export const DesignFittingSchema = z.object({
  /** 配件类型（fitting-registry 的 FittingType） */
  type: z.string(),
  /** 宿主组件 id */
  hostId: z.string(),
  /** 宿主层级：tree=整窗外框 / area=分格面板 / combiner=拼樘料 */
  hostKind: z.enum(['tree', 'area', 'combiner']),
  hostLabel: z.string().optional(),
  count: z.number().int().positive().optional(),
  side: z.string().optional(),
  /** 逐根下料长度（mm）：仅 profile 类派生配件用（如玻璃格条），给出时按长度分组出料而非按宿主周长估 */
  lengthsMm: z.array(z.number().int().positive()).optional(),
});

export type DesignFitting = z.infer<typeof DesignFittingSchema>;

export const DesignModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  openingW: z.number().positive(),
  openingH: z.number().positive(),
  seriesId: z.string(),
  glassId: z.string(),
  components: z.array(DesignComponentSchema),
  fittings: z.array(DesignFittingSchema).optional(),
});

export type DesignModel = z.infer<typeof DesignModelSchema>;
