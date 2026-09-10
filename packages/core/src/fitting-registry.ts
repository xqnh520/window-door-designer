/**
 * 配件体系注册表（对齐 windoorcraft 的 16 类配件，另加把手/玻璃格条两类自动派生配件，共 18 类）：
 * 外框/玻扇/纱扇/中梃/玻璃/对开扇/推拉扇/折叠扇/板材/对碰位/连接件/转角/拼框/洞口/防盗框/锁 配件。
 * 每类登记宿主层级（tree=整窗 / area=叶子分格 / combiner=拼樘）与出料方式（profile/hardware/accessory）。
 * 纯数据 + 出料纯函数，无 Konva 依赖；BOM/报价/画布统一读取。
 */

export type FittingType =
  | 'frameAddon'
  | 'sashAddon'
  | 'screenAddon'
  | 'mullionAddon'
  | 'glassAddon'
  | 'doubleSashAddon'
  | 'slideAddon'
  | 'foldAddon'
  | 'panelAddon'
  | 'slideCollisionAddon'
  | 'connectorAddon'
  | 'cornerJoinerAddon'
  | 'frameConnectAddon'
  | 'holeAddon'
  | 'theftAddon'
  | 'slideLockAddon'
  | 'handleHardware'
  | 'glassGridAddon';

export type FittingHost = 'tree' | 'area' | 'combiner';

export type FittingCategory = 'profile' | 'hardware' | 'accessory';

/** BOM 单位联合（与 BomItem.unit 一致） */
export type FitUnit = '支' | '块' | '米' | '个' | '只' | '套' | '把' | '卷' | '包' | '盒';

export interface FittingTypeDef {
  id: FittingType;
  label: string;
  /** 几何宿主层级：tree=整窗外框 / area=叶子分格 / combiner=拼樘料 */
  host: FittingHost;
  /** 出料类别：profile=按型材角色出料 / hardware=五金 / accessory=辅料 */
  category: FittingCategory;
  /** profile 类配件的型材角色 */
  role?: 'frame' | 'sash' | 'mullion' | 'bead';
  /** 出料行名称 */
  name: string;
  unit: FitUnit;
  /** 每处默认数量 */
  count: number;
}

const FITTING_REGISTRY = new Map<FittingType, FittingTypeDef>();

export function registerFittingType(def: FittingTypeDef): void {
  FITTING_REGISTRY.set(def.id, def);
}

export function resolveFittingType(id: FittingType): FittingTypeDef {
  const def = FITTING_REGISTRY.get(id);
  if (!def) throw new Error(`未注册配件类型: ${id}`);
  return def;
}

export function listFittingTypes(host?: FittingHost): FittingTypeDef[] {
  const all = [...FITTING_REGISTRY.values()];
  return host ? all.filter((d) => d.host === host) : all;
}

function registerBuiltinFittingTypes(): void {
  if (FITTING_REGISTRY.size > 0) return;
  const defs: FittingTypeDef[] = [
    { id: 'frameAddon', label: '外框配件', host: 'tree', category: 'profile', role: 'frame', name: '外框连接件', unit: '套', count: 1 },
    { id: 'sashAddon', label: '玻扇配件', host: 'area', category: 'profile', role: 'sash', name: '玻扇三角件', unit: '套', count: 1 },
    { id: 'screenAddon', label: '纱扇配件', host: 'area', category: 'profile', role: 'sash', name: '纱扇角件', unit: '套', count: 1 },
    { id: 'handleHardware', label: '把手（执手）', host: 'area', category: 'hardware', name: '把手', unit: '把', count: 1 },
    { id: 'glassGridAddon', label: '玻璃格条', host: 'area', category: 'profile', role: 'bead', name: '玻璃格条', unit: '支', count: 1 },
    { id: 'mullionAddon', label: '中梃配件', host: 'tree', category: 'profile', role: 'mullion', name: '中梃连接件', unit: '套', count: 1 },
    { id: 'glassAddon', label: '玻璃配件', host: 'area', category: 'accessory', name: '玻璃垫块', unit: '包', count: 1 },
    { id: 'doubleSashAddon', label: '对开扇配件', host: 'area', category: 'hardware', name: '对开扇中挺锁', unit: '套', count: 1 },
    { id: 'slideAddon', label: '推拉扇配件', host: 'area', category: 'hardware', name: '推拉滑轮组', unit: '套', count: 2 },
    { id: 'foldAddon', label: '折叠扇配件', host: 'area', category: 'hardware', name: '折叠铰链', unit: '套', count: 2 },
    { id: 'panelAddon', label: '板材配件', host: 'area', category: 'accessory', name: '板材加强件', unit: '套', count: 1 },
    { id: 'slideCollisionAddon', label: '对碰位配件', host: 'area', category: 'accessory', name: '对碰密封件', unit: '套', count: 1 },
    { id: 'connectorAddon', label: '连接件配件', host: 'combiner', category: 'profile', role: 'mullion', name: '拼樘连接件', unit: '套', count: 1 },
    { id: 'cornerJoinerAddon', label: '转角配件', host: 'combiner', category: 'profile', role: 'mullion', name: '转角连接件', unit: '套', count: 1 },
    { id: 'frameConnectAddon', label: '拼框配件', host: 'combiner', category: 'profile', role: 'mullion', name: '拼框加固件', unit: '套', count: 1 },
    { id: 'holeAddon', label: '洞口配件', host: 'tree', category: 'accessory', name: '洞口防水垫', unit: '套', count: 1 },
    { id: 'theftAddon', label: '防盗框配件', host: 'tree', category: 'accessory', name: '防盗框锁点', unit: '套', count: 2 },
    { id: 'slideLockAddon', label: '锁配件', host: 'tree', category: 'hardware', name: '平开锁', unit: '套', count: 1 },
  ];
  defs.forEach(registerFittingType);
}

registerBuiltinFittingTypes();

/** 配件出料上下文：宿主几何用于 profile 长度估算 */
export interface FittingBomCtx {
  /** 宿主边长参考（mm）：tree=外框周长 / area=面板周长 / combiner=拼樘长度 */
  hostLen: number;
  /** 宿主 id（sourceComponentId） */
  hostId?: string;
}

/** 把一条配件计算为 BOM 行（近似：profile 按 hostLen 出料、五金/辅料按 count 出件） */
export function computeFittingBomRow(
  def: FittingTypeDef,
  count: number,
  ctx: FittingBomCtx,
  hostLabel: string,
): { category: 'profile' | 'hardware' | 'accessory'; name: string; spec: string; unit: string; quantity: number; key: string } {
  const qty = Math.max(1, Math.round(count));
  if (def.category === 'profile') {
    const len = Math.max(1, Math.round(ctx.hostLen));
    return {
      category: 'profile',
      name: `${def.name}(${def.role ?? 'frame'})`,
      spec: `${hostLabel} ${len}mm/套`,
      unit: def.unit,
      quantity: qty,
      key: `fit-${def.id}-${ctx.hostId ?? ''}-${len}`,
    };
  }
  return {
    category: def.category,
    name: def.name,
    spec: `${hostLabel} ×${qty}`,
    unit: def.unit,
    quantity: qty,
    key: `fit-${def.id}-${ctx.hostId ?? ''}`,
  };
}