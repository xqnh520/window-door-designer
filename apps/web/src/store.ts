import { create } from 'zustand';
import type { ComponentKind, MaterialLibrary, SeriesCutRow, SeriesSpec, WindowDesign, WindowPanel, WindowType } from '@wdd/schema';
import { sampleLibrary, sampleWindowTemplates } from '@wdd/schema';
import {
  createDesign,
  createDesignFromTemplate,
  createDesignModelFromTemplate,
  isTemplateCompatible,
  randomId,
  assemblyFromWindowTree,
  addLinearUnit,
  removeUnit,
  setUnitTree as coreSetUnitTree,
  setCombinerThickness as coreSetCombinerThickness,
  setCombinerAngle as coreSetCombinerAngle,
  setCombinerFittings as coreSetCombinerFittings,
  withDefaultAngles,
  layoutAssembly,
  createWindowTree,
  migrateLegacyFormulaConfig,
  DEFAULT_COMBINER_MM,
  type WindowAssembly,
  type WindowFitting,
  type WindowTree,
} from '@wdd/core';
import type { SashData } from './canvas/model';
import { buildShapesFromDesignModel } from './canvas/designModelAdapter';

/** 系列出料行配置（v2）：按系列持久化的 localStorage 键 */
const SERIES_CONFIG_LS_KEY = 'wdd-library-series-config';
/** v1 旧公式键（role → {length,count}），迁移后删除 */
const LEGACY_FORMULA_LS_KEY = 'wdd-library-formulas';

export interface SeriesFormulaConfig {
  cuts: SeriesCutRow[];
  formulaBank: Record<string, string>;
  showSetting: Record<string, number>;
}

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
};

const HISTORY_LIMIT = 50;

/** 装配布局安装间隙（mm）：与画布/树编辑器统一 */
const ASSEMBLY_INSTALL_GAP = 20;

/** 画布草图图形（mm 世界坐标） */
export interface Pt {
  x: number;
  y: number;
}

export type SketchType = 'rect' | 'trapezoid' | 'gothic' | 'arch' | 'line' | 'text';

export interface SketchShape {
  id: string;
  type: SketchType;
  /** rect / trapezoid / arch / text 的包围盒（mm） */
  bbox: { x: number; y: number; w: number; h: number };
  /** 梯形：顶宽 / 底宽（0~1，创建时使用） */
  topRatio: number;
  /** 梯形显式角点 [TL,TR,BR,BL]（拖拽编辑后以角点为准） */
  corners?: Pt[];
  /** 直线两端点（mm） */
  p1?: Pt;
  p2?: Pt;
  /** 料的真实厚度（mm）：斜带的 bbox 看不出厚度，由容器树显式给出 */
  widthMm?: number;
  /** 直线中梃的弧高（mm，正=朝左/上凸）；缺省=直梃，3D 据此按弧分段摆料 */
  curve?: { sagittaMm: number };
  /**
   * 子区真实轮廓（mm，绝对坐标，首尾不重复）。异形外框或弧梃时由容器树给出，
   * 3D 据此挤出玻璃/扇料；缺省时按 bbox/形状轮廓算。
   */
  contour?: Pt[];
  /** 文字内容 */
  text: string;
  /** 平开窗：铰链侧（左开/右开） */
  side?: 'left' | 'right';
  /** 平开窗：开启方向（外开/内开） */
  openDir?: 'in' | 'out';
  /** 构件类型：窗/门 */
  isDoor?: boolean;
  /** 扇位标注 */
  label?: string;
  /** 容器内绘制的平开扇列表（容器局部坐标） */
  sashes?: SashData[];
  /** 门窗业务构件类型；老方案可为空，由适配器按图形推断 */
  componentKind?: ComponentKind;
  /** 参与 BOM 的材料角色，如外框、玻璃、中梃、扇料等 */
  materialRole?: string;
  /** 明确窗型，优先级高于 type/side/openDir 推断 */
  windowType?: WindowType;
}

/**
 * 计算画布全部图形的总体尺寸（所有图形包围盒的并集，mm，四舍五入）。
 * 空画布返回 0×0；用于右侧属性面板「尺寸」只读展示。
 */
