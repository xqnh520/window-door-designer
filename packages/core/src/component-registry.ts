/**
 * 构件类型注册表（对齐 windoorcraft 构件/配件体系）：
 * 每个新构件类型登记 id/label/kind/group/roles，BOM、画布 UI、校验统一从这里读取，
 * 避免 SashType 枚举无限膨胀。windowType 仍是旧 5 类型的兼容入口；
 * roleType 为空时回退 windowType 判定（双轨，旧数据无损）。
 *
 * 本文件纯数据、无 Konva 依赖（node 测试可用）。渲染分发在 window-tree-render.ts 按 roleType switch。
 */

export type ComponentGroup = 'safety' | 'decor' | 'glazing' | 'combo' | 'fold' | 'sliding';

export interface ComponentTypeDef {
  /** 构件类型 id（存于 WindowSashSpec.roleType） */
  id: string;
  /** 中文名（画布放置面板 / 图纸标签） */
  label: string;
  /** DesignComponent.kind（schema ComponentKind 枚举值） */
  kind: string;
  /** 放置面板分组 */
  group: ComponentGroup;
  /** BOM 型材角色（映射 series.profileRoles；空=同旧 windowType 判定） */
  roles?: string[];
  /** 是否需要玻璃（按面板出玻璃行） */
  needsGlass?: boolean;
}

const REGISTRY = new Map<string, ComponentTypeDef>();

export function registerComponentType(def: ComponentTypeDef): void {
  REGISTRY.set(def.id, def);
}

export function resolveComponentType(id?: string): ComponentTypeDef | null {
  if (!id) return null;
  return REGISTRY.get(id) ?? null;
}

export function listComponentTypes(group?: ComponentGroup): ComponentTypeDef[] {
  const all = [...REGISTRY.values()];
  return group ? all.filter((d) => d.group === group) : all;
}

// ── 内置构件类型注册 ──────────────────────────────────────────

export function registerBuiltinComponentTypes(): void {
  if (REGISTRY.size > 0) return;
  const defs: ComponentTypeDef[] = [
    // 安全
    { id: 'securityFrame', label: '防盗框', kind: 'securityFrame', group: 'safety', roles: ['frame'] },
    { id: 'securityBar', label: '防盗杆', kind: 'securityBar', group: 'safety', roles: ['mullion'] },
    { id: 'waterGuard', label: '防水挡板', kind: 'waterGuard', group: 'safety', roles: ['frame'] },
    // 装饰 / 玻璃
    { id: 'decorBar', label: '装饰条', kind: 'decorBar', group: 'decor', roles: ['bead'] },
    { id: 'frostedGlass', label: '磨砂玻璃', kind: 'frostedGlass', group: 'glazing', roles: [], needsGlass: true },
    // 扇组合
    { id: 'subSash', label: '子母扇', kind: 'subSash', group: 'combo', roles: ['sash'], needsGlass: true },
    { id: 'sashInSash', label: '扇中扇', kind: 'sashInSash', group: 'combo', roles: ['sash'], needsGlass: true },
    { id: 'pushIn', label: '内平推', kind: 'pushInSash', group: 'combo', roles: ['sash'], needsGlass: true },
    // 折叠体系
    { id: 'foldSash', label: '折叠玻扇', kind: 'foldSash', group: 'fold', roles: ['sash'], needsGlass: true },
    { id: 'foldScreen', label: '折叠纱扇', kind: 'foldScreen', group: 'fold', roles: ['sash'] },
    { id: 'fakeMullion', label: '假中梃', kind: 'fakeMullion', group: 'fold', roles: ['mullion'] },
    // 推拉家族
    { id: 'sashBead', label: '玻扇压线', kind: 'sashBead', group: 'sliding', roles: ['bead'], needsGlass: true },
    { id: 'screenBead', label: '纱扇压线', kind: 'screenBead', group: 'sliding', roles: ['bead'] },
    { id: 'sashMullion', label: '玻扇中梃', kind: 'sashMullion', group: 'sliding', roles: ['mullion'], needsGlass: true },
    { id: 'screenMullion', label: '纱扇中梃', kind: 'screenMullion', group: 'sliding', roles: ['mullion'] },
    { id: 'panelBead', label: '板材压线', kind: 'panelBead', group: 'sliding', roles: ['bead'] },
  ];
  defs.forEach(registerComponentType);
}

registerBuiltinComponentTypes();