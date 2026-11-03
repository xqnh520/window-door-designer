/**
 * 旧版 ShapeModel 的持久化/交换格式。
 *
 * 该类型只允许出现在旧方案导入、CRM 兼容输出与 3D 适配边界，不能作为运行时业务状态。
 * 类型与迁移实现已下沉到 `@wdd/core`（legacy-shapes），保持本路径继续可导入。
 */
export type {
  LegacyPoint,
  LegacyShapeType,
  LegacySashData,
  LegacyShape,
  LegacyImportContext,
} from '@wdd/core';
