import { create } from 'zustand';
import type { MaterialLibrary, SeriesCutRow, SeriesSpec, WindowDesign, WindowType } from '@wdd/schema';
import { sampleLibrary, sampleWindowTemplates } from '@wdd/schema';
import {
  createDesign,
  createDesignFromTemplate,
  createDesignModelFromTemplate,
  assemblyFromDesignModel,
  isTemplateCompatible,
  randomId,
  assemblyFromWindowTree,
  treeFromDesignModel,
  addLinearUnit,
  removeUnit,
  setUnitTree as coreSetUnitTree,
  resizeTreeEdge,
  moveMuntin,
  splitArea,
  setSash,
  removeSash,
  removeSplit,
  findMuntin,
  findArea,
  walkAreas,
  equalDivide,
  applyMuntinPattern,
  muntinWidthOf,
  muntinSagittaOf,
  setCombinerThickness as coreSetCombinerThickness,
  setCombinerAngle as coreSetCombinerAngle,
  setCombinerFittings as coreSetCombinerFittings,
  withDefaultAngles,
  layoutAssembly,
  layoutTree,
  createWindowTree,
  migrateLegacyFormulaConfig,
  DEFAULT_COMBINER_MM,
  DEFAULT_INSTALL_GAP_MM,
  type WindowAssembly,
  type WindowFitting,
  type WindowTree,
  type WindowSashSpec,
  type TreeEdge,
  type MuntinSlope,
} from '@wdd/core';
import type { LegacyShape } from './canvas/legacyShape';
import { buildDesignModelFromLegacyShapes, normalizeLegacyShapes } from './canvas/legacyShapesImport';

/** 系列出料行配置（v2）：按系列持久化的 localStorage 键 */
const SERIES_CONFIG_LS_KEY = 'wdd-library-series-config';
/** v1 旧公式键（role → {length,count}），迁移后删除 */
const LEGACY_FORMULA_LS_KEY = 'wdd-library-formulas';

export interface SeriesFormulaConfig {
  cuts: SeriesCutRow[];
  formulaBank: Record<string, string>;
  showSetting: Record<string, number>;
}

/** 画布写入动作：UI 只提交意图，store 负责克隆、调用 core mutator 并替换装配体。 */
export type CanvasAction =
  | { type: 'resize-dim'; markId: string; value: number }
  | { type: 'resize-edge'; nodeId: string; edge: TreeEdge; newPos: number }
  | { type: 'move-muntin'; muntinId: string; newRatio: number }
  | { type: 'split'; areaId: string; direction: 'vertical' | 'horizontal' | MuntinSlope; ratio: number }
  | { type: 'set-sash'; areaId: string; spec: WindowSashSpec }
  | { type: 'remove-sash'; areaId: string }
  | { type: 'remove-split'; areaId: string }
  | { type: 'translate'; offsetX: number; offsetY: number }
  | { type: 'patch-tree'; patch: Partial<WindowTree> }
  | { type: 'patch-area'; areaId: string; patch: Partial<import('@wdd/core').WindowTreeArea> }
  | { type: 'patch-sash'; areaId: string; patch: Partial<WindowSashSpec> }
  | { type: 'set-fittings'; host: 'tree' | 'area'; areaId?: string; fittings: WindowFitting[] }
  | { type: 'equal-divide'; areaId: string; direction: 'vertical' | 'horizontal' | MuntinSlope; count: number }
  | { type: 'muntin-pattern'; areaId: string; pattern: import('@wdd/core').MuntinPattern };

/** 读取系列公式配置；检测到 v1 旧结构时一次性迁移到出料行并换新键 */
function loadSeriesConfig(): Record<string, SeriesFormulaConfig> {
  try {
    const raw = localStorage.getItem(SERIES_CONFIG_LS_KEY);
    if (raw) return JSON.parse(raw) as Record<string, SeriesFormulaConfig>;
  } catch {
    /* 忽略解析失败 */
  }
  try {
    const legacyRaw = localStorage.getItem(LEGACY_FORMULA_LS_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as Record<string, Record<string, { length?: string; count?: string }>>;
      const next: Record<string, SeriesFormulaConfig> = {};
      for (const [seriesId, formulas] of Object.entries(legacy)) {
        const migrated = migrateLegacyFormulaConfig(formulas);
        next[seriesId] = { ...migrated, showSetting: {} };
      }
      localStorage.setItem(SERIES_CONFIG_LS_KEY, JSON.stringify(next));
      localStorage.removeItem(LEGACY_FORMULA_LS_KEY);
      return next;
    }
  } catch {
    /* 旧数据解析失败则丢弃 */
  }
  return {};
}

function persistSeriesConfig(seriesId: string, cfg: SeriesFormulaConfig): void {
  try {
    const saved = loadSeriesConfig();
    saved[seriesId] = cfg;
    localStorage.setItem(SERIES_CONFIG_LS_KEY, JSON.stringify(saved));
  } catch {
    /* 忽略本地存储失败 */
  }
}

/** 初始材质库：叠加本地保存的系列出料行配置（无配置时回退到示例默认） */
function loadInitialLibrary(): MaterialLibrary {
  const saved = loadSeriesConfig();
  if (!Object.keys(saved).length) return sampleLibrary;
  return {
    ...sampleLibrary,
    series: sampleLibrary.series.map((s) => {
      const cfg = saved[s.id];
      if (!cfg) return s;
      return {
        ...s,
        cuts: cfg.cuts?.length ? cfg.cuts : s.cuts,
        formulaBank: cfg.formulaBank ?? s.formulaBank ?? {},
        showSetting: cfg.showSetting ?? s.showSetting ?? {},
      };
    }),
  };
}

