import { z } from 'zod';

export const WindowTypeSchema = z.enum([
  'fixed',
  'casement',
  'sliding',
  'topHinged',
  'casementUp',
  'tiltSlide',
]);

export type WindowType = z.infer<typeof WindowTypeSchema>;

export const WindowTypeLabel: Record<WindowType, string> = {
  fixed: '固定窗',
  casement: '平开窗',
  sliding: '推拉窗',
  topHinged: '上悬窗',
  casementUp: '内开内倒',
  tiltSlide: '内倒平移扇',
};

export const ProfileCategorySchema = z.enum([
  'frame',
  'sash',
  'mullion',
  'bead',
  'track',
  'sill',
  'auxiliary',
]);

export type ProfileCategory = z.infer<typeof ProfileCategorySchema>;

export const ProfileCategoryLabel: Record<ProfileCategory, string> = {
  frame: '框料',
  sash: '扇料',
  mullion: '中梃',
  bead: '压线',
  track: '滑轨',
  sill: '下滑',
  auxiliary: '附框',
};

// =====================================================================
// 出料行（对标 windoorcraft product_bar）：系列公式按「行」组织，
// 每行 = 取料角色 + 边位 + 长度公式(可 cc-N 引用 formulaBank 或内联表达式) + 数量 + 条件
// =====================================================================

/** 边位：上/下（横料）、左/右（竖料）；空数组 = 非边位行（中梃/角码等） */
export const CutSideSchema = z.enum(['up', 'down', 'left', 'right']);
export type CutSide = z.infer<typeof CutSideSchema>;

/** 求值粒度：window = 每整窗求值一次（外框/滑轨等）；panel = 每个扇区求值一次（扇料/压线等） */
export const CutScopeSchema = z.enum(['window', 'panel']);
export type CutScope = z.infer<typeof CutScopeSchema>;

/** 出料行计量单位：支（按根）或 米（按长度累计，如压线） */
export const CutUnitSchema = z.enum(['支', '米']);
export type CutUnit = z.infer<typeof CutUnitSchema>;

export const SeriesCutRowSchema = z.object({
  id: z.string().min(1),
  /** 出料行名（BOM 展示名，如 边框 / 扇料(横) / 压线） */
  label: z.string().min(1, '出料行名称必填'),
  /** 取料角色：走 series.profileRoles 映射（兼容 viewEnhance 等非 category 键） */
  role: z.string().min(1, '请选择取料角色'),
  /** 边位：n 边展开 n×count 根，长度公式只求值一次、所有边共享；缺省 [] = 非边位行 */
  side: z.array(CutSideSchema).optional(),
  /** 长度公式（mm）：cc-N 引用 formulaBank[N]，或直接写内联表达式；空/非法回退内置算法 */
  length: z.string().optional(),
  /** 每边数量表达式（如 sashCount*2；推拉边框 count 2）：缺省 '1' */
  count: z.string().optional(),
  /** 行级切角（如 '45-45' / '90-90'），透传给下料；缺省按系列 cornerType */
  angle: z.string().optional(),
  /** 有效条件：`变量="枚举值"` 用 && 连接；空 = 永真 */
  condition: z.string().optional(),
  /** 颜色覆盖（缺省空 = 系列/型材默认色） */
  color: z.string().optional(),
  /** 求值粒度：缺省 window */
  scope: CutScopeSchema.optional(),
  /** 计量单位：缺省支 */
  unit: CutUnitSchema.optional(),
});
export type SeriesCutRow = z.infer<typeof SeriesCutRowSchema>;

/** 系列工艺约束：校验引擎读取，未配置的项回退到校验器默认值 */
export const SeriesConstraintsSchema = z.object({
  /** 开启扇最小/最大宽高（mm），超出即工艺不可行 */
  minSashW: z.number().nonnegative().optional(),
  minSashH: z.number().nonnegative().optional(),
  maxSashW: z.number().nonnegative().optional(),
  maxSashH: z.number().nonnegative().optional(),
  /** 玻璃最小宽高（mm） */
  minGlassW: z.number().nonnegative().optional(),
  minGlassH: z.number().nonnegative().optional(),
  /** 单片玻璃最大面积（㎡），超出存在破碎/吊装风险 */
  maxGlassAreaM2: z.number().positive().optional(),
  /** 构件最小边长（mm），比这更小的构件视为无法加工 */
  minComponentSize: z.number().nonnegative().optional(),
}).default({});

