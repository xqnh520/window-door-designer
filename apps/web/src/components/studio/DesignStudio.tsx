import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Divider, InputNumber, Modal, Select, Space, Tooltip, Typography, message } from 'antd';
import { DeleteOutlined, LeftOutlined, RedoOutlined, SaveOutlined, UndoOutlined } from '@ant-design/icons';
import { bomToCsv, computeBomFromDesignModel, computeCuttingList, quoteFromDesignModel, validateDesignModel, createWindowTree, MUNTIN_PATTERN_LABEL, type MuntinPattern, DEFAULT_INSTALL_GAP_MM, DEFAULT_MUNTIN_MM, DEFAULT_MEETING_MM, DEFAULT_LOUVER_PITCH_MM, DEFAULT_PANEL_HEIGHT_MM, findArea, toDesignModelAssembly, combinerDisplayLabel, CORNER_ANGLE_PRESETS, layoutTree, listComponentTypes, listFittingTypes, type ComponentTypeDef, type FittingType, type FrameShape, type FrameSide, type WindowFitting, type WindowTreeArea, type WindowTree, type WindowMuntin, type MuntinSlope, type WindowSashSpec, defaultQuoteRuleSet, FRAME_SHAPE_LABEL, TRAPEZOID_SHAPES, type GlassBarSpec, type GlassBarPattern, type FittingHost } from '@wdd/core';
import type { DesignModel } from '@wdd/schema';
import { sampleWindowTemplates } from '@wdd/schema';
import { focusedTreeFromAssembly, selectCurrentDesignName, selectCurrentGlassId, selectCurrentSeriesId, useStore } from '../../store';
import { downloadText } from '../../util/download';
import { buildDrawingQuotePdfHtml, buildMaterialsPdfHtml, buildCuttingPdfHtml, printHTML } from '../../util/exportPdf';
import type { ExportKind } from './StudioTopBar';
import { collectDesignerPayload } from '../../crm/konva';
import { useCrmStore } from '../../crm/store';
import { SaveSchemeModal } from '../../crm/SaveSchemeModal';
import type { DesignScheme, SaveSchemeInput } from '../../crm/types';
import { TreeEditorCanvas, type TreeCanvasTool, type TreeEditorCanvasHandle } from '../TreeEditorCanvas';
import { projectDesignModel } from '../../canvas/modelProjection';
import { BomTable } from '../BomTable';
import { QuotePanel } from '../QuotePanel';
import { CuttingListTable } from '../CuttingListTable';
import { FormulaConfigModal } from '../FormulaConfigModal';
import { StudioTopBar } from './StudioTopBar';
import { StudioLeftTools } from './StudioLeftTools';
import { StudioRightPanel } from './StudioRightPanel';
import type { StudioBottomTab } from './types';

/** 树编辑放置面板：构件类型中文名 */
const PLACE_TYPE_LABEL: Record<string, string> = {
  fixed: '固定玻璃',
  casement: '平开扇',
  double: '对开扇',
  tiltSlide: '内倒平移扇',
  shade: '百叶窗',
  shadeDouble: '对开百叶窗',
  kfc: '肯德基门',
  kfcDouble: '对开肯德基门',
  sliding: '推拉扇',
  topHinged: '上悬扇',
  screen: '纱窗',
};

/**
 * 左侧构件菜单 → 放置规范。平开系构件只差**扇面填充**（玻璃/百叶帘片/上玻下板）与**扇叶数**
 * （对开＝两片扇 + 中缝对开料），所以统一在一张表里声明，不再堆三元判断。
 */
const PLACE_SPECS: Record<string, WindowSashSpec> = {
  fixed: { windowType: 'fixed', label: 'F1' },
  casement: { windowType: 'casement', label: 'A1', hingeSide: 'left', openDirection: 'out' },
  double: { windowType: 'casement', label: 'A1', hingeSide: 'left', openDirection: 'out', leaves: 2 },
  tiltSlide: { windowType: 'tiltSlide', label: 'A1', hingeSide: 'left', openDirection: 'in' },
  shade: { windowType: 'casement', label: 'A1', hingeSide: 'left', openDirection: 'out', infill: 'louver' },
  shadeDouble: { windowType: 'casement', label: 'A1', hingeSide: 'left', openDirection: 'out', infill: 'louver', leaves: 2 },
  kfc: { windowType: 'casement', label: 'A1', hingeSide: 'left', openDirection: 'out', infill: 'panel' },
  kfcDouble: { windowType: 'casement', label: 'A1', hingeSide: 'left', openDirection: 'out', infill: 'panel', leaves: 2 },
  sliding: { windowType: 'sliding', label: 'S1' },
  topHinged: { windowType: 'topHinged', label: 'A1', hingeSide: 'top', openDirection: 'out' },
  screen: { windowType: 'screen', label: 'WC' },
};

/** 配件类型中文名（16 类，来自注册表） */
const FITTING_LABEL: Record<FittingType, string> = Object.fromEntries(listFittingTypes().map((d) => [d.id, d.label])) as Record<FittingType, string>;

/** 注册表构件：id → def（放置/算料/渲染共用） */
const roleComponents: Record<string, ComponentTypeDef> = Object.fromEntries(listComponentTypes().map((d) => [d.id, d]));