export interface OrderConfig {
  orderNo: string;
  unitPrice: number; // 元/㎡
  packaging: string;
  hinge: string;
  hardware: string;
  position: string;
  wallThickness: number; // mm
  outerColor: string;
  innerColor: string;
  /** 纱窗网孔近似尺寸（mm）：6 / 8 / 10 / 12 */
  screenMeshSize: number;
  /** 纱网网线颜色名（映射到 palette 色值；'深灰' 为内置） */
  screenMeshColor: string;
  /** 压线拼接方式：miter=四角 45° 斜连接，butt=直边搭接收口 */
  beadJoint: 'miter' | 'butt';
}

export const defaultOrderConfig: OrderConfig = {
  orderNo: 'WD-0001',
  unitPrice: 680,
  packaging: '木架',
  hinge: '不锈钢合页',
  hardware: '进口五金',
  position: '客厅',
  wallThickness: 200,
  outerColor: '咖啡色',
  innerColor: '咖啡色',
  screenMeshSize: 8,
  screenMeshColor: '深灰',
  beadJoint: 'miter',
};

const HISTORY_LIMIT = 50;

/** 装配布局安装间隙（mm）：与画布/树编辑器统一 */
const ASSEMBLY_INSTALL_GAP = DEFAULT_INSTALL_GAP_MM;

export interface DesignerStore {
  library: MaterialLibrary;
  designType: WindowType;
  design: WindowDesign;
  seriesId: string;
  openingW: number;
  openingH: number;
  windowCount: number;
  discountRate: number;
  activeTemplateId: string | null;
  orderConfig: OrderConfig;
  /** 外框拼接装配体（权威结构；单窗时 = 1 单元 0 拼樘）。null = 尚未进入树设计 */
  assembly: WindowAssembly | null;
  /** 当前聚焦（可编辑）单元 id */
  focusedUnitId: string | null;
  /** 当前选中的拼樘 id（属性面板可改厚度/删除） */
  selectedCombinerId: string | null;
  // ★ 新增：当前选中图形的尺寸度量信息（单个图形或组合图形的包围盒）
  selectedMetrics: { width: number; height: number; isGroup: boolean } | null;
  /** 画布（装配体）历史：撤销/重做快照，支持清空/拼接等结构性操作回退 */
  canvPast: (WindowAssembly | null)[];
  canvFuture: (WindowAssembly | null)[];
  /** 画布撤销/重做（对齐第三方「撤销/恢复」常驻工具条） */
  undoCanvas: () => void;
  redoCanvas: () => void;
  setSeries: (seriesId: string) => void;
  setWindowType: (type: WindowType) => void;
  setOpeningSize: (w: number, h: number) => void;
  setGlass: (glassId: string) => void;
  setWindowCount: (count: number) => void;
  setDiscountRate: (rate: number) => void;
  setOrderConfig: (patch: Partial<OrderConfig>) => void;
  applyTemplate: (templateId: string | null) => void;
  saveDesign: () => void;
  /** 设置容器树（R4）：非 null 进入树设计模式，null 关闭 */
  setWindowTree: (tree: WindowTree | null) => void;
  /** 整体替换装配体（导入/初始化用）；可选指定聚焦单元 */
  setAssembly: (a: WindowAssembly | null, focusId?: string | null) => void;
  /** 切换聚焦（可编辑）单元 */
  setFocusedUnit: (unitId: string) => void;
  /** 外框拼接：在聚焦单元之后按轴追加一个克隆单元 + 拼樘（angleDeg 180=直线/135/90=转角），聚焦新单元并选中新拼樘 */
  combineUnit: (opts: { axis: 'x' | 'y'; angleDeg?: number; withCombiner?: boolean }) => void;
  /** 自由拖拽外框拼接：以聚焦单元为锚，在 dir 方向用拼樘接入一个 W×H 的新空白框（angleDeg 180=直线/135/90=转角；withCombiner=false 时两框直接相邻无拼樘） */
  addDrawnFrame: (opts: { dir: 'up' | 'down' | 'left' | 'right'; w: number; h: number; withCombiner?: boolean; angleDeg?: number }) => void;
  /** 删除聚焦单元及其相邻拼樘（多框时） */
  removeFocusedUnit: () => void;
  /** 选中拼樘（null 取消） */
  selectCombiner: (id: string | null) => void;
  /** 修改拼樘厚度（mm） */
  updateCombinerThickness: (id: string, mm: number) => void;
  /** 修改拼接夹角（度：180/135/90；仅影响 2D/3D 呈现，不改下料） */
  updateCombinerAngle: (id: string, deg: number) => void;
  /** 设置拼樘配件（连接件/转角/拼框配件）；空数组清除 */
  setCombinerFittings: (id: string, fittings: WindowFitting[]) => void;
  /** 删除拼樘：连带移除其下游单元 */
  removeCombiner: (id: string) => void;
  /** 画布动作入口；组件不直接写 assembly。 */
  dispatchCanvas: (action: CanvasAction) => boolean;
  /** 旧 shapes 草稿的一次性加载迁移；成功后 shapes 不再作为运行时数据源。 */
  importLegacyShapes: (shapes: LegacyShape[]) => boolean;
  /** 从 localStorage 恢复最近一次本地草稿；成功返回 true */
  hydrateDraft: () => boolean;
  /** 导出方案（设计+画布+订单配置）为 JSON 字符串，用于分享/备份 */
  exportScheme: () => string;
  /** 从 JSON 字符串恢复方案（离线分享/协作导入）；成功返回 true */
  importSchemeText: (text: string) => boolean;
  /** 清除本地草稿（如已保存到客户后） */
  clearLocalDraft: () => void;
  setSelectedMetrics: (metrics: { width: number; height: number; isGroup: boolean } | null) => void;
  /** 更新指定系列的出料行配置（cuts/formulaBank/showSetting，v2），并持久化到本地 */
  updateSeriesFormulaConfig: (seriesId: string, cfg: SeriesFormulaConfig) => void;
}

