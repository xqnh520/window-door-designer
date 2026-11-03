/**
 * 3D / CRM 兼容投影边界（实现已移到 @wdd/core，便于 Node 单测）。
 * - assemblyToShapes 默认应用转角显示变换（3D 预览用）；
 * - CRM 兼容输出显式传 { space: 'processing' } 保持展开态。
 */
export {
  assemblySize,
  assemblyToShapes,
  isIdentityPlacement,
  transformShapeForDisplay,
  treeToShapes,
} from '@wdd/core';
export type { AssemblyShapeOptions } from '@wdd/core';