/** 「门窗设计」工作台：顶栏 / 左工具 / 中央 Konva 画布 / 右侧可折叠属性面板 / 底部居中工具栏 */
export function DesignStudio({
  onGoHome,
  onGo3D,
  crmScheme,
  onSaveScheme,
}: {
  onGoHome: () => void;
  onGo3D: () => void;
  /** CRM 方案模式：加载的方案（含 Konva designData）；null = 新建空白方案 */
  crmScheme?: DesignScheme | null;
  /** CRM 方案模式：点「保存方案」时回调（payload 已收集画布/颜色/尺寸/系列） */
  onSaveScheme?: (input: SaveSchemeInput) => Promise<void> | void;
}) {
  const [tool, setTool] = useState<TreeCanvasTool>('select');
  /** 放置模式下已选中的构件类型（legacy SashType 或 registry id）；点击分格时直接放置 */
  const [placeSpec, setPlaceSpec] = useState<string | null>(null);
  /** 切换基础工具（选择/外框/分割）：清除放置态 */
  const handleToolChange = (t: TreeCanvasTool) => {
    setTool(t);
    setPlaceSpec(null);
  };
  /** 从分类菜单选择构件：进入放置模式，等待点击分格 */
  const handlePlaceComponent = (id: string) => {
    setTool('place');
    setPlaceSpec(id);
  };
  const [bottomTab, setBottomTab] = useState<StudioBottomTab>(null);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [focusShapeId, setFocusShapeId] = useState<string | null>(null);
  const [formulaOpen, setFormulaOpen] = useState(false);
  /** 外框工具拖拽完成后的待定矩形：弹「拼接方向」对话框；null=无待定 */
  const [pendingFrame, setPendingFrame] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  /** 拼接方向对话框中「拼樘」复选框状态 */
  const [withCombiner, setWithCombiner] = useState(true);
  /** 新建外框的形状（矩形/等腰梯形/弧形/尖拱），绘制与重画整窗时生效 */
  const [frameShape, setFrameShape] = useState<FrameShape>('rect');
  /** 梯形族窄边比（0.1..0.95），仅 TRAPEZOID_SHAPES 生效，绘制/重画整窗时写入树 */
  const [topRatio, setTopRatio] = useState<number>(0.6);
  /** 配件添加对话框（宿主：外框=frame / 分格=areaId / 拼樘=combinerId） */
  const [fittingOpen, setFittingOpen] = useState(false);
  const [fittingType, setFittingType] = useState<FittingType | null>(null);
  const [fittingCount, setFittingCount] = useState<number>(1);
  /** 等分对话框（选中未分割分格时可用） */
  const [divideOpen, setDivideOpen] = useState(false);
  const [divideN, setDivideN] = useState<number>(2);
  const [divideDir, setDivideDir] = useState<WindowMuntin['direction']>('vertical');
  /** 斜梃模式：null=分割按拖拽主导轴自动（横/竖梃） */
  const [splitSlope, setSplitSlope] = useState<MuntinSlope | null>(null);
  const treeCanvasRef = useRef<TreeEditorCanvasHandle>(null);

  useEffect(() => {
    treeCanvasRef.current?.setSplitSlope(splitSlope);
  }, [splitSlope, tool]);

  const toggleBottom = (t: StudioBottomTab) => setBottomTab(bottomTab === t ? null : t);

  // 本地自动保存（防抖 0.5s）：画布 / 设计 / 系列 / 容器树 / 订单配置变化后落盘，断网或刷新不丢稿
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useStore.subscribe((state, prev) => {
      if (
        state.design === prev.design &&
        state.seriesId === prev.seriesId &&
        state.orderConfig === prev.orderConfig &&
        state.windowCount === prev.windowCount &&
        state.assembly === prev.assembly
      ) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => useStore.getState().saveDesign(), 500);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);

  // 草稿恢复：普通设计模式启动时还原上次的本地草稿
  useEffect(() => {
    if (crmScheme != null) return;
    const restored = useStore.getState().hydrateDraft();
    if (restored) {
      message.success('已恢复上次的本地草稿（自动保存）');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 方案导出/导入：离线备份与协作分享（JSON 格式，两端互通） */
  const handleExportScheme = () => {
    const st = useStore.getState();
    downloadText(`${selectCurrentDesignName(st)}-方案.json`, st.exportScheme());
    message.success('方案 JSON 已导出，可分享给对方直接导入');
  };
  const handleImportScheme = (text: string) => {
    if (useStore.getState().importSchemeText(text)) {
      message.success('方案已导入');
    } else {
      message.error('方案文件无效，导入失败');
    }
  };

  // 外框工具完成：空白画布（无锚单元）直接创建新窗；有窗时为「拼接新框」——记下待定矩形，弹「拼接方向」对话框
  const handleFrameCreate = (x: number, y: number, w: number, h: number) => {
    const st = useStore.getState();
    if (!st.assembly || !st.assembly.units.length) {
      replaceWholeWindow(w, h);
      return;
    }
    setPendingFrame({ x, y, w, h });
  };

  /** 旧行为：重画整窗（忽略原装配体，重设为自由尺寸空白窗） */
  const replaceWholeWindow = (w: number, h: number) => {
    const st = useStore.getState();
    const seriesId = selectCurrentSeriesId(st);
    const series = st.library.series.find((s) => s.id === seriesId) ?? st.library.series[0];
    setWindowTree(
      createWindowTree({
        openingW: Math.max(400, Math.round(w)),
        openingH: Math.max(400, Math.round(h)),
        seriesId,
        glassId: selectCurrentGlassId(st),
        frameWidthMm: series.frameWidth ?? 60,
        sashWidthMm: series.sashWidth,
        name: '新窗',
        frameShape,
        topRatio: TRAPEZOID_SHAPES.includes(frameShape) ? topRatio : undefined,
      }),
    );
    message.success(`已创建新窗（${FRAME_SHAPE_LABEL[frameShape]}外框，可用分割 / 放置工具设计）`);
  };

  // 清空画布：删除全部窗框/拼樘/构件，恢复空白画布（对齐第三方工具「新画布=空白图纸」，用外框工具重新绘制）
  const handleClearCanvas = () => {
    const st = useStore.getState();
    if (!st.assembly) return;
    Modal.confirm({
      title: '清空画布',
      content: '将删除当前全部窗框、拼樘与构件，画布恢复为空白（可重新自定义窗型）。确定清空？',
      onOk: () => {
        const st = useStore.getState();
        st.setWindowTree(null);
        setTool('framing');
        setPlaceSpec(null);
        setPendingFrame(null);
        message.success('画布已清空 · 点击左侧「外框」工具拖拽绘制新窗');
      },
    });
  };

  // ── WindowAssembly 是唯一业务状态；聚焦树是只读布局投影 ──
  const setWindowTree = useStore((s) => s.setWindowTree);
  const assembly = useStore((s) => s.assembly);
  const focusedUnitId = useStore((s) => s.focusedUnitId);
  const windowTree = useMemo(
    () => focusedTreeFromAssembly(assembly, focusedUnitId),
    [assembly, focusedUnitId],
  );
  const selectedCombinerId = useStore((s) => s.selectedCombinerId);
  const dispatchCanvas = useStore((s) => s.dispatchCanvas);
  const setFocusedUnit = useStore((s) => s.setFocusedUnit);
  const selectCombiner = useStore((s) => s.selectCombiner);
  const addDrawnFrame = useStore((s) => s.addDrawnFrame);
  const updateCombinerThickness = useStore((s) => s.updateCombinerThickness);
  const updateCombinerAngle = useStore((s) => s.updateCombinerAngle);
  const setCombinerFittings = useStore((s) => s.setCombinerFittings);
  const removeCombiner = useStore((s) => s.removeCombiner);
  /** 画布撤销/恢复（对齐第三方「撤销/恢复/删除」常驻编辑工具条） */
  const undoCanvas = useStore((s) => s.undoCanvas);
  const redoCanvas = useStore((s) => s.redoCanvas);
  const canUndoCanvas = useStore((s) => s.canvPast.length > 0);
  const canRedoCanvas = useStore((s) => s.canvFuture.length > 0);
  const deleteSelected = () => treeCanvasRef.current?.deleteSelected();
  /** 拼接方向确认：以聚焦单元为锚接入 W×H 的新框（方向/角度取自对话框状态） */
  const commitDrawnFrame = () => {
    const f = pendingFrame;
    if (!f || !pendingDir) return;
    addDrawnFrame({ dir: pendingDir, w: f.w, h: f.h, withCombiner, angleDeg: pendingAngle });
    setPendingFrame(null);
    message.success(
      `已按「${pendingDir === 'up' ? '上' : pendingDir === 'down' ? '下' : pendingDir === 'left' ? '左' : '右'}」拼接新框` +
        (withCombiner && pendingDir !== 'up' && pendingDir !== 'down' && pendingAngle !== 180 ? `（${pendingAngle}° 转角）` : ''),
    );
  };

  /** 拖拽矩形中心相对聚焦框中心推断默认拼接方向（两轴取主导轴） */
  const suggestedDir = useMemo<'up' | 'down' | 'left' | 'right' | null>(() => {
    const f = pendingFrame;
    if (!f || !windowTree) return null;
    const fr = layoutTree(windowTree, { installGap: DEFAULT_INSTALL_GAP_MM }).frame;
    const dx = f.x + f.w / 2 - (fr.x + fr.w / 2);
    const dy = f.y + f.h / 2 - (fr.y + fr.h / 2);
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
    return dy >= 0 ? 'down' : 'up';
  }, [pendingFrame, windowTree]);

  /** 外框拼接方向对话框状态：方向 / 夹角（度） */
  const [pendingDir, setPendingDir] = useState<'up' | 'down' | 'left' | 'right' | null>(null);
  const [pendingAngle, setPendingAngle] = useState<number>(CORNER_ANGLE_PRESETS[2]);
  // 每次打开对话框时按拖拽位置重置默认方向与角度
  useEffect(() => {
    if (!pendingFrame) return;
    setPendingDir(suggestedDir);
    setPendingAngle(180);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFrame]);

  // 装配 → DesignModel：始终包含全部单元与拼樘。
  const treeModel = useMemo<DesignModel | null>(() => {
    if (!assembly?.units.length) return null;
    return toDesignModelAssembly(assembly, {
      installGap: DEFAULT_INSTALL_GAP_MM,
      name: assembly.name,
      seriesId: assembly.seriesId,
      glassId: assembly.glassId,
    });
  }, [assembly]);
  /** 放置构件到指定分格：registry id 走 roleType，legacy 5 类走 windowType（分类菜单选中后点分格触发） */
  const applyPlace = (areaId: string, type: string) => {
    if (!windowTree) return;
    if (roleComponents[type]) {
      // 构件体系扩展类型：承载 windowType 用 fixed，roleType 标记实际类型
      const def = roleComponents[type];
      dispatchCanvas({ type: 'set-sash', areaId, spec: { windowType: 'fixed', roleType: def.id, label: def.label } });
      message.success(`已放置${def.label}`);
      return;
    }
    const spec = PLACE_SPECS[type];
    if (!spec) return;
    dispatchCanvas({ type: 'set-sash', areaId, spec: { ...spec } });
    message.success(`已放置${PLACE_TYPE_LABEL[type] ?? type}`);
  };

  /** 选中的叶子分格（玻璃格条 / 属性浮层 / 配件宿主共用）；容器分格与中梃都不算 */
  const selectedLeafArea = useMemo<WindowTreeArea | null>(() => {
    if (!windowTree || !focusShapeId || focusShapeId === 'frame') return null;
    const a = findArea(windowTree, focusShapeId);
    return a && !a.children ? a : null;
  }, [windowTree, focusShapeId]);

  /** 复合梃可套用：选中的是分格（含容器分格）而不是外框或中梃 */
  const canApplyPattern = !!windowTree && !!focusShapeId && focusShapeId !== 'frame' && !!findArea(windowTree, focusShapeId);

  /**
   * 配件宿主：拼樘优先于画布选中。
   * 用 findArea 校验，选中中梃这类非法宿主直接为 null（左栏「配件」钮据此置灰），
   * 不再像旧实现那样把 focusShapeId 当 area id、直到确认添加时才报错。
   */
  const fittingHost: FittingHost | null = selectedCombinerId
    ? 'combiner'
    : focusShapeId === 'frame'
      ? 'tree'
      : focusShapeId && windowTree && findArea(windowTree, focusShapeId)
        ? 'area'
        : null;
  const fittingCombinerId = fittingHost === 'combiner' ? selectedCombinerId : null;
  const fittingAreaId = fittingHost === 'area' ? focusShapeId : null;
  const fittingCombiner = fittingCombinerId ? assembly?.combiners.find((c) => c.id === fittingCombinerId) : undefined;
  const fittingHostLabel = fittingCombiner ? combinerDisplayLabel(fittingCombiner) : fittingHost === 'tree' ? '外框' : '选中分格';
  const fittingOptions = fittingHost ? listFittingTypes(fittingHost) : [];
  const currentFittings: WindowFitting[] = useMemo(() => {
    if (fittingCombinerId) return fittingCombiner?.fittings ?? [];
    if (!windowTree) return [];
    if (fittingHost === 'tree') return windowTree.fittings ?? [];
    if (!fittingAreaId) return [];
    return findArea(windowTree, fittingAreaId)?.fittings ?? [];
  }, [windowTree, fittingHost, fittingAreaId, fittingCombinerId, fittingCombiner]);

  const confirmFitting = () => {
    if (!fittingType) return;
    const fit: WindowFitting = { id: `fit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type: fittingType, count: Math.max(1, fittingCount) };
    if (fittingCombinerId) {
      setCombinerFittings(fittingCombinerId, [...currentFittings, fit]);
      setFittingOpen(false);
      message.success('已添加配件');
      return;
    }
    if (!windowTree) return;
    if (fittingHost === 'tree') {
      dispatchCanvas({ type: 'set-fittings', host: 'tree', fittings: [...currentFittings, fit] });
    } else if (fittingAreaId) {
      dispatchCanvas({ type: 'set-fittings', host: 'area', areaId: fittingAreaId, fittings: [...currentFittings, fit] });
    }
    setFittingOpen(false);
    message.success('已添加配件');
  };

  const removeFittingAt = (index: number) => {
    if (fittingCombinerId) {
      setCombinerFittings(fittingCombinerId, currentFittings.filter((_, i) => i !== index));
      message.success('已移除配件');
      return;
    }
    if (!windowTree) return;
    if (fittingHost === 'tree') {
      dispatchCanvas({ type: 'set-fittings', host: 'tree', fittings: currentFittings.filter((_, i) => i !== index) });
    } else if (fittingAreaId) {
      dispatchCanvas({ type: 'set-fittings', host: 'area', areaId: fittingAreaId, fittings: currentFittings.filter((_, i) => i !== index) });
    }
    message.success('已移除配件');
  };

  /** 等分：把选中的未分割分格按 n 等分（选中外框时不可用；已放扇的格子等分后得到 n 个独立扇） */
  const confirmDivide = () => {
    if (!windowTree || !focusShapeId || focusShapeId === 'frame') return;
    const ok = !!dispatchCanvas({ type: 'equal-divide', areaId: focusShapeId, direction: divideDir, count: divideN });
    if (!ok) {
      message.error(
        divideDir === 'diagonal' || divideDir === 'antiDiagonal'
          ? '该分格已被分割过，或尺寸/形状不足以切出斜梃'
          : '该分格已被分割过，无法再等分；请选择空白分格或先删除其分割',
      );
      return;
    }
    setDivideOpen(false);
    message.success(`已等分为 ${divideN} 份`);
  };

  /** 复合梃预设：一键把选中分格切成整套对称分格；切不出时核心已整单回滚，这里只提示 */
  const applyPattern = (pattern: MuntinPattern) => {
    if (!windowTree || !focusShapeId || focusShapeId === 'frame') return;
    const applied = dispatchCanvas({ type: 'muntin-pattern', areaId: focusShapeId, pattern });
    if (!applied) {
      message.error('该分格的尺寸/形状不足以套这组分格，未做任何改动');
      return;
    }
    message.success(`已套用「${MUNTIN_PATTERN_LABEL[pattern]}」`);
  };

  /** 左栏「外框形状」：选形状即切到外框工具，选完可直接拖画（handleToolChange 顺带清放置态） */
  const handlePickFrameShape = (s: FrameShape) => {
    setFrameShape(s);
    handleToolChange('framing');
  };

  /** 改选中分格的格条：只提交 area patch，不直接修改聚焦树镜像。 */
  const mutateSelectedBars = (mut: (bars: GlassBarSpec | undefined) => GlassBarSpec | undefined) => {
    if (!windowTree || !selectedLeafArea) return;
    dispatchCanvas({ type: 'patch-area', areaId: selectedLeafArea.id, patch: { bars: mut(selectedLeafArea.bars) } });
  };

  const handlePickBarPattern = (p: GlassBarPattern | 'none') => {
    mutateSelectedBars((prev) =>
      p === 'none' ? undefined : { pattern: p, cols: prev?.cols ?? 2, rows: prev?.rows ?? 2, topBar: prev?.topBar },
    );
  };

  const handleBarTopBarChange = (v: boolean) => {
    mutateSelectedBars((prev) => (prev ? { ...prev, topBar: v } : prev));
  };

  const handleBarColsRowsChange = (cols: number, rows: number) => {
    mutateSelectedBars((prev) => (prev ? { ...prev, cols, rows } : prev));
  };

  /** 左栏「配件」：按当前宿主预选类型，数量填写与已有配件的展示/移除仍走既有弹窗 */
  const handleOpenFitting = (type: FittingType) => {
    if (!fittingHost) return;
    setFittingType(type);
    setFittingCount(1);
    setFittingOpen(true);
  };

  // 「保存到客户」守卫弹窗（CRM 模式且未选择客户时弹出）
  const [saveCustomerOpen, setSaveCustomerOpen] = useState(false);

  /** 执行 CRM 方案保存；兼容图形由 CRM 边界从 WindowAssembly 单向投影。 */
  const doCrmSave = async () => {
    if (!onSaveScheme) return;
    const payload = collectDesignerPayload();
    await onSaveScheme({
      schemeId: crmScheme?.id,
      name: crmScheme?.name ?? `方案-${payload.totalWidth}x${payload.totalHeight}`,
      shapes: payload.shapes,
      colorConfig: payload.colorConfig,
      totalWidth: payload.totalWidth,
      totalHeight: payload.totalHeight,
      seriesName: payload.seriesName,
    });
    // 方案已归属客户：清除本地草稿，避免下次误恢复
    useStore.getState().clearLocalDraft();
  };

  /**
   * 底部「保存」按钮：
   * - 普通设计模式：保存到本地（localStorage）
   * - CRM 方案模式：保存到归属客户；未选择客户时弹出「选择/新建/退出」守卫弹窗
   */
  const handleBottomSave = async () => {
    if (!onSaveScheme) {
      useStore.getState().saveDesign();
      message.success('已保存到本地');
      return;
    }
    const crmState = useCrmStore.getState();
    const customerId = crmState.selectedCustomerId ?? crmState.currentCustomer?.id ?? null;
    if (!customerId) {
      setSaveCustomerOpen(true); // 提醒：选择 / 新建客户，或退出
      return;
    }
    try {
      await doCrmSave();
    } catch (err) {
      message.error(`保存失败：${(err as Error).message}`);
    }
  };

  /** 守卫弹窗确认：绑定客户后执行保存 */
  const handleSaveCustomerConfirmed = async (customerId: string) => {
    useCrmStore.getState().setSchemeCustomer(customerId);
    setSaveCustomerOpen(false);
    try {
      await doCrmSave();
    } catch (err) {
      message.error((err as Error).message);
    }
  };

  // ── 全局快捷键 ────────────────────────────────────────────
  // 顶栏按钮与 Tooltip 早已承诺 Ctrl+S / Ctrl+Z，但快捷键一直没绑定；此处补齐到同一批动作上。
  // ctx 随渲染更新，监听器只绑一次，避免为拿到最新 state 而反复重挂 window 监听。
  const shortcutCtx = useRef({
    tool: 'select' as TreeCanvasTool,
    /** 有浮层/对话框打开时让 Esc 归它们管，不抢工具态 */
    overlayOpen: false,
    bottomTabOpen: false,
    undo: () => {},
    redo: () => {},
    save: () => {},
    pickTool: (_t: TreeCanvasTool) => {},
    closeBottom: () => {},
  });
  shortcutCtx.current = {
    tool,
    overlayOpen: formulaOpen || divideOpen || fittingOpen || saveCustomerOpen || !!pendingFrame,
    bottomTabOpen: bottomTab !== null,
    undo: () => undoCanvas(),
    redo: () => redoCanvas(),
    save: () => void handleBottomSave(),
    pickTool: (t) => handleToolChange(t),
    closeBottom: () => setBottomTab(null),
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      // 表单里打字不该触发画布动作（antd Select 的可搜索输入也是 INPUT）
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const ctx = shortcutCtx.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 's') {
          e.preventDefault();
          ctx.save();
          return;
        }
        if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) ctx.redo();
          else ctx.undo();
          return;
        }
        if (k === 'y') {
          e.preventDefault();
          ctx.redo();
          return;
        }
        return;
      }
      if (e.altKey) return;
      // Delete / Backspace 归画布控制器（它才拿得到 Konva 侧的选中态）
      if (e.key === 'Escape') {
        if (ctx.overlayOpen) return; // 对话框 / 配件面板自己处理 Esc
        if (ctx.bottomTabOpen) {
          e.preventDefault();
          ctx.closeBottom();
          return;
        }
        if (ctx.tool !== 'select') {
          e.preventDefault();
          ctx.pickTool('select');
        }
        return;
      }
      const toolKey = { '1': 'select', '2': 'framing', '3': 'split' } as const;
      const next = toolKey[e.key as keyof typeof toolKey];
      if (next && next !== ctx.tool) {
        e.preventDefault();
        ctx.pickTool(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** 导出：材料 PDF / 材料 CSV（表格）/ 图纸 + 报价 PDF */
  const handleExport = async (kind: ExportKind) => {
    const state = useStore.getState();
    const { design, library } = state;
    const model = treeModel ?? projectDesignModel(state);
    if (!model) {
      message.warning('画布为空，暂无可导出的材料或报价数据');
      return;
    }
    const series = library.series.find((s) => s.id === model.seriesId) ?? library.series[0];
    const exportDesign = {
      ...design,
      openingW: model.openingW,
      openingH: model.openingH,
      seriesId: model.seriesId,
      glassId: model.glassId,
    };
    const bom = computeBomFromDesignModel(model, series, library);

    if (kind === 'material-csv') {
      downloadText(`${design.name}-材料清单.csv`, bomToCsv(bom, `${design.name} 门窗材料清单`));
      message.success('材料清单 CSV 已导出');
      return;
    }

    // 图纸快照（画布 PNG，含标注）
    const imageDataUrl = treeCanvasRef.current?.exportImage() ?? undefined;

    if (kind === 'material-pdf') {
      await printHTML(buildMaterialsPdfHtml({ design: exportDesign, series, bom, imageDataUrl }));
    } else if (kind === 'quote-pdf') {
      const sashCount =
        model?.components.filter((c) => c.kind === 'casementSash' || c.kind === 'slidingSash' || c.kind === 'topHungSash').length ?? 0;
      const specialShape = !!model?.components.find((c) => c.kind === 'outerFrame' && c.shape && c.shape !== 'rect');
      const quote = quoteFromDesignModel(model, bom, defaultQuoteRuleSet, state.windowCount, state.discountRate, {
        sashCount,
        specialShape,
        color: state.orderConfig.outerColor,
        hardware: state.orderConfig.hardware,
        glassId: model.glassId,
      });
      await printHTML(
        buildDrawingQuotePdfHtml({ design: exportDesign, series, bom, quote, windowCount: state.windowCount, imageDataUrl }),
      );
    } else if (kind === 'cutting-pdf') {
      // 工艺校验：存在 error 级问题时阻止导出生产下料单（右侧面板可定位修正）
      const activeTemplate = sampleWindowTemplates.find((t) => t.id === state.activeTemplateId) ?? null;
      const errors = validateDesignModel(model, series, activeTemplate, library).filter((i) => i.level === 'error');
      if (errors.length) {
        message.error(`设计校验存在 ${errors.length} 个严重错误（如「${errors[0].message}」），请先在右侧属性面板修正后再导出下料单`);
        return;
      }
      const cutting = computeCuttingList(bom, series);
      await printHTML(buildCuttingPdfHtml({ design: exportDesign, series, cutting, imageDataUrl }));
    }
    message.success('已生成 PDF：请在打印对话框中选择「另存为 PDF」');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 620,
        background: '#fff',
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      }}
    >
      {/* 3D 立体按钮样式（右侧折叠栏） */}
      <style>{`
        .wdd-3d-tab{
          border: none;
          cursor: pointer;
          color: #fff;
          background: linear-gradient(180deg, #66b1ff 0%, #1677ff 55%, #0b5ed7 100%);
          box-shadow: 0 3px 8px rgba(22,119,255,.40), inset 0 1px 0 rgba(255,255,255,.55), inset 0 -2px 0 rgba(0,0,0,.22);
          text-shadow: 0 1px 1px rgba(0,0,0,.28);
          transition: transform .12s ease, box-shadow .12s ease, filter .12s ease;
        }
        .wdd-3d-tab:hover{
          transform: translateY(-2px);
          box-shadow: 0 6px 14px rgba(22,119,255,.50), inset 0 1px 0 rgba(255,255,255,.60), inset 0 -2px 0 rgba(0,0,0,.20);
          filter: brightness(1.05);
        }
        .wdd-3d-tab:active{
          transform: translateY(1px) scale(.98);
          box-shadow: 0 1px 3px rgba(22,119,255,.40), inset 0 2px 3px rgba(0,0,0,.28), inset 0 -1px 0 rgba(255,255,255,.15);
        }
      `}</style>
      <StudioTopBar
        onGoHome={onGoHome}
        onGo3D={onGo3D}
        onExport={handleExport}
        onExportScheme={handleExportScheme}
        onImportScheme={handleImportScheme}
        onOpenFormula={() => setFormulaOpen(true)}
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <StudioLeftTools
          tool={tool}
          placeSpec={placeSpec}
          onToolChange={handleToolChange}
          onPlaceComponent={handlePlaceComponent}
          frameShape={frameShape}
          topRatio={topRatio}
          onPickFrameShape={handlePickFrameShape}
          onTopRatioChange={setTopRatio}
          selectedBarPattern={selectedLeafArea ? selectedLeafArea.bars?.pattern ?? 'none' : null}
          barTopBar={selectedLeafArea?.bars?.topBar}
          barCols={selectedLeafArea?.bars?.cols}
          barRows={selectedLeafArea?.bars?.rows}
          onPickBarPattern={handlePickBarPattern}
          onBarTopBarChange={handleBarTopBarChange}
          onBarColsRowsChange={handleBarColsRowsChange}
          canApplyPattern={canApplyPattern}
          onApplyPattern={applyPattern}
          fittingHost={fittingHost}
          onOpenFitting={handleOpenFitting}
          bottomTab={bottomTab}
          onToggleBottom={toggleBottom}
        />
        {/* 中央画布区：树驱动统一画布（空白画布保持可交互，用「外框」工具绘制首个外框） */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            padding: 6,
            background: 'repeating-linear-gradient(45deg,#fafbfc,#fafbfc 10px,#f7f8f9 10px,#f7f8f9 20px)',
          }}
        >
          <TreeEditorCanvas
            ref={treeCanvasRef}
            tree={windowTree}
            assembly={assembly}
            focusedUnitId={focusedUnitId}
            selectedCombinerId={selectedCombinerId}
            tool={tool}
            onAction={dispatchCanvas}
            onPlaceRequest={(areaId) => {
              if (placeSpec) applyPlace(areaId, placeSpec);
            }}
            onFrameCreate={handleFrameCreate}
            onSelectUnit={(id) => setFocusedUnit(id)}
            onSelectCombiner={(id) => selectCombiner(id)}
            onSelect={(id) => setFocusShapeId(id)}
          />
          {/* 画布操作工具条：只放撤销/恢复/删除与整窗级操作；构件入口统一在左侧工具栏 */}
          <div
            style={{
              position: 'absolute',
              top: 14,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 20,
              display: 'flex',
              gap: 4,
              background: 'rgba(255,255,255,0.94)',
              border: '1px solid #e8e8e8',
              borderRadius: 8,
              padding: '3px 6px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}
          >
            <Tooltip title="撤销（Ctrl+Z）">
              <Button size="small" type="text" icon={<UndoOutlined />} disabled={!canUndoCanvas} onClick={() => undoCanvas()} />
            </Tooltip>
            <Tooltip title="恢复（Ctrl+Shift+Z / Ctrl+Y）">
              <Button size="small" type="text" icon={<RedoOutlined />} disabled={!canRedoCanvas} onClick={() => redoCanvas()} />
            </Tooltip>
            <Tooltip title="删除选中（Delete）">
              <Button size="small" type="text" danger icon={<DeleteOutlined />} disabled={!focusShapeId} onClick={deleteSelected} />
            </Tooltip>
            <div style={{ width: 1, height: 18, background: '#e8e8e8', margin: '0 2px' }} />
            <Tooltip title="缺边（开放框 / 传递窗 / 吧台窗 / 落地门洞）：被缺的那条边不画框料、也不进下料与报价；作用于当前聚焦窗">
              <Select
                size="small"
                style={{ width: 136 }}
                mode="multiple"
                maxTagCount={1}
                placeholder="四边完整"
                value={windowTree ? windowTree.frameOpenSides ?? [] : []}
                onChange={(v: FrameSide[]) => {
                  if (!windowTree) return;
                  dispatchCanvas({ type: 'patch-tree', patch: { frameOpenSides: v.length && v.length < 4 ? v : undefined } });
                }}
                options={[
                  { value: 'up', label: '缺上边' },
                  { value: 'down', label: '缺下边' },
                  { value: 'left', label: '缺左边' },
                  { value: 'right', label: '缺右边' },
                ]}
              />
            </Tooltip>
            <Tooltip title="分割方向：自动=按拖拽主导轴出横/竖梃；斜向=沿宿主区对角线族出斜梃（弧高对斜梃无效）">
              <Select
                size="small"
                style={{ width: 112 }}
                value={splitSlope ?? 'auto'}
                onChange={(v) => setSplitSlope(v === 'auto' ? null : (v as MuntinSlope))}
                options={[
                  { value: 'auto', label: '分割:自动' },
                  { value: 'diagonal', label: '分割:斜梃 ↘' },
                  { value: 'antiDiagonal', label: '分割:斜梃 ↗' },
                ]}
              />
            </Tooltip>
            <Tooltip title="把选中的分格等分（2-12 份）">
              <Button size="small" type="text" disabled={!focusShapeId || focusShapeId === 'frame'} onClick={() => setDivideOpen(true)}>
                等分
              </Button>
            </Tooltip>
          </div>
          {!windowTree && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                color: '#999',
                fontSize: 13,
                pointerEvents: 'none',
              }}
            >
              <div style={{ fontSize: 44 }}>🪟</div>
              <div style={{ fontSize: 15, color: '#666' }}>画布为空</div>
              <div>点击左侧「外框」工具，拖拽绘制窗框开始设计</div>
            </div>
          )}
          {/* 选中树节点信息作为右侧属性提示（外部模型驱动） */}

          {/* 报价 / 图纸 浮层卡片 */}
          {bottomTab === 'material' && (
            <FloatCard title="材料清单 / BOM" onClose={() => setBottomTab(null)}>
              <BomTable modelOverride={treeModel} />
            </FloatCard>
          )}
          {bottomTab === 'quote' && (
            <FloatCard title="报价单" onClose={() => setBottomTab(null)}>
              <QuotePanel modelOverride={treeModel} />
            </FloatCard>
          )}
          {bottomTab === 'drawing' && (
            <FloatCard title="图纸信息" onClose={() => setBottomTab(null)}>
              <DrawingInfo modelOverride={treeModel} />
            </FloatCard>
          )}
          {bottomTab === 'cutting' && (
            <FloatCard title="生产下料单" onClose={() => setBottomTab(null)}>
              <CuttingListTable modelOverride={treeModel} />
            </FloatCard>
          )}
          {/* 选中叶子分格：整窗级料厚参数 + 该扇自身属性（玻璃格条已移入左栏「玻璃格条」分类） */}
          {(() => {
            if (!windowTree || !selectedLeafArea) return null;
            const area = selectedLeafArea;
            const sash = area.sash;
            const applyTree = (patch: Partial<WindowTree>) => dispatchCanvas({ type: 'patch-tree', patch });
            const applySash = (patch: Partial<WindowSashSpec>) => dispatchCanvas({ type: 'patch-sash', areaId: area.id, patch });
            const shownSashWidth = windowTree.sashWidthMm ?? windowTree.frameWidthMm + 10;
            const shownMuntinWidth = windowTree.muntinWidthMm ?? DEFAULT_MUNTIN_MM;
            const shownMeetingWidth = windowTree.meetingWidthMm ?? DEFAULT_MEETING_MM;
            const shownLouverPitch = windowTree.louverPitchMm ?? DEFAULT_LOUVER_PITCH_MM;
            const shownPanelHeight = windowTree.panelHeightMm ?? DEFAULT_PANEL_HEIGHT_MM;
            const h = sash?.handle ?? {};
            return (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  zIndex: 30,
                  background: '#fff',
                  border: '1px solid #d9d9d9',
                  borderRadius: 8,
                  padding: '8px 12px',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.16)',
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  maxWidth: '82%',
                  gap: 8,
                }}
              >
                <Typography.Text strong style={{ fontSize: 12 }}>{sash?.label || area.label || (sash ? '扇' : '分格')} 属性</Typography.Text>
                <Tooltip title="中梃料厚（整窗统一值，缺省 40）：作用于分割预览、等分与中梃出料；实测直梃 40、弧梃 50">
                  <Space size={4}>
                    <Typography.Text style={{ fontSize: 12 }}>中梃厚(mm)</Typography.Text>
                    <InputNumber
                      size="small"
                      min={15}
                      max={120}
                      step={5}
                      value={shownMuntinWidth}
                      onChange={(v) => { if (v != null) applyTree({ muntinWidthMm: v }); }}
                      style={{ width: 68 }}
                    />
                  </Space>
                </Tooltip>
                <Tooltip title="新建中梃的弧高（mm）：正值朝左/上凸出，负值反向，0=直梃；作用于之后的分割与等分，弧带按中心线弧长出下料">
                  <Space size={4}>
                    <Typography.Text style={{ fontSize: 12 }}>弧高(mm)</Typography.Text>
                    <InputNumber
                      size="small"
                      min={-2000}
                      max={2000}
                      step={10}
                      value={windowTree.muntinSagittaMm ?? 0}
                      onChange={(v) => { applyTree({ muntinSagittaMm: v || undefined }); }}
                      style={{ width: 72 }}
                    />
                  </Space>
                </Tooltip>
                <Tooltip title="扇料应略宽于外框料；此处为整窗统一值，缺省 = 外框料宽 + 10">
                  <Space size={4}>
                    <Typography.Text style={{ fontSize: 12 }}>扇料宽(mm)</Typography.Text>
                    <InputNumber
                      size="small"
                      min={10}
                      max={200}
                      step={1}
                      value={shownSashWidth}
                      onChange={(v) => { if (v != null) applyTree({ sashWidthMm: v }); }}
                      style={{ width: 78 }}
                    />
                  </Space>
                </Tooltip>
                {(sash?.windowType === 'casement' || sash?.windowType === 'screen') && (
                  <Tooltip title="对开扇＝一个构件两片扇：中缝是两根「对开料」（不加中梃），两叶各自外向合页、各自把手贴中缝，玻璃拆两块">
                    <Checkbox
                      checked={sash.leaves === 2}
                      onChange={(e) => applySash({ leaves: e.target.checked ? 2 : undefined })}
                    >
                      <span style={{ fontSize: 12 }}>对开（两扇）</span>
                    </Checkbox>
                  </Tooltip>
                )}
                {(sash?.windowType === 'casement' || sash?.windowType === 'screen' || sash?.windowType === 'tiltSlide') && (
                  <Tooltip title="扇面填充（对齐对方「其他」面板的填充物）：玻璃 / 百叶帘片（不出玻璃与压线）/ 上玻下板（肯德基门，玻璃只剩上半）">
                    <Space size={4}>
                      <Typography.Text style={{ fontSize: 12 }}>扇面</Typography.Text>
                      <Select
                        size="small"
                        style={{ width: 96 }}
                        value={sash.infill ?? 'glass'}
                        onChange={(v) => applySash({ infill: v === 'glass' ? undefined : v })}
                        options={[
                          { value: 'glass', label: '玻璃' },
                          { value: 'louver', label: '百叶帘片' },
                          { value: 'panel', label: '上玻下板' },
                        ]}
                      />
                    </Space>
                  </Tooltip>
                )}
                {sash?.infill === 'panel' && (
                  <Tooltip title="下板高度（mm，整窗统一）：实测 windoorcraft 肯德基门下部横板 200mm">
                    <Space size={4}>
                      <Typography.Text style={{ fontSize: 12 }}>下板高(mm)</Typography.Text>
                      <InputNumber
                        size="small"
                        min={60}
                        max={1200}
                        step={10}
                        value={shownPanelHeight}
                        onChange={(v) => { if (v != null) applyTree({ panelHeightMm: v }); }}
                        style={{ width: 78 }}
                      />
                    </Space>
                  </Tooltip>
                )}
                {sash?.infill === 'louver' && (
                  <Tooltip title="帘片间距（mm，整窗统一）：对方未采到片距，按行业惯例缺省 100">
                    <Space size={4}>
                      <Typography.Text style={{ fontSize: 12 }}>百叶间距(mm)</Typography.Text>
                      <InputNumber
                        size="small"
                        min={20}
                        max={400}
                        step={10}
                        value={shownLouverPitch}
                        onChange={(v) => { if (v != null) applyTree({ louverPitchMm: v }); }}
                        style={{ width: 78 }}
                      />
                    </Space>
                  </Tooltip>
                )}
                {sash?.leaves === 2 && (
                  <Tooltip title="中缝两根对开料的宽度（mm）；实测 windoorcraft 扇料 22mm 时对开料 60mm">
                    <Space size={4}>
                      <Typography.Text style={{ fontSize: 12 }}>中缝料(mm)</Typography.Text>
                      <InputNumber
                        size="small"
                        min={20}
                        max={200}
                        step={1}
                        value={shownMeetingWidth}
                        onChange={(v) => { if (v != null) applyTree({ meetingWidthMm: v }); }}
                        style={{ width: 78 }}
                      />
                    </Space>
                  </Tooltip>
                )}
                <Tooltip title="有开启扇即自动带把手；在画布上直接拖动即可定位，可移动范围为该扇料边框的长宽，画布标注为实际生效值">
                  <Space size={4}>
                    <Checkbox
                      checked={h.show !== false}
                      onChange={(e) => applySash({ handle: { ...h, show: e.target.checked } })}
                    >
                      <span style={{ fontSize: 12 }}>把手（可拖动）</span>
                    </Checkbox>
                  </Space>
                </Tooltip>
              </div>
            );
          })()}
          {/* 拼樘/转角料编辑浮层：选中时可改厚度、夹角或删除（删除连带移除其下游窗框） */}
          {(() => {
            const comb = assembly?.combiners.find((c) => c.id === selectedCombinerId);
            if (!comb) return null;
            return (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  zIndex: 30,
                  background: '#fff',
                  border: '1px solid #d9d9d9',
                  borderRadius: 8,
                  padding: '8px 12px',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.16)',
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  maxWidth: '82%',
                  gap: 8,
                }}
              >
                <Typography.Text strong style={{ fontSize: 12 }}>{combinerDisplayLabel(comb)} · 厚度(mm)</Typography.Text>
                <InputNumber
                  size="small"
                  min={10}
                  value={comb.thicknessMm}
                  onChange={(v) => { if (v != null) updateCombinerThickness(comb.id, v); }}
                  style={{ width: 88 }}
                />
                {comb.axis === 'x' && (
                  <Tooltip title="夹角仅影响 2D/3D 呈现与放样，不改变下料长度（转角料长=框高）">
                    <Space size={4}>
                      <Typography.Text style={{ fontSize: 12 }}>夹角</Typography.Text>
                      <Select
                        size="small"
                        value={comb.angleDeg}
                        style={{ width: 104 }}
                        onChange={(v: number) => updateCombinerAngle(comb.id, v)}
                        options={CORNER_ANGLE_PRESETS.map((d) => ({
                          value: d,
                          label: `${d}° ${d === 180 ? '直线' : '转角'}`,
                        }))}
                      />
                    </Space>
                  </Tooltip>
                )}
                <Button size="small" danger onClick={() => { removeCombiner(comb.id); }}>删除</Button>
                <Button size="small" onClick={() => selectCombiner(null)}>关闭</Button>
              </div>
            );
          })()}
        </div>
        {/* 右侧属性面板：支持折叠隐藏到右侧（立体折叠条） */}
        {rightCollapsed ? (
          <div
            style={{
              width: 44,
              background: '#fff',
              borderLeft: '1px solid #e8e8e8',
              paddingTop: 14,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <Tooltip title="展开属性面板" placement="left">
              <button
                className="wdd-3d-tab"
                onClick={() => setRightCollapsed(false)}
                style={{ width: 30, height: 84, borderRadius: '10px 0 0 10px', fontSize: 15 }}
              >
                <LeftOutlined />
              </button>
            </Tooltip>
          </div>
        ) : (
          <StudioRightPanel
            onCollapse={() => setRightCollapsed(true)}
            focusShapeId={focusShapeId}
            externalModel={treeModel}
            tree={windowTree}
            onResizeDim={(markId, value) => treeCanvasRef.current?.applyDimEdit(markId, value)}
            onFocusShape={(id) => {
              setFocusShapeId(id);
              treeCanvasRef.current?.revealNode(id);
            }}
          />
        )}
      </div>
      {/* 底部居中工具栏：清除 / 保存 + 容器树构件事务概览 */}
      <BottomToolbar tree={windowTree} onSave={() => void handleBottomSave()} onClear={handleClearCanvas} />

      {/* CRM 保存方案：未选择客户时的守卫弹窗 */}
      <SaveSchemeModal
        open={saveCustomerOpen}
        onCancel={() => setSaveCustomerOpen(false)}
        onConfirm={(id) => void handleSaveCustomerConfirmed(id)}
      />

      {/* 配件：为当前选中宿主（外框/分格/拼樘）添加配件，展示与移除已有配件 */}
      <Modal
        open={fittingOpen}
        title={`配件 · ${fittingHostLabel}`}
        onCancel={() => setFittingOpen(false)}
        width={420}
        footer={[
          <Button key="cancel" onClick={() => setFittingOpen(false)}>
            关闭
          </Button>,
          <Button key="ok" type="primary" disabled={!fittingType} onClick={confirmFitting}>
            添加
          </Button>,
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={10}>
          {currentFittings.length > 0 && (
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>已有配件：</Typography.Text>
              {currentFittings.map((f, i) => (
                <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                  <span style={{ fontSize: 13 }}>{FITTING_LABEL[f.type] ?? f.type} × {f.count ?? 1}</span>
                  <Button size="small" type="text" danger onClick={() => removeFittingAt(i)}>
                    移除
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Space>
            <Typography.Text style={{ fontSize: 13, minWidth: 56 }}>配件类型</Typography.Text>
            <Select
              style={{ width: 220 }}
              placeholder="选择配件"
              value={fittingType ?? undefined}
              onChange={(v: FittingType) => setFittingType(v)}
              options={fittingOptions.map((d) => ({ value: d.id, label: d.label }))}
            />
          </Space>
          <Space>
            <Typography.Text style={{ fontSize: 13, minWidth: 56 }}>数量</Typography.Text>
            <InputNumber min={1} max={99} value={fittingCount} onChange={(v) => setFittingCount(v ?? 1)} style={{ width: 100 }} />
          </Space>
        </Space>
      </Modal>

      {/* 等分：把选中的未分割分格按 n 等分（竖直/水平） */}
      <Modal
        open={divideOpen}
        title="等分分格"
        onCancel={() => setDivideOpen(false)}
        width={360}
        footer={[
          <Button key="cancel" onClick={() => setDivideOpen(false)}>
            取消
          </Button>,
          <Button key="ok" type="primary" onClick={confirmDivide}>
            等分
          </Button>,
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {divideDir === 'diagonal' || divideDir === 'antiDiagonal'
              ? '斜梃只能二分为两个三角/五边形分格（等分后可继续拖中梃微调）'
              : `将选中的分格竖直/水平等分为 ${divideN} 份（等分后可继续拖中梃微调）`}
          </Typography.Text>
          <Space>
            <Typography.Text style={{ fontSize: 13, minWidth: 56 }}>方向</Typography.Text>
            <Select
              style={{ width: 160 }}
              value={divideDir}
              onChange={(v) => {
                setDivideDir(v);
                if (v === 'diagonal' || v === 'antiDiagonal') setDivideN(2);
              }}
              options={[
                { value: 'vertical', label: '竖直（左右分）' },
                { value: 'horizontal', label: '水平（上下分）' },
                { value: 'diagonal', label: '斜梃 ↘（对角分）' },
                { value: 'antiDiagonal', label: '斜梃 ↗（对角分）' },
              ]}
            />
          </Space>
          <Space>
            <Typography.Text style={{ fontSize: 13, minWidth: 56 }}>份数</Typography.Text>
            <InputNumber
              min={2}
              max={12}
              value={divideN}
              onChange={(v) => setDivideN(v ?? 2)}
              disabled={divideDir === 'diagonal' || divideDir === 'antiDiagonal'}
              style={{ width: 100 }}
            />
          </Space>
        </Space>
      </Modal>

      {/* 外框拖拽完成：选择拼接方向 / 夹角（或以次要动作重画整窗） */}
      <Modal
        open={!!pendingFrame}
        title="外框拼接方向"
        onCancel={() => setPendingFrame(null)}
        width={420}
        footer={[
          <Button
            key="replace"
            type="text"
            onClick={() => {
              const f = pendingFrame;
              if (f) replaceWholeWindow(f.w, f.h);
              setPendingFrame(null);
            }}
          >
            重画整窗（替换当前）
          </Button>,
          <Button key="cancel" onClick={() => setPendingFrame(null)}>
            取消
          </Button>,
          <Button key="ok" type="primary" disabled={!pendingDir} onClick={commitDrawnFrame}>
            确定拼接
          </Button>,
        ]}
      >
        {pendingFrame && (
          <Space direction="vertical" style={{ width: '100%' }} size={14}>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
              新外框 <Typography.Text strong>{pendingFrame.w}</Typography.Text> ×{' '}
              <Typography.Text strong>{pendingFrame.h}</Typography.Text> mm 将拼接到当前窗框（以画布上聚焦的窗框为锚）：
            </Typography.Paragraph>
            <Space>
              <Typography.Text style={{ fontSize: 13, minWidth: 64 }}>拼接方向</Typography.Text>
              <Select
                style={{ width: 180 }}
                value={pendingDir ?? undefined}
                placeholder="选择方向"
                onChange={(v) => setPendingDir(v)}
                options={[
                  { value: 'right', label: '右 · 并排' },
                  { value: 'left', label: '左 · 并排' },
                  { value: 'down', label: '下 · 叠放' },
                  { value: 'up', label: '上 · 叠放' },
                ]}
              />
            </Space>
            <Space>
              <Checkbox checked={withCombiner} onChange={(e) => setWithCombiner(e.target.checked)}>
                使用拼樘料连接
              </Checkbox>
            </Space>
            {(pendingDir === 'left' || pendingDir === 'right') && (
              <Space>
                <Typography.Text style={{ fontSize: 13, minWidth: 64 }}>拼接夹角</Typography.Text>
                <Select
                  style={{ width: 180 }}
                  value={pendingAngle}
                  onChange={(v) => setPendingAngle(v)}
                  options={CORNER_ANGLE_PRESETS.map((d) => ({
                    value: d,
                    label: `${d}° ${d === 180 ? '直线拼接' : '转角拼接'}`,
                  }))}
                />
              </Space>
            )}
          </Space>
        )}
      </Modal>

      {/* 系列/窗型自定义计算公式配置（保存后 BOM/报价/下料单实时联动） */}
      <FormulaConfigModal open={formulaOpen} onClose={() => setFormulaOpen(false)} />
    </div>
  );
}

/** 底部居中工具栏：清除 / 保存 + 容器树构件事务概览 */
function BottomToolbar({
  tree,
  onSave,
  onClear,
}: {
  tree: WindowTree | null;
  /** 底部「保存」回调（CRM 模式保存到客户 / 普通模式本地保存） */
  onSave?: () => void;
  /** 清空画布（保留窗洞尺寸） */
  onClear?: () => void;
}) {
  let muntins = 0;
  let placed = 0;
  if (tree?.root) {
    const walk = (t: WindowTree) => {
      const area = t.root;
      if (!area) return;
      const rec = (a: WindowTreeArea): void => {
        if (a.children) {
          muntins += 1;
          rec(a.children[0]);
          rec(a.children[2]);
        } else if (a.sash) {
          placed += 1;
        }
      };
      rec(area);
    };
    walk(tree);
  }

  return (
    <div
      style={{
        borderTop: '1px solid #e8e8e8',
        background: '#fff',
        padding: '8px 0',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <Space size={8}>
        <Tooltip title="清空画布（删除全部窗框、拼樘与构件，恢复空白）">
          <Button size="small" danger onClick={onClear}>
            清除
          </Button>
        </Tooltip>
        <Tooltip title="保存当前设计（Ctrl+S）">
          <Button size="small" type="primary" icon={<SaveOutlined />} onClick={onSave}>
            保存
          </Button>
        </Tooltip>
      </Space>
      {tree ? (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          外框 1 · 中梃 {muntins} · 已放置构件 {placed} · 提示：选中构件后在右栏键入尺寸，1/2/3 切工具，Ctrl+Z/Ctrl+Y 撤销恢复，Delete 删除，右键或中键拖拽平移
        </Typography.Text>
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          画布为空 · 点击左侧「外框」工具拖拽绘制
        </Typography.Text>
      )}
    </div>
  );
}

function FloatCard({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        bottom: 16,
        width: 340,
        maxHeight: '72%',
        overflow: 'auto',
        background: '#fff',
        borderRadius: 10,
        boxShadow: '0 6px 20px rgba(0,0,0,0.16)',
        border: '1px solid #e8e8e8',
        zIndex: 20,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid #f0f0f0',
        }}
      >
        <Typography.Text strong>{title}</Typography.Text>
        <button
          onClick={onClose}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#999', fontSize: 14 }}
        >
          ×
        </button>
      </div>
      <div style={{ padding: 12 }}>{children}</div>
    </div>
  );
}

function DrawingInfo({ modelOverride }: { modelOverride?: DesignModel | null }) {
  const library = useStore((s) => s.library);
  const model = modelOverride ?? projectDesignModel(useStore.getState());
  const seriesId = useStore(selectCurrentSeriesId);
  const series = library.series.find((s) => s.id === (model?.seriesId ?? seriesId)) ?? library.series[0];
  const componentCount = model?.components.length ?? 0;
  const mullionCount = model?.components.filter((c) => c.kind === 'mullion').length ?? 0;
  const frameCount = model?.components.filter((c) => c.kind === 'outerFrame').length ?? 0;
  const windowTypes = [...new Set(model?.components.map((c) => c.windowType).filter(Boolean) ?? [])].join(' / ') || '—';
  const rows: [string, string][] = [
    ['产品系列', series.name],
    ['窗型', windowTypes],
    ['洞口尺寸', model ? `${model.openingW} × ${model.openingH} mm` : '—'],
    ['外框数量', String(frameCount)],
    ['构件数量', String(componentCount)],
    ['中梃数量', String(mullionCount)],
    ['材质', `${series.cornerType}° 组角 / 断桥铝`],
    ['单位', 'mm（毫米）'],
  ];
  return (
    <div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
          <Typography.Text type="secondary">{k}</Typography.Text>
          <Typography.Text strong>{v}</Typography.Text>
        </div>
      ))}
      <Divider style={{ margin: '10px 0' }} />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>
        提示：使用左侧「选择」工具点击图形可编辑；「外框」「中梃」「平开扇」工具可在画布上直接搭建门窗构件。
      </Typography.Paragraph>
    </div>
  );
}