function rebuild(
  type: WindowType,
  openingW: number,
  openingH: number,
  seriesId: string,
  library: MaterialLibrary,
  glassId: string,
): WindowDesign {
  const series = library.series.find((s) => s.id === seriesId) ?? library.series[0];
  return createDesign(type, { openingW, openingH, seriesId, name: `${type}-${openingW}x${openingH}` }, series);
}

export const useStore = create<DesignerStore>((set, get) => ({
  library: loadInitialLibrary(),
  designType: 'casement',
  seriesId: 'series-60',
  openingW: 1500,
  openingH: 1500,
  windowCount: 1,
  discountRate: 0,
  activeTemplateId: null,
  orderConfig: { ...defaultOrderConfig },
  assembly: null,
  focusedUnitId: null,
  selectedCombinerId: null,
  // ★ 新增：初始状态为 null（未选中任何图形）
  selectedMetrics: null,
  
  canvPast: [],
  canvFuture: [],
  design: rebuild('casement', 1500, 1500, 'series-60', sampleLibrary, 'g-5-12a-5'),
  // —— 以下操作都会把当前 design 快照写入历史，支持撤销/重做 ——
  setSeries: (seriesId) => {
    const { designType, openingW, openingH, library, design } = get();
    const next = rebuild(designType, openingW, openingH, seriesId, library, design.glassId);
    set({ seriesId, design: next });
    // 容器树/装配模式：同步系列与框宽到每个单元
    const a = get().assembly;
    if (a) {
      commitCanvasSnapshot(set, get);
      const series = library.series.find((s) => s.id === seriesId);
      const na = {
        ...mapUnits(a, (t) => ({ ...t, seriesId, frameWidthMm: series?.frameWidth ?? t.frameWidthMm })),
        seriesId,
      };
      set(deriveFocused(na, get().focusedUnitId ?? na.units[0].id));
    }
  },
  setWindowType: (type) => {
    const { openingW, openingH, library, design } = get();
    set({ designType: type, design: rebuild(type, openingW, openingH, get().seriesId, library, design.glassId) });
    const a = get().assembly;
    if (a) {
      commitCanvasSnapshot(set, get);
      const na = mapUnits(a, (t) => {
        const next = cloneTreePreserveIds(t);
        walkAreas(next, (area) => {
          if (!area.sash) return;
          area.sash = {
            ...area.sash,
            windowType: type,
            roleType: undefined,
            hingeSide: type === 'topHinged' ? 'top' : area.sash.hingeSide,
            openDirection: area.sash.openDirection ?? 'out',
          };
        });
        return next;
      });
      set(deriveFocused(na, get().focusedUnitId ?? na.units[0].id));
    }
  },
  setOpeningSize: (w, h) => {
    const { designType, library, design } = get();
    set({
      openingW: w,
      openingH: h,
      design: rebuild(designType, w, h, get().seriesId, library, design.glassId),
    });
    // 容器树/装配模式：同步洞口尺寸到每个单元
    const a = get().assembly;
    if (a) {
      commitCanvasSnapshot(set, get);
      const na = mapUnits(a, (t) => ({ ...t, openingW: w, openingH: h }));
      set(deriveFocused(na, get().focusedUnitId ?? na.units[0].id));
    }
  },
  setGlass: (glassId) => {
    const { design } = get();
    set({ design: { ...design, glassId } });
    const a = get().assembly;
    if (a) {
      commitCanvasSnapshot(set, get);
      const na = { ...mapUnits(a, (t) => ({ ...t, glassId })), glassId };
      set(deriveFocused(na, get().focusedUnitId ?? na.units[0].id));
    }
  },
  setWindowCount: (windowCount) => set({ windowCount }),
  setDiscountRate: (discountRate) => set({ discountRate }),
  setOrderConfig: (patch) => set((state) => ({ orderConfig: { ...state.orderConfig, ...patch } })),
  applyTemplate: (templateId) => {
    const state = get();
    if (!templateId) {
      set({ activeTemplateId: null });
      return;
    }
    const template = sampleWindowTemplates.find((t) => t.id === templateId);
    if (!template) return;
    const series = state.library.series.find((s) => s.id === state.seriesId) ?? state.library.series[0];
    // 工艺校验：模板与当前系列不兼容时拒绝应用（UI 侧会给出提示）
    if (!isTemplateCompatible(template, series)) return;
    try {
      const design = createDesignFromTemplate(template, {
        openingW: state.openingW,
        openingH: state.openingH,
        seriesId: state.seriesId,
        name: `${template.name}-${state.openingW}x${state.openingH}`,
      }, series);
      const model = createDesignModelFromTemplate(template, {
        openingW: state.openingW,
        openingH: state.openingH,
        series,
        seriesId: state.seriesId,
        glassId: design.glassId,
        name: design.name,
      });
      const assembly = assemblyFromDesignModel(model, {
        installGap: series.installGap,
        name: model.name,
        seriesId: model.seriesId,
        glassId: model.glassId,
        frameWidthMm: series.frameWidth ?? 60,
      });
      if (!assembly) return;
      commitCanvasSnapshot(set, get);
      set({
        ...deriveFocused(assembly, assembly.units[0].id),
        activeTemplateId: templateId,
        design,
        designType: design.panels[0]?.windowType ?? state.designType,
        selectedCombinerId: null,
      });
    } catch {
      // 模板数据异常时保持现场，不破坏当前画布
    }
  },
  undoCanvas: () => {
    const { canvPast, canvFuture, assembly } = get();
    if (!canvPast.length) return;
    const prev = canvPast[canvPast.length - 1];
    set({ canvPast: canvPast.slice(0, -1), canvFuture: [deepCloneAssembly(assembly), ...canvFuture] });
    if (!prev || !prev.units.length) {
      set({ assembly: null, focusedUnitId: null, selectedCombinerId: null, activeTemplateId: null });
      return;
    }
    const na = withDefaultAngles(prev);
    set({ ...deriveFocused(na, na.units[0].id), activeTemplateId: null, selectedCombinerId: null });
  },
  redoCanvas: () => {
    const { canvPast, canvFuture, assembly } = get();
    if (!canvFuture.length) return;
    const next = canvFuture[0];
    set({ canvPast: [...canvPast, deepCloneAssembly(assembly)], canvFuture: canvFuture.slice(1) });
    if (!next || !next.units.length) {
      set({ assembly: null, focusedUnitId: null, selectedCombinerId: null, activeTemplateId: null });
      return;
    }
    const na = withDefaultAngles(next);
    set({ ...deriveFocused(na, na.units[0].id), activeTemplateId: null, selectedCombinerId: null });
  },
  saveDesign: () => {
    persistDraft(get());
  },
  setWindowTree: (tree) => {
    commitCanvasSnapshot(set, get);
    if (!tree) {
      set({ assembly: null, focusedUnitId: null, selectedCombinerId: null, activeTemplateId: null });
      return;
    }
    // store 是业务数据边界：不要把 UI/controller 持有的可变树直接挂进 assembly。
    const a = assemblyFromWindowTree(cloneTreePreserveIds(tree));
    set({
      ...deriveFocused(a, a.units[0].id),
      seriesId: a.seriesId,
      openingW: tree.openingW,
      openingH: tree.openingH,
      activeTemplateId: null,
      selectedCombinerId: null,
    });
  },
  setAssembly: (a, focusId) => {
    commitCanvasSnapshot(set, get);
    if (!a || !a.units.length) {
      set({ assembly: null, focusedUnitId: null, selectedCombinerId: null });
      return;
    }
    // 导入/外部适配器传入的对象也必须在边界处断开引用。
    const owned = deepCloneAssembly(a)!;
    const opening = openingSizeOfAssembly(owned);
    set({
      ...deriveFocused(owned, focusId ?? owned.units[0].id),
      seriesId: owned.seriesId,
      openingW: opening.w,
      openingH: opening.h,
    });
  },
  setFocusedUnit: (unitId) => {
    const a = get().assembly;
    if (!a || !a.units.some((u) => u.id === unitId)) return;
    set({ ...deriveFocused(a, unitId), selectedCombinerId: null });
  },
  combineUnit: ({ axis, angleDeg, withCombiner }) => {
    commitCanvasSnapshot(set, get);
    const { assembly, focusedUnitId } = get();
    if (!assembly || !assembly.units.length) return;
    const anchor = focusedUnitId ?? assembly.units[0].id;
    const anchorTree = assembly.units.find((u) => u.id === anchor)?.tree ?? assembly.units[0].tree;
    const { assembly: na, newUnitId, newCombinerId } = addLinearUnit(assembly, {
      anchorUnitId: anchor,
      axis,
      tree: cloneTree(anchorTree),
      thicknessMm: DEFAULT_COMBINER_MM,
      angleDeg,
      withCombiner,
    });
    if (!newUnitId) return;
    set({ ...deriveFocused(na, newUnitId), selectedCombinerId: newCombinerId });
  },
  addDrawnFrame: ({ dir, w, h, withCombiner, angleDeg }) => {
    commitCanvasSnapshot(set, get);
    const { assembly, focusedUnitId } = get();
    if (!assembly || !assembly.units.length) return;
    const anchor = focusedUnitId ?? assembly.units[0].id;
    const anchorTree = assembly.units.find((u) => u.id === anchor)?.tree ?? assembly.units[0].tree;
    const tree = createWindowTree({
      openingW: Math.max(400, Math.round(w)),
      openingH: Math.max(400, Math.round(h)),
      seriesId: assembly.seriesId,
      glassId: assembly.glassId,
      frameWidthMm: anchorTree.frameWidthMm,
      name: '新窗',
    });
    const { assembly: na, newUnitId, newCombinerId } = addLinearUnit(assembly, {
      anchorUnitId: anchor,
      axis: dir === 'up' || dir === 'down' ? 'y' : 'x',
      before: dir === 'up' || dir === 'left',
      tree,
      thicknessMm: DEFAULT_COMBINER_MM,
      withCombiner,
      angleDeg,
    });
    if (!newUnitId) return;
    set({ ...deriveFocused(na, newUnitId), selectedCombinerId: newCombinerId });
  },
  removeFocusedUnit: () => {
    commitCanvasSnapshot(set, get);
    const { assembly, focusedUnitId } = get();
    if (!assembly || assembly.units.length <= 1 || !focusedUnitId) return;
    const na = removeUnit(assembly, focusedUnitId);
    set({ ...deriveFocused(na, na.units[0].id), selectedCombinerId: null });
  },
  selectCombiner: (id) => set({ selectedCombinerId: id }),
  updateCombinerThickness: (id, mm) => {
    const { assembly, focusedUnitId } = get();
    if (!assembly) return;
    commitCanvasSnapshot(set, get);
    const na = coreSetCombinerThickness(assembly, id, Math.max(10, Math.round(mm)));
    set(deriveFocused(na, focusedUnitId ?? na.units[0].id));
  },
  updateCombinerAngle: (id, deg) => {
    const { assembly, focusedUnitId } = get();
    if (!assembly) return;
    commitCanvasSnapshot(set, get);
    const na = coreSetCombinerAngle(assembly, id, Math.round(deg));
    set(deriveFocused(na, focusedUnitId ?? na.units[0].id));
  },
  setCombinerFittings: (id, fittings) => {
    const { assembly, focusedUnitId } = get();
    if (!assembly) return;
    commitCanvasSnapshot(set, get);
    const na = coreSetCombinerFittings(assembly, id, fittings);
    set(deriveFocused(na, focusedUnitId ?? na.units[0].id));
  },
  removeCombiner: (id) => {
    commitCanvasSnapshot(set, get);
    const { assembly, focusedUnitId } = get();
    if (!assembly) return;
    const c = assembly.combiners.find((x) => x.id === id);
    if (!c) return;
    const na = removeUnit(assembly, c.between[1]);
    const focus = focusedUnitId && na.units.some((u) => u.id === focusedUnitId) ? focusedUnitId : na.units[0].id;
    set({ ...deriveFocused(na, focus), selectedCombinerId: null });
  },
  dispatchCanvas: (action) => {
    const { assembly, focusedUnitId } = get();
    const current = focusedTreeFromAssembly(assembly, focusedUnitId);
    if (!current) return false;
    const next = cloneTreePreserveIds(current);
    if (!applyCanvasAction(next, action)) return false;
    if (!assembly || !focusedUnitId) return false;
    commitCanvasSnapshot(set, get);
    const updated = coreSetUnitTree(assembly, focusedUnitId, next);
    set(deriveFocused(updated, focusedUnitId));
    return true;
  },
  importLegacyShapes: (shapes) => {
    const state = get();
    if (state.assembly) return false;
    if (!shapes.length) {
      set({
        assembly: null,
        focusedUnitId: null,
        activeTemplateId: null,
        selectedCombinerId: null,
        canvPast: [],
        canvFuture: [],
      });
      return true;
    }
    const model = buildDesignModelFromLegacyShapes(shapes, state);
    if (!model) return false;
    const series = state.library.series.find((s) => s.id === model.seriesId) ?? state.library.series[0];
    const tree = treeFromDesignModel(model, {
      installGap: ASSEMBLY_INSTALL_GAP,
      name: model.name,
      seriesId: model.seriesId,
      glassId: model.glassId,
      frameWidthMm: series.frameWidth ?? 60,
    });
    if (!tree) return false;
    try {
      localStorage.setItem('wdd-studio-backup', JSON.stringify({ savedAt: new Date().toISOString(), shapes }));
    } catch {
      /* 备份失败不阻断迁移 */
    }
    const a = assemblyFromWindowTree(cloneTreePreserveIds(tree));
    set({
      ...deriveFocused(a, a.units[0].id),
      activeTemplateId: null,
      selectedCombinerId: null,
      canvPast: [],
      canvFuture: [],
    });
    return true;
  },
  /** 恢复本地草稿（普通设计模式；CRM 方案模式不自动恢复） */
  hydrateDraft: () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      const restoredAssembly = reviveAssembly(data);
      const restored = restoredAssembly.assembly;
      const empty = data.emptyCanvas;
      const legacyDesign = data.design as WindowDesign | undefined;
      if (!restored && !empty && !legacyDesign) return false;
      const opening = restored ? openingSizeOfAssembly(restored) : null;
      const emptyDesign = empty
        ? rebuild(empty.designType ?? 'casement', empty.openingW ?? 1500, empty.openingH ?? 1500, empty.seriesId ?? 'series-60', get().library, empty.glassId ?? 'g-5-12a-5')
        : undefined;
      set({
        ...(legacyDesign || emptyDesign ? { design: legacyDesign ?? emptyDesign! } : {}),
        openingW: opening?.w ?? empty?.openingW ?? data.openingW ?? legacyDesign?.openingW ?? 1500,
        openingH: opening?.h ?? empty?.openingH ?? data.openingH ?? legacyDesign?.openingH ?? 1500,
        seriesId: restored?.seriesId ?? empty?.seriesId ?? data.seriesId ?? legacyDesign?.seriesId ?? 'series-60',
        designType: empty?.designType ?? data.designType ?? legacyDesign?.panels?.[0]?.windowType ?? 'casement',
        windowCount: data.windowCount ?? 1,
        discountRate: data.discountRate ?? 0,
        orderConfig: data.orderConfig ?? get().orderConfig,
        ...restoredAssembly,
        activeTemplateId: null,
        canvPast: [],
        canvFuture: [],
      });
      if (!get().assembly) get().importLegacyShapes(normalizeLegacyShapes(data.shapes));
      return true;
    } catch (err) {
      console.warn('本地草稿恢复失败:', err);
      return false;
    }
  },
  /**
   * 导出方案 JSON：设计模型 + 画布 + 容器树 + 装配体 + 订单配置 + 保存时间（分享/备份/导入用）。
   * 装配体为裸 JSON，version:3 起自动携带 combiners[].angleDeg（旧文件缺字段由 reviveAssembly 补 180）。
   */
  exportScheme: () => {
    return JSON.stringify(buildSchemePayload(get()), null, 2);
  },
  importSchemeText: (text) => {
    try {
      const data = JSON.parse(text);
      const restoredAssembly = reviveAssembly(data);
      const restored = restoredAssembly.assembly;
      const empty = data.emptyCanvas;
      const legacyDesign = data.design as WindowDesign | undefined;
      if (!data.orderConfig || (!restored && !empty && !legacyDesign)) return false;
      const opening = restored ? openingSizeOfAssembly(restored) : null;
      const emptyDesign = empty
        ? rebuild(empty.designType ?? get().designType, empty.openingW ?? get().openingW, empty.openingH ?? get().openingH, empty.seriesId ?? get().seriesId, get().library, empty.glassId ?? get().design.glassId)
        : undefined;
      set({
        ...(legacyDesign || emptyDesign ? { design: legacyDesign ?? emptyDesign! } : {}),
        orderConfig: data.orderConfig,
        seriesId: restored?.seriesId ?? empty?.seriesId ?? data.seriesId ?? legacyDesign?.seriesId ?? get().seriesId,
        openingW: opening?.w ?? empty?.openingW ?? data.openingW ?? legacyDesign?.openingW ?? get().openingW,
        openingH: opening?.h ?? empty?.openingH ?? data.openingH ?? legacyDesign?.openingH ?? get().openingH,
        designType: empty?.designType ?? data.designType ?? legacyDesign?.panels?.[0]?.windowType ?? get().designType,
        windowCount: data.windowCount ?? 1,
        discountRate: data.discountRate ?? 0,
        ...restoredAssembly,
        activeTemplateId: null,
        canvPast: [],
        canvFuture: [],
      });
      if (!get().assembly) get().importLegacyShapes(normalizeLegacyShapes(data.shapes));
      persistDraft(get());
      return true;
    } catch {
      return false;
    }
  },
  clearLocalDraft: () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  },
  // ★ 新增：更新选中图形度量信息的方法
  setSelectedMetrics: (metrics) => set({ selectedMetrics: metrics }),

  // 出料行配置：写入系列 cuts/formulaBank/showSetting 并持久化；BOM/报价/下料单经 library 订阅实时联动
  updateSeriesFormulaConfig: (seriesId, cfg) => {
    const library = get().library;
    const existing = library.series.find((s) => s.id === seriesId);
    if (!existing) return;
    set({
      library: {
        ...library,
        series: library.series.map((s) =>
          s.id === seriesId
            ? { ...s, cuts: cfg.cuts, formulaBank: cfg.formulaBank, showSetting: cfg.showSetting }
            : s,
        ),
      },
    });
    persistSeriesConfig(seriesId, cfg);
  },
}));

