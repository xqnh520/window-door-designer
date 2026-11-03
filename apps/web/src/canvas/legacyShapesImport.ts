/**
 * 旧 ShapeModel JSON 的一次性导入解析；禁止在运行时渲染/计算链路调用。
 * 实现位于 `@wdd/core`（纯函数、可单测），此处保留历史导入路径。
 */
export {
  normalizeLegacyShapes,
  normalizeLegacyShapesWithReport,
  buildDesignModelFromLegacyShapes,
} from '@wdd/core';
export type { LegacyNormalizeReport } from '@wdd/core';