export function totalShapeSize(shapes: SketchShape[]): { w: number; h: number } {
  if (!shapes.length) return { w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    const b = s.bbox;
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (minX === Infinity) return { w: 0, h: 0 };
  return { w: Math.round(maxX - minX), h: Math.round(maxY - minY) };
}

export interface DesignerStore {
  library: MaterialLibrary;
  designType: WindowType;
  design: WindowDesign;
  seriesId: string;
  openingW: number;
  openingH: number;
  windowCount: number;
  discountRate: number;
  selectedPanelId: string | null;
  activeTemplateId: string | null;
  orderConfig: OrderConfig;
  shapes: SketchShape[];
  /** 容器树设计模式（R4）：非 null 时画布切为树编辑，为聚焦单元的（布局烘焙 offset）可编辑树镜像 */
  windowTree: WindowTree | null;
  /** 外框拼接装配体（权威结构；单窗时 = 1 单元 0 拼樘）。null = 尚未进入树设计 */
  assembly: WindowAssembly | null;
  /** 当前聚焦（可编辑）单元 id */
  focusedUnitId: string | null;
  /** 当前选中的拼樘 id（属性面板可改厚度/删除） */
  selectedCombinerId: string | null;
  // ★ 新增：当前选中图形的尺寸度量信息（单个图形或组合图形的包围盒）
  selectedMetrics: { width: number; height: number; isGroup: boolean } | null;
  // 编辑历史（撤销 / 重做）
  past: WindowDesign[];
  future: WindowDesign[];
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
  selectPanel: (panelId: string | null) => void;
  applyTemplate: (templateId: string | null) => void;
  updatePanel: (panelId: string, patch: Partial<WindowPanel>) => void;
  splitPanel: (panelId: string, direction: 'vertical' | 'horizontal') => void;
  removePanel: (panelId: string) => void;
  resetPanels: () => void;
  undo: () => void;
  redo: () => void;
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
  /** 画布编辑聚焦单元后回写（布局重排 → 更新 windowTree 镜像） */
  setFocusedTree: (tree: WindowTree) => void;
  /** 从 localStorage 恢复最近一次本地草稿；成功返回 true */
  hydrateDraft: () => boolean;
  /** 导出方案（设计+画布+订单配置）为 JSON 字符串，用于分享/备份 */
  exportScheme: () => string;
  /** 从 JSON 字符串恢复方案（离线分享/协作导入）；成功返回 true */
  importSchemeText: (text: string) => boolean;
  /** 清除本地草稿（如已保存到客户后） */
  clearLocalDraft: () => void;
  addShape: (shape: SketchShape) => void;
  updateShape: (id: string, patch: Partial<SketchShape>) => void;
  removeShape: (id: string) => void;
  setShapesFromCanvas: (shapes: SketchShape[]) => void;
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
  selectedPanelId: null,
  activeTemplateId: null,
  orderConfig: { ...defaultOrderConfig },
  shapes: [],
  windowTree: null,
  assembly: null,
  focusedUnitId: null,
  selectedCombinerId: null,
  // ★ 新增：初始状态为 null（未选中任何图形）
  selectedMetrics: null,
  
  past: [],
  future: [],
  canvPast: [],
  canvFuture: [],
  design: rebuild('casement', 1500, 1500, 'series-60', sampleLibrary, 'g-5-12a-5'),
  // —— 以下操作都会把当前 design 快照写入历史，支持撤销/重做 ——
  setSeries: (seriesId) => {
    const { designType, openingW, openingH, library, design } = get();
    commit(set, get);
    const next = rebuild(designType, openingW, openingH, seriesId, library, design.glassId);
    set({ seriesId, design: next });
    // 容器树/装配模式：同步系列与框宽到每个单元
    const a = get().assembly;
    if (a) {
      const series = library.series.find((s) => s.id === seriesId);
      const na = mapUnits(a, (t) => ({ ...t, seriesId, frameWidthMm: series?.frameWidth ?? t.frameWidthMm }));
      set(deriveFocused(na, get().focusedUnitId ?? na.units[0].id));
    }
  },
  setWindowType: (type) => {
    const { openingW, openingH, library, design } = get();
    commit(set, get);
    set({ designType: type, design: rebuild(type, openingW, openingH, get().seriesId, library, design.glassId) });
  },
  setOpeningSize: (w, h) => {
    const { designType, library, design } = get();
    commit(set, get);
    set({
      openingW: w,
      openingH: h,
      design: rebuild(designType, w, h, get().seriesId, library, design.glassId),
    });
    // 容器树/装配模式：同步洞口尺寸到每个单元
    const a = get().assembly;
    if (a) {
      const na = mapUnits(a, (t) => ({ ...t, openingW: w, openingH: h }));
      set(deriveFocused(na, get().focusedUnitId ?? na.units[0].id));
    }
  },
  setGlass: (glassId) => {
    const { design } = get();
    commit(set, get);
    set({ design: { ...design, glassId } });
  },
  setWindowCount: (windowCount) => set({ windowCount }),
  setDiscountRate: (discountRate) => set({ discountRate }),
  setOrderConfig: (patch) => set((state) => ({ orderConfig: { ...state.orderConfig, ...patch } })),
  selectPanel: (selectedPanelId) => set({ selectedPanelId }),
  applyTemplate: (templateId) => {
    const state = get();
    commit(set, get);
    if (!templateId) {
      set({ activeTemplateId: null, shapes: [], selectedPanelId: null });
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
      set({
        activeTemplateId: templateId,
        design,
        designType: design.panels[0]?.windowType ?? state.designType,
        shapes: buildShapesFromDesignModel(model),
        selectedPanelId: null,
      });
    } catch {
      // 模板数据异常时保持现场，不破坏当前画布
    }
  },
  updatePanel: (panelId, patch) => {
    const state = get();
    commit(set, get);
    set({
      design: {
        ...state.design,
        panels: state.design.panels.map((p) => (p.id === panelId ? { ...p, ...patch } : p)),
      },
    });
  },
  splitPanel: (panelId, direction) => {
    const state = get();
    commit(set, get);
    const panels = [...state.design.panels];
    const idx = panels.findIndex((p) => p.id === panelId);
    if (idx < 0) return;
    const p = panels[idx];
    const fw = (state.library.series.find((s) => s.id === state.design.seriesId) ?? state.library.series[0]).frameWidth;
    if (direction === 'vertical') {
      const mid = Math.max(1, Math.floor(p.w / 2));
      const left: WindowPanel = { ...p, id: randomId(), w: mid, hasSash: false };
      const right: WindowPanel = { ...p, id: randomId(), x: p.x + mid + fw, w: Math.max(1, p.w - mid - fw), hasSash: false };
      panels.splice(idx, 1, left, right);
    } else {
      const mid = Math.max(1, Math.floor(p.h / 2));
      const top: WindowPanel = { ...p, id: randomId(), h: mid, hasSash: false };
      const bottom: WindowPanel = { ...p, id: randomId(), y: p.y + mid + fw, h: Math.max(1, p.h - mid - fw), hasSash: false };
      panels.splice(idx, 1, top, bottom);
    }
    set({ design: { ...state.design, panels } });
  },
  removePanel: (panelId) => {
    const state = get();
    commit(set, get);
    set({
      selectedPanelId: null,
      design: { ...state.design, panels: state.design.panels.filter((p) => p.id !== panelId) },
    });
  },
  resetPanels: () => {
    const state = get();
    commit(set, get);
    set({
      design: {
        ...state.design,
        panels: createDesign(state.designType, { openingW: state.openingW, openingH: state.openingH, seriesId: state.seriesId, name: state.design.name }, selectSeriesSafe(state)).panels,
      },
    });
  },
  undo: () => {
    const { past, future, design } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({ design: prev, past: past.slice(0, -1), future: [design, ...future] });
  },
  redo: () => {
    const { past, future, design } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({ design: next, past: [...past, design], future: future.slice(1) });
  },
  undoCanvas: () => {
    const { canvPast, canvFuture, assembly } = get();
    if (!canvPast.length) return;
    const prev = canvPast[canvPast.length - 1];
    set({ canvPast: canvPast.slice(0, -1), canvFuture: [assembly, ...canvFuture] });
    if (!prev || !prev.units.length) {
      set({ windowTree: null, assembly: null, focusedUnitId: null, selectedCombinerId: null, selectedPanelId: null, activeTemplateId: null });
      return;
    }
    const na = withDefaultAngles(prev);
    set({ ...deriveFocused(na, na.units[0].id), selectedPanelId: null, activeTemplateId: null, selectedCombinerId: null });
  },
  redoCanvas: () => {
    const { canvPast, canvFuture, assembly } = get();
    if (!canvFuture.length) return;
    const next = canvFuture[0];
    set({ canvPast: [...canvPast, assembly], canvFuture: canvFuture.slice(1) });
    if (!next || !next.units.length) {
      set({ windowTree: null, assembly: null, focusedUnitId: null, selectedCombinerId: null, selectedPanelId: null, activeTemplateId: null });
      return;
    }
    const na = withDefaultAngles(next);
    set({ ...deriveFocused(na, na.units[0].id), selectedPanelId: null, activeTemplateId: null, selectedCombinerId: null });
  },
  saveDesign: () => {
    persistDraft(get());
  },
  setWindowTree: (tree) => {
    commitCanvasSnapshot(set, get);
    if (!tree) {
      set({ windowTree: null, assembly: null, focusedUnitId: null, selectedCombinerId: null, selectedPanelId: null, activeTemplateId: null });
      return;
    }
    const a = assemblyFromWindowTree(tree);
    set({ ...deriveFocused(a, a.units[0].id), selectedPanelId: null, activeTemplateId: null, selectedCombinerId: null });
  },
  setAssembly: (a, focusId) => {
    commitCanvasSnapshot(set, get);
    if (!a || !a.units.length) {
      set({ windowTree: null, assembly: null, focusedUnitId: null, selectedCombinerId: null });
      return;
    }
    set(deriveFocused(a, focusId ?? a.units[0].id));
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
    const na = coreSetCombinerThickness(assembly, id, Math.max(10, Math.round(mm)));
    set(deriveFocused(na, focusedUnitId ?? na.units[0].id));
  },
  updateCombinerAngle: (id, deg) => {
    const { assembly, focusedUnitId } = get();
    if (!assembly) return;
    const na = coreSetCombinerAngle(assembly, id, Math.round(deg));
    set(deriveFocused(na, focusedUnitId ?? na.units[0].id));
  },
  setCombinerFittings: (id, fittings) => {
    const { assembly, focusedUnitId } = get();
    if (!assembly) return;
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
  setFocusedTree: (tree) => {
    commitCanvasSnapshot(set, get);
    const { assembly, focusedUnitId } = get();
    if (!assembly || !focusedUnitId) {
      get().setWindowTree(tree);
      return;
    }
    const na = coreSetUnitTree(assembly, focusedUnitId, tree);
    set(deriveFocused(na, focusedUnitId));
  },
  /** 恢复本地草稿（普通设计模式；CRM 方案模式不自动恢复） */
  hydrateDraft: () => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      const { design, openingW, openingH, seriesId, designType, windowCount, orderConfig, shapes } = data;
      if (!design || !Array.isArray(shapes)) return false;
      set({
        design,
        openingW: openingW ?? 1500,
        openingH: openingH ?? 1500,
        seriesId: seriesId ?? 'series-60',
        designType: designType ?? 'casement',
        windowCount: windowCount ?? 1,
        orderConfig: orderConfig ?? get().orderConfig,
        shapes,
        ...reviveAssembly(data),
        selectedPanelId: null,
        activeTemplateId: null,
        past: [],
        future: [],
      });
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
    const { design, openingW, openingH, seriesId, designType, windowCount, discountRate, orderConfig, shapes, windowTree, assembly, focusedUnitId } = get();
    return JSON.stringify(
      { version: 3, savedAt: new Date().toISOString(), design, openingW, openingH, seriesId, designType, windowCount, discountRate, orderConfig, shapes, windowTree, assembly, focusedUnitId },
      null,
      2,
    );
  },
  importSchemeText: (text) => {
    try {
      const data = JSON.parse(text);
      const { design, shapes, orderConfig, seriesId } = data;
      if (!design || !Array.isArray(shapes) || !orderConfig) return false;
      set({
        design,
        shapes,
        orderConfig,
        seriesId: seriesId ?? get().seriesId,
        openingW: data.openingW ?? design.openingW ?? get().openingW,
        openingH: data.openingH ?? design.openingH ?? get().openingH,
        designType: data.designType ?? design.panels?.[0]?.windowType ?? get().designType,
        windowCount: data.windowCount ?? 1,
        discountRate: data.discountRate ?? 0,
        ...reviveAssembly(data),
        selectedPanelId: null,
        activeTemplateId: null,
        past: [],
        future: [],
      });
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
    addShape: (shape) => set((state) => ({ shapes: [...state.shapes, shape] })),
  updateShape: (id, patch) =>
    set((state) => ({
      shapes: state.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })),
  removeShape: (id) => set((state) => ({ shapes: state.shapes.filter((s) => s.id !== id) })),
  setShapesFromCanvas: (shapes) => set({ shapes }),
  
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
 * 装配布局烘焙 → 聚焦单元的可编辑树镜像 + 相关状态片段。
 * windowTree 权威语义降级为「聚焦单元布局后（绝对 offset）树」，供旧画布/树编辑器直接消费。
 */
function deriveFocused(a: WindowAssembly, focusId: string): Partial<DesignerStore> {
  const baked = layoutAssembly(a, { installGap: ASSEMBLY_INSTALL_GAP }).trees.get(focusId) ?? a.units[0].tree;
  return { assembly: a, windowTree: { ...baked }, focusedUnitId: focusId };
}

/** 对每个单元的树做同构变换（保留装配结构与 offset） */
function mapUnits(a: WindowAssembly, fn: (t: WindowTree) => WindowTree): WindowAssembly {
  return { ...a, units: a.units.map((u) => ({ ...u, tree: fn(u.tree) })) };
}

/** 深克隆单元树用于拼接：新 id、清 offset（布局重排会重新烘焙） */
function cloneTree(t: WindowTree): WindowTree {
  const c = JSON.parse(JSON.stringify(t)) as WindowTree;
  c.id = randomId();
  c.offsetX = 0;
  c.offsetY = 0;
  return c;
}

/** 把当前 design 压入历史（撤销栈），并清空重做栈。需在任何 design 变更前调用。 */
function commit(set: (partial: Partial<DesignerStore>) => void, get: () => DesignerStore): void {
  const { design, past } = get();
  const newPast = [...past, design];
  if (newPast.length > HISTORY_LIMIT) newPast.shift();
  set({ past: newPast, future: [] });
}

/** 记录变更前的装配体快照到画布历史栈（与栈顶相同则不重复入栈，避免拖拽/中间态刷屏）。需在画布结构变更前调用。 */
function commitCanvasSnapshot(set: (partial: Partial<DesignerStore>) => void, get: () => DesignerStore): void {
  const { assembly, canvPast } = get();
  const last = canvPast[canvPast.length - 1];
  if (last !== undefined && JSON.stringify(last) === JSON.stringify(assembly)) return;
  const newPast = [...canvPast, assembly];
  if (newPast.length > HISTORY_LIMIT) newPast.shift();
  set({ canvPast: newPast, canvFuture: [] });
}

/** 本地草稿键：手动保存与自动保存共用 */
export const DRAFT_KEY = 'wdd-studio';

function persistDraft(state: DesignerStore): void {
  const { design, openingW, openingH, seriesId, designType, windowCount, orderConfig, shapes, windowTree, assembly, focusedUnitId } = state;
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ design, openingW, openingH, seriesId, designType, windowCount, orderConfig, shapes, windowTree, assembly, focusedUnitId }),
    );
  } catch (err) {
    console.error('保存失败:', err);
  }
}

/** 从草稿/方案 JSON 恢复装配体：优先 assembly，回退 windowTree → 单单元装配 */
function reviveAssembly(data: { assembly?: WindowAssembly | null; windowTree?: WindowTree | null; focusedUnitId?: string | null }): Partial<DesignerStore> {
  const a = data.assembly ?? (data.windowTree ? assemblyFromWindowTree(data.windowTree) : null);
  if (!a || !a.units.length) return { assembly: null, windowTree: data.windowTree ?? null, focusedUnitId: null, selectedCombinerId: null };
  // 旧数据无 combiners[].angleDeg → 统一补 180（直线拼樘），避免下游读到 undefined
  const na = withDefaultAngles(a);
  return deriveFocused(na, data.focusedUnitId && na.units.some((u) => u.id === data.focusedUnitId) ? data.focusedUnitId : na.units[0].id);
}

function selectSeriesSafe(state: DesignerStore): SeriesSpec {
  return state.library.series.find((s) => s.id === state.seriesId) ?? state.library.series[0];
}

export function selectSeries(state: DesignerStore): SeriesSpec {
  return state.library.series.find((s) => s.id === state.design.seriesId) ?? state.library.series[0];
}