/**
 * 更新权威装配体与聚焦单元。聚焦树只在读取时派生，不再保存第二份状态。
 */
function deriveFocused(a: WindowAssembly, focusId: string): Partial<DesignerStore> {
  return { assembly: a, focusedUnitId: focusId };
}

/** 聚焦单元的只读布局投影；业务真值始终是 assembly。 */
export function focusedTreeFromAssembly(a: WindowAssembly | null, focusId: string | null): WindowTree | null {
  if (!a || !a.units.length) return null;
  const id = focusId && a.units.some((u) => u.id === focusId) ? focusId : a.units[0].id;
  return layoutAssembly(a, { installGap: ASSEMBLY_INSTALL_GAP }).trees.get(id)
    ?? a.units.find((u) => u.id === id)?.tree
    ?? null;
}

function openingSizeOfAssembly(a: WindowAssembly): { w: number; h: number } {
  const bbox = layoutAssembly(a, { installGap: ASSEMBLY_INSTALL_GAP }).bbox;
  return {
    w: Math.max(1, Math.round(bbox.w + 2 * ASSEMBLY_INSTALL_GAP)),
    h: Math.max(1, Math.round(bbox.h + 2 * ASSEMBLY_INSTALL_GAP)),
  };
}

/** 当前业务上下文 selector：有装配体时只读 assembly，兼容字段仅服务空画布/旧方案。 */
export function selectCurrentSeriesId(state: DesignerStore): string {
  return state.assembly?.seriesId ?? state.seriesId;
}