export type SeriesConstraints = z.infer<typeof SeriesConstraintsSchema>;

export const SeriesSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  windowFamily: z.enum(['fixed', 'casement', 'sliding', 'mixed']).default('mixed'),
  installGap: z.number().positive(),
  frameWidth: z.number().positive(),
  sashWidth: z.number().positive(),
  overlap: z.number().nonnegative(),
  glassGap: z.number().nonnegative(),
  beadWidth: z.number().nonnegative(),
  cornerType: z.enum(['45', '90']),
  aluminumPrice: z.number().nonnegative(),
  profileRoles: z.record(z.string()).default({}),
  /* ---- windoorcraft 出料行结构（v2） ---- */
  /** 公式库：出料行 length 可用 `cc-N` 引用这里（N → 表达式） */
  formulaBank: z.record(z.string().min(1)).default({}),
  /** 料宽字典（frame/sash/bead/... mm）：公式上下文可引用；与显式 frameWidth 等字段并存，显式字段优先 */
  showSetting: z.record(z.number().nonnegative()).default({}),
  /** 出料行表：按 边位×数量 展开；未配置行的角色回退内置算法 */
  cuts: z.array(SeriesCutRowSchema).default([]),
  constraints: SeriesConstraintsSchema.optional(),
});

export type SeriesSpec = z.infer<typeof SeriesSpecSchema>;

export const ProfileSchema = z.object({
  id: z.string(),
  seriesId: z.string(),
  code: z.string(),
  name: z.string(),
  category: ProfileCategorySchema,
  sectionWidth: z.number().nonnegative(),
  unitPrice: z.number().nonnegative(),
  color: z.string().default('香槟'),
});

export type Profile = z.infer<typeof ProfileSchema>;

export const GlassSchema = z.object({
  id: z.string(),
  name: z.string(),
  thickness: z.number().positive(),
  layers: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
});

export type Glass = z.infer<typeof GlassSchema>;

export const HardwareSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  unit: z.enum(['个', '支', '套', '只', '把']),
  unitPrice: z.number().nonnegative(),
  windowTypes: z.array(WindowTypeSchema),
});

export type Hardware = z.infer<typeof HardwareSchema>;

export const WindowPanelSchema = z.object({
  id: z.string(),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  windowType: WindowTypeSchema,
  hasSash: z.boolean().default(false),
});

export type WindowPanel = z.infer<typeof WindowPanelSchema>;

export const WindowDesignSchema = z.object({
  id: z.string(),
  name: z.string(),
  seriesId: z.string(),
  openingW: z.number().int().positive(),
  openingH: z.number().int().positive(),
  glassId: z.string().default('g-5-12a-5'),
  panels: z.array(WindowPanelSchema),
  note: z.string().default(''),
});

export type WindowDesign = z.infer<typeof WindowDesignSchema>;

export const AccessorySchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  unit: z.enum(['米', '卷', '包', '盒', '个']),
  unitPrice: z.number().nonnegative(),
  perM2: z.number().positive().describe('每平方米用量，用于按计价面积自动算料'),
});

export type Accessory = z.infer<typeof AccessorySchema>;

export const MaterialLibrarySchema = z.object({
  series: z.array(SeriesSpecSchema),
  profiles: z.array(ProfileSchema),
  glass: z.array(GlassSchema),
  hardware: z.array(HardwareSchema),
  accessory: z.array(AccessorySchema).default([]),
});

export type MaterialLibrary = z.infer<typeof MaterialLibrarySchema>;

export const validateLibrary = (input: unknown): MaterialLibrary =>
  MaterialLibrarySchema.parse(input);
