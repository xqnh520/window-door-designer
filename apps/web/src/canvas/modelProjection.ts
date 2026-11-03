import { DEFAULT_INSTALL_GAP_MM, toDesignModelAssembly, type WindowAssembly } from '@wdd/core';
import type { DesignModel } from '@wdd/schema';
import type { DesignerStore } from '../store';

/**
 * 运行时模型投影：业务计算只从唯一数据源 assembly 读取。
 * legacy shapes 必须先在加载边界迁移，计算链路不再读取兼容格式。
 */
export function projectDesignModel(state: DesignerStore): DesignModel | null {
  return projectAssembly(state.assembly);
}

/** 纯投影入口，供 React 组件按 assembly 引用变化进行 memo。 */
export function projectAssembly(assembly: WindowAssembly | null): DesignModel | null {
  if (!assembly) return null;
  return toDesignModelAssembly(assembly, {
    installGap: DEFAULT_INSTALL_GAP_MM,
    name: assembly.name,
    seriesId: assembly.seriesId,
    glassId: assembly.glassId,
  });
}