export function selectCurrentGlassId(state: DesignerStore): string {
  return state.assembly?.glassId ?? state.design.glassId;
}

export function selectCurrentDesignName(state: DesignerStore): string {
  return state.assembly?.name ?? state.design.name;
}

export function selectCurrentOpeningW(state: DesignerStore): number {
  return state.assembly ? openingSizeOfAssembly(state.assembly).w : state.openingW;
}

export function selectCurrentOpeningH(state: DesignerStore): number {
  return state.assembly ? openingSizeOfAssembly(state.assembly).h : state.openingH;
}

/** 持有该分格的分割：中梃方向/料厚 + 本格是否为第一格。用于判断某条边落在中梃上还是外框上。 */
function splitOfArea(tree: WindowTree, areaId: string): { direction: string; thicknessMm?: number; isFirst: boolean } | null {
  let found: { direction: string; thicknessMm?: number; isFirst: boolean } | null = null;
  walkAreas(tree, (area) => {
    if (found || !area.children) return;
    const idx = area.children.findIndex((child) => child.id === areaId);
    if (idx === 0 || idx === 2) {
      const muntin = area.children[1];
      found = { direction: muntin.direction, thicknessMm: muntin.thicknessMm, isFirst: idx === 0 };
    }
  });
  return found;
}

/** 在 store 边界执行画布意图；core mutator 只接收本地副本，避免 UI 直接写业务状态。 */
function applyCanvasAction(tree: WindowTree, action: CanvasAction): boolean {
  switch (action.type) {
    case 'resize-dim': {
      const value = Math.max(60, Math.round(action.value));
      if (action.markId === 'frame-w') {
        tree.openingW = Math.round(value + 2 * ASSEMBLY_INSTALL_GAP);
        return true;
      }
      if (action.markId === 'frame-h') {
        tree.openingH = Math.round(value + 2 * ASSEMBLY_INSTALL_GAP);
        return true;
      }
      const areaId = action.markId.endsWith('-w') || action.markId.endsWith('-h') ? action.markId.slice(0, -2) : null;
      if (!areaId) return false;
      const layout = layoutTree(tree, { installGap: ASSEMBLY_INSTALL_GAP });
      const box = layout.boxes.get(areaId);
      if (!box) return false;
      const horizontal = action.markId.endsWith('-w');
      // 键入的是「这一格要多大」：优先动落在中梃上的那条边，把余量推给相邻分格，整窗轮廓不变；
      // 该方向没有相邻格时，才落到外框那条边（等于改洞口，且不移动整窗）。
      const split = splitOfArea(tree, areaId);
      const muntinEdge: TreeEdge | null = split
        ? horizontal && split.direction === 'vertical'
          ? split.isFirst ? 'right' : 'left'
          : !horizontal && split.direction === 'horizontal'
            ? split.isFirst ? 'bottom' : 'top'
            : null
        : null;
      const growEdge: TreeEdge = horizontal ? 'right' : 'bottom';
      const otherEdge: TreeEdge = horizontal ? 'left' : 'top';
      const edgePos = (edge: TreeEdge, onMuntin: boolean): number => {
        // 格边量到中梃中线，已扣掉半料厚；newPos 要的是中线坐标 → 补回 th/2
        const inset = onMuntin ? (split?.thicknessMm ?? muntinWidthOf(tree)) / 2 : 0;
        return edge === 'right'
          ? box.x + value + inset
          : edge === 'left'
            ? box.x + box.w - value - inset
            : edge === 'bottom'
              ? box.y + value + inset
              : box.y + box.h - value - inset;
      };
      const edgeOpts = { installGap: ASSEMBLY_INSTALL_GAP };
      // 有相邻格可吸收 → 只动中梃，绝不回退去改外框
      if (muntinEdge) return resizeTreeEdge(tree, areaId, muntinEdge, edgePos(muntinEdge, true), edgeOpts);
      return (
        resizeTreeEdge(tree, areaId, growEdge, edgePos(growEdge, false), edgeOpts) ||
        resizeTreeEdge(tree, areaId, otherEdge, edgePos(otherEdge, false), edgeOpts)
      );
    }
    case 'resize-edge':
      return resizeTreeEdge(tree, action.nodeId, action.edge, action.newPos, { installGap: ASSEMBLY_INSTALL_GAP });
    case 'move-muntin': {
      const found = findMuntin(tree, action.muntinId);
      const box = found ? layoutTree(tree, { installGap: ASSEMBLY_INSTALL_GAP }).boxes.get(found.area.id) : undefined;
      return moveMuntin(tree, action.muntinId, action.newRatio, box && { w: box.w, h: box.h });
    }
    case 'split': {
      const layout = layoutTree(tree, { installGap: ASSEMBLY_INSTALL_GAP });
      const box = layout.boxes.get(action.areaId);
      return splitArea(tree, action.areaId, action.direction, action.ratio, muntinWidthOf(tree), muntinSagittaOf(tree), box && { w: box.w, h: box.h });
    }
    case 'set-sash':
      return setSash(tree, action.areaId, action.spec);
    case 'remove-sash':
      return removeSash(tree, action.areaId);
    case 'remove-split':
      return removeSplit(tree, action.areaId);
    case 'translate':
      if ((tree.offsetX ?? 0) === action.offsetX && (tree.offsetY ?? 0) === action.offsetY) return false;
      tree.offsetX = action.offsetX;
      tree.offsetY = action.offsetY;
      return true;
    case 'patch-tree':
      Object.assign(tree, action.patch);
      return true;
    case 'patch-area': {
      const area = findArea(tree, action.areaId);
      if (!area) return false;
      Object.assign(area, action.patch);
      return true;
    }
    case 'patch-sash': {
      const area = findArea(tree, action.areaId);
      if (!area?.sash) return false;
      area.sash = { ...area.sash, ...action.patch };
      return true;
    }
    case 'set-fittings': {
      if (action.host === 'tree') {
        tree.fittings = action.fittings.map((f) => ({ ...f }));
        return true;
      }
      const area = action.areaId ? findArea(tree, action.areaId) : undefined;
      if (!area) return false;
      area.fittings = action.fittings.map((f) => ({ ...f }));
      return true;
    }
    case 'equal-divide':
      return equalDivide(tree, action.areaId, action.direction, action.count, ASSEMBLY_INSTALL_GAP);
    case 'muntin-pattern':
      return applyMuntinPattern(tree, action.areaId, action.pattern, { installGap: ASSEMBLY_INSTALL_GAP });
  }
}

/** 对每个单元的树做同构变换（保留装配结构与 offset） */
function mapUnits(a: WindowAssembly, fn: (t: WindowTree) => WindowTree): WindowAssembly {
  return { ...a, units: a.units.map((u) => ({ ...u, tree: fn(u.tree) })) };
}

/** 深克隆单元树用于拼接：新 id、清 offset（布局重排会重新烘焙） */
function cloneTree(t: WindowTree): WindowTree {
  const c = cloneTreePreserveIds(t);
  c.id = randomId();
  c.offsetX = 0;
  c.offsetY = 0;
  return c;
}

/** 深克隆树但保留业务 id；仅用于 store/UI 边界，不用于创建新单元。 */
function cloneTreePreserveIds(t: WindowTree): WindowTree {
  return JSON.parse(JSON.stringify(t)) as WindowTree;
}

/** 记录变更前的装配体快照到画布历史栈（与栈顶相同则不重复入栈，避免拖拽/中间态刷屏）。需在画布结构变更前调用。 */
function commitCanvasSnapshot(set: (partial: Partial<DesignerStore>) => void, get: () => DesignerStore): void {
  const { assembly, canvPast } = get();
  const last = canvPast[canvPast.length - 1];
  if (last !== undefined && JSON.stringify(last) === JSON.stringify(assembly)) return;
  const newPast = [...canvPast, deepCloneAssembly(assembly)];
  if (newPast.length > HISTORY_LIMIT) newPast.shift();
  set({ canvPast: newPast, canvFuture: [] });
}

/**
 * 复制画布历史快照，保留所有业务 id。
 * 与 cloneTree() 不同：cloneTree() 用于拼接新单元，会重置 id；
 * 该函数只用于隔离可变引用和撤销/重做历史。
 */
function deepCloneAssembly(a: WindowAssembly | null): WindowAssembly | null {
  return a ? (JSON.parse(JSON.stringify(a)) as WindowAssembly) : null;
}

/** 本地草稿键：手动保存与自动保存共用 */
export const DRAFT_KEY = 'wdd-studio';

function persistDraft(state: DesignerStore): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(buildSchemePayload(state)));
  } catch (err) {
    console.error('保存失败:', err);
  }
}

/**
 * v5 持久化边界：非空画布只保存 WindowAssembly；旧 WindowDesign 不再与权威模型并存落盘。
 * 空画布没有 assembly，才保存下一次绘框所需的默认上下文。
 */
function buildSchemePayload(state: DesignerStore): object {
  const { assembly, focusedUnitId, windowCount, discountRate, orderConfig } = state;
  return {
    version: 5,
    savedAt: new Date().toISOString(),
    assembly,
    focusedUnitId,
    windowCount,
    discountRate,
    orderConfig,
    emptyCanvas: assembly
      ? undefined
      : {
          openingW: state.openingW,
          openingH: state.openingH,
          seriesId: state.seriesId,
          glassId: state.design.glassId,
          designType: state.designType,
          name: state.design.name,
        },
  };
}

/** 从草稿/方案 JSON 恢复装配体：优先 assembly，回退 windowTree → 单单元装配 */
function reviveAssembly(data: { assembly?: WindowAssembly | null; windowTree?: WindowTree | null; focusedUnitId?: string | null }): Partial<DesignerStore> {
  const a = data.assembly ?? (data.windowTree ? assemblyFromWindowTree(data.windowTree) : null);
  if (!a || !a.units.length) return { assembly: null, focusedUnitId: null, selectedCombinerId: null };
  // 旧数据无 combiners[].angleDeg → 统一补 180（直线拼樘），避免下游读到 undefined
  const na = withDefaultAngles(a);
  return deriveFocused(na, data.focusedUnitId && na.units.some((u) => u.id === data.focusedUnitId) ? data.focusedUnitId : na.units[0].id);
}

export function selectSeries(state: DesignerStore): SeriesSpec {
  const id = state.assembly?.seriesId ?? state.seriesId;
  return state.library.series.find((s) => s.id === id) ?? state.library.series[0];
}
