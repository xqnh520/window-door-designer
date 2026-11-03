import Konva from 'konva';
import type { WindowTree, WindowTreeArea, WindowMuntin, WindowSashSpec, SashType, WindowAssembly, AssemblyLayout, UnitPlacement, MuntinSlope } from '@wdd/core';
import {
  collectSnapLines,
  clipByDiagonalBand,
  describeWindowTree,
  findArea,
  findMuntin,
  hostSnapLines,
  IDENTITY_PLACEMENT,
  invertPlacement,
  layoutAssembly,
  layoutTree,
  moveMuntin,
  resizeTreeEdge,
  snapTo,
  splitArea,
  type TreeEdge,
  sashWidthOf,
  muntinWidthOf,
  muntinSagittaOf,
  DEFAULT_MUNTIN_MM,
  sashHandlePlacement,
  specForSash,
  DEFAULT_INSTALL_GAP_MM,
  rotateDeg,
} from '@wdd/core';
import { placeNode, renderAssembly } from './render/window-assembly-render';
import { renderWindowTree } from './render/window-tree-render';
import { DIM_FRAME_GAP, renderDimensions } from './render/dimensions';
import { renderCombinerHighlight, renderTreeHighlight } from './render/highlight';
import type { CanvasAction } from '../store';
import type { Pt } from '@wdd/core';

export type { DimMark } from './render/dimensions';

/**
 * 容器树编辑控制器（R3/R5）：统一的门窗设计画布控制器。
 *
 * 交互（对齐第三方工具的"先外框 → 分割 → 放构件"流程）：
 * - select：点击节点选中高亮；拖拽中梃调位（分隔比例实时预览，mouseup 提交）；
 *           Delete 移除选中叶子的构件或（选中有分割的区域时）删除整段分割；
 *           点击空白取消选择。
 * - split：点击容器/叶子区域选中宿主（高亮）→ 在其内从按下点拖拽到释放点，
 *           按拖拽水平/垂直主导方向生成分割（自动创建中梃+双子区，比例随指针）。
 * - place：点击叶子区域 → 带类型直接放置（placeType），或回调 onPlaceRequest(areaId) 由 UI 选择。
 * - framing：空白处拖拽绘制外框矩形 → 回调 onFrameCreate(x,y,w,h)（外层重建/新建窗口）。
 *
 * Controller 只持有只读渲染快照；提交时通过 onAction 上抛结构化意图，
 * 由 store.dispatchCanvas 调用 core mutator 并替换装配体。
 *
 * 转角拼接（M2）空间分离：聚焦树与全部叠加层一律用**加工空间（展开态）**坐标构建，再经 placeNode
 * 套上该单元的显示变换（转角时旋转）；指针则先用 focusPoint() 逆旋转回展开态再喂给
 * split/muntin/edge-drag 等编辑逻辑。因此 angleDeg=180（恒等变换）时本文件行为与转角前完全一致。
 */

export type TreeEditorTool = 'select' | 'split' | 'place' | 'framing';

export interface TreeEditorOptions {
  /** UI 唯一业务写入口。 */
  onAction: (action: CanvasAction) => void;
  onSelect: (id: string | null) => void;
  onPlaceRequest: (areaId: string) => void;
  /** 外框绘制完成（world mm） */
  onFrameCreate: (x: number, y: number, w: number, h: number) => void;
  /** 点击尺寸标注文本：由 UI 弹输入后调用 applyDimEdit */
  onDimEdit?: (markId: string) => void;
  /** 点击只读上下文单元：切换聚焦（外框拼接） */
  onSelectUnit?: (unitId: string) => void;
  /** 点击拼樘料：选中（外框拼接） */
  onSelectCombiner?: (combinerId: string) => void;
  /** 视图变化（缩放/平移/容器尺寸）：上抛当前缩放倍率，供 UI 显示比例与控件禁用态 */
  onViewChange?: (scale: number) => void;
  /** 指针在聚焦单元加工空间内移动（null=离开画布）：供状态栏显示光标 mm 坐标 */
  onPointerMove?: (point: PtWorld | null) => void;
}

/** 默认视图原点：留出 40mm 边距给外侧尺寸标注 */
const VIEW_ORIGIN = { x: 40, y: 40 };
/** 缩放限幅：与滚轮一致，避免放大到像素级或缩成一点 */
const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const clampScale = (s: number): number => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));

const INSTALL_GAP = DEFAULT_INSTALL_GAP_MM;
const MIN_RATIO = 0.1;
/** 吸附阈值（屏幕 px，按缩放反算成 world mm） */
const SNAP_THRESHOLD_PX = 6;
/** 交互预览颜色；静态选择高亮由 render/highlight.ts 自主管理。 */
const HIGHLIGHT = '#1677ff';
/** 收集某区域自身 + 其全部子区域 id（children=[左区, 中梃, 右区]，仅递归两侧区域）。
 *  拖中梃时用它排除宿主移动子树，避免吸附参考线随中梃一起动而产生自锁/抖动。 */
function subtreeAreaIds(tree: WindowTree, rootId: string): Set<string> {
  const set = new Set<string>();
  const rec = (a: WindowTreeArea): void => {
    set.add(a.id);
    if (a.children) {
      rec(a.children[0]);
      rec(a.children[2]);
    }
  };
  const root = findArea(tree, rootId);
  if (root) rec(root);
  return set;
}

interface PtWorld {
  x: number;
  y: number;
}

interface NodeHit {
  id: string;
  kind: 'frame' | 'muntin' | 'area' | 'unit' | 'combiner';
  /** 命中外框某根料（渲染层 data-edge 标记） */
  edge?: TreeEdge;
  /** 命中点落在压线段上（仍归属其宿主玻璃 area，用于差异化高亮） */
  bead?: boolean;
}

export interface TreeEditorColors {
  frame?: string;
  glass?: string;
  sash?: string;
  screen?: string;
  panel?: string;
  inner?: string;
  bead?: string;
}

export class TreeEditorController {
  readonly stage: Konva.Stage;
  private readonly layers: { background: Konva.Layer; shape: Konva.Layer; guide: Konva.Layer };
  private readonly opts: TreeEditorOptions;
  /** 聚焦树；null = 空白画布（framing 拖拽仍然可绘制首个外框） */
  private tree: WindowTree | null;
  private drawW: number;
  private drawH: number;
  private colors: TreeEditorColors | undefined;
  /** 压线真实宽度（mm，来自系列 beadWidth）与拼接方式（来自设计属性），透传给渲染层 */
  private beadWidthMm: number | undefined;
  private beadJoint: 'miter' | 'butt' | undefined;

  private tool: TreeEditorTool = 'select';
  private placeType: SashType | null = null;
  private renderGroup: Konva.Group | null = null;
  private contextGroup: Konva.Group | null = null;
  private selectionHighlight: Konva.Group | null = null;
  private selectedId: string | null = null;
  /** 当前选中落在压线段上：高亮单独描压线环而非整格 */
  private selectedBead = false;

  // 外框拼接装配：聚焦单元走 this.tree（可编辑），其余单元 + 拼樘走 contextGroup（只读）
  private assembly: WindowAssembly | null = null;
  private focusedUnitId: string | null = null;
  private selectedCombinerId: string | null = null;
  private combinerHighlight: Konva.Group | null = null;
  /** 拖拽吸附参考线（guide 层虚线，mouseup 清除） */
  private snapGuide: Konva.Line | null = null;
  /** 装配布局缓存（加工空间 + 显示变换），render()/setAssembly 时刷新 */
  private assemblyLayout: AssemblyLayout | null = null;
  /** 聚焦单元叠加层容器：内部一律展开态坐标，整体套显示变换（转角时随腿旋转） */
  private overlayGroup: Konva.Group | null = null;

  // 平移 / 缩放
  private panning = false;
  private panStart: { pointer: Pt; pan: Pt } | null = null;
  private scale = 1;
  /** stage 平移偏移（屏幕 px）；applyTransform 的唯一来源，缩放时不再被重置回原点 */
  private view: Pt = { ...VIEW_ORIGIN };
  /** 容器级右键菜单拦截（右键已用作平移手势） */
  private suppressContextMenu: ((e: Event) => void) | null = null;

  // 分割流程
  private splitHost: { id: string; rect: { x: number; y: number; w: number; h: number }; lines: { v: number[]; h: number[] } } | null = null;
  private splitPreview: Konva.Shape | null = null;
  /** 本次分割的方向与比例（预览时定，提交时直接用，不再从预览矩形反推） */
  private splitDir: 'vertical' | 'horizontal' | MuntinSlope = 'vertical';
  private splitRatio = 0.5;
  /** 斜梃模式：非空即"下一次分割走斜向"（工具条切换，用完保持） */
  private splitSlope: MuntinSlope | null = null;

  // 外框绘制（framing）
  private frameStart: Pt | null = null;
  private framePreview: Konva.Rect | null = null;

  // 中梃拖拽
  private dragMuntin: { muntinId: string; hostId: string; rect: { x: number; y: number; w: number; h: number }; direction: WindowMuntin['direction']; lines: { v: number[]; h: number[] }; ratio?: number } | null = null;
  /** 中梃目标位置的幽灵几何；拖动阶段不修改 WindowTree。 */
  private muntinDragPreview: Konva.Shape | null = null;

  // 图形边拖拽（外框框料/分格，仅框料宽度内触发）
  private dragEdge: { id: string; edge: TreeEdge; newPos?: number } | null = null;
  /** 边缘拖动的 Konva 幽灵线；实际树只在 mouseup intent 后由 store/core 修改。 */
  private edgeDragPreview: Konva.Line | null = null;
  /** 外框「四根框料」选中语义：当前选中的边（根料高亮） */
  private selectedEdge: TreeEdge | null = null;
  /** 拖拽平移窗口（其余位置单击拖动=移动图形位置） */
  private dragWindow: {
    start: Pt;
    offsetX: number;
    offsetY: number;
    nextOffsetX: number;
    nextOffsetY: number;
    renderPosition: Pt;
    overlayPosition: Pt;
  } | null = null;
  /** 结构化意图模式下的把手幽灵状态；拖动期间不写入业务树 */
  private dragHandlePreview: { areaId: string; handle: NonNullable<WindowSashSpec['handle']> } | null = null;

  // 尺寸标注
  private dimLayer: Konva.Group | null = null;
  /** 标注可拖动：宽标注（顶部）与高标注（左侧）距边框的距离（mm），拖拽调整 */
  private dimGapW = DIM_FRAME_GAP;
  private dimGapH = DIM_FRAME_GAP;

  constructor(container: HTMLDivElement, tree: WindowTree | null, opts: TreeEditorOptions, drawW: number, drawH: number) {
    this.opts = opts;
    // Konva 的拖拽处理仍使用原位 mutator；控制器必须持有独立工作副本，
    // 不能让交互中的中间态穿透并修改 Zustand/assembly 的共享引用。
    this.tree = cloneEditableTree(tree);
    this.drawW = drawW;
    this.drawH = drawH;
    this.stage = new Konva.Stage({
      container,
      width: container.clientWidth,
      height: container.clientHeight,
    });
    this.layers = {
      background: new Konva.Layer(),
      shape: new Konva.Layer(),
      guide: new Konva.Layer(),
    };
    for (const l of Object.values(this.layers)) this.stage.add(l);

    // 基础缩放：把洞口世界尺寸映射到画布
    this.scale = this.fitScale();
    this.applyTransform();

    this.stage.on('wheel', this.onWheel);
    this.stage.on('mousedown', this.onMouseDown);
    this.stage.on('mousemove', this.onMouseMove);
    this.stage.on('mouseup', this.onMouseUp);
    this.stage.on('mouseleave', () => this.opts.onPointerMove?.(null));
    // 右键是平移手势，屏蔽浏览器原生菜单（否则平移一下就被系统菜单盖住）
    this.suppressContextMenu = (e: Event) => e.preventDefault();
    container.addEventListener('contextmenu', this.suppressContextMenu);
    // 把手：选中工具下直接拖动定位（可移动范围=扇料边框的长宽），实时夹紧并标注实际值
    this.stage.on('dragmove', (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      if (!this.tree || node.name() !== 'sashHandle' || this.tool !== 'select') return;
      const areaId = String(node.getAttr('data-handle-of') || '');
      const area = findArea(this.tree, areaId);
      if (!area?.sash) return;
      const box = layoutTree(this.tree, { installGap: INSTALL_GAP }).boxes.get(areaId);
      if (!box) return;
      const wp = this.focusPoint();
      const bar = sashWidthOf(this.tree);
      const hinge = area.sash.hingeSide ?? 'left';
      const vertical = hinge === 'top' || hinge === 'bottom';
      const anchorX = vertical ? box.x + box.w / 2 : hinge === 'right' ? box.x + bar / 2 : box.x + box.w - bar / 2;
      const next = { ...(area.sash.handle ?? {}), offsetMm: Math.round(wp.x - anchorX), fromBottomMm: Math.round(box.y + box.h - wp.y) };
      this.dragHandlePreview = { areaId, handle: next };
      const p = sashHandlePlacement(box.w, box.h, bar, next, hinge);
      if (p) {
        node.position({ x: p.cx, y: p.cy });
        // 把手组内的标注子节点（Container.find 未出现在 e.target 类型上，此处受限断言）
        const lbl = (node as unknown as Konva.Container).find('Text')[0] as Konva.Text | undefined;
        if (lbl) lbl.setAttr('text', p.label);
      }
      this.layers.shape.batchDraw();
    });
    this.stage.on('dragend', (e: Konva.KonvaEventObject<DragEvent>) => {
      if (e.target.name() !== 'sashHandle' || !this.tree) return;
      if (this.dragHandlePreview) {
        const preview = this.dragHandlePreview;
        this.dragHandlePreview = null;
        this.emitAction({ type: 'patch-sash', areaId: preview.areaId, patch: { handle: preview.handle } });
        return;
      }
      this.render();
    });
    window.addEventListener('keydown', this.onKeyDown);

    this.render();
  }

  // ── 变换 ────────────────────────────────────────────────

  /** 容器尺寸变化：更新 stage 并按初始世界尺寸重算缩放 */
  resize(w: number, h: number): void {
    this.stage.size({ width: w, height: h });
    this.scale = this.fitScale();
    this.view = { ...VIEW_ORIGIN };
    this.applyTransform();
    this.render();
  }

  /** 恰好让整幅绘制区（含标注边距）落入视口的缩放倍率 */
  private fitScale(): number {
    const el = this.stage.container();
    const pad = 60;
    const s = Math.min((el.clientWidth - pad) / this.drawW, (el.clientHeight - pad) / this.drawH);
    return Number.isFinite(s) && s > 0 ? clampScale(s) : 1;
  }

  private applyTransform(): void {
    const s = this.scale;
    this.stage.scale({ x: s, y: s });
    this.stage.position({ x: this.view.x, y: this.view.y });
    this.stage.batchDraw();
    this.opts.onViewChange?.(s);
  }

  /** 当前缩放倍率（屏幕 px / world mm） */
  getScale(): number {
    return this.scale;
  }

  /** 适应窗口：整幅窗型回到视口中央，平移量复位 */
  fitView(): void {
    this.scale = this.fitScale();
    this.view = { ...VIEW_ORIGIN };
    this.applyTransform();
    this.render();
  }

  /** 设定缩放倍率（限幅）；anchorScreen 为屏幕坐标，默认围绕视口中心 */
  setScale(next: number, anchorScreen?: Pt): void {
    const target = clampScale(next);
    if (Math.abs(target - this.scale) < 1e-9) return;
    const a = anchorScreen ?? { x: this.stage.width() / 2, y: this.stage.height() / 2 };
    const world = { x: (a.x - this.view.x) / this.scale, y: (a.y - this.view.y) / this.scale };
    this.scale = target;
    this.view = { x: a.x - world.x * target, y: a.y - world.y * target };
    this.applyTransform();
    this.render();
  }

  /** 按因子缩放（限幅）；anchorScreen 处世界坐标保持不动 */
  zoomBy(factor: number, anchorScreen?: Pt): void {
    this.setScale(this.scale * factor, anchorScreen);
  }

  /** 指针屏幕坐标（与 this.view / stage.position 同为「相对容器」基准）；无指针位置时退回视口中心 */
  private pointerScreen(): Pt {
    return this.stage.getPointerPosition() ?? { x: this.stage.width() / 2, y: this.stage.height() / 2 };
  }

  worldPoint(): { x: number; y: number } {
    const p = this.stage.getPointerPosition() ?? { x: 0, y: 0 };
    return { x: (p.x - this.view.x) / this.scale, y: (p.y - this.view.y) / this.scale };
  }

  /** 世界坐标 → 屏幕坐标 */
  toScreen(p: { x: number; y: number }): { x: number; y: number } {
    return { x: p.x * this.scale + this.view.x, y: p.y * this.scale + this.view.y };
  }

  /** 聚焦单元的显示变换；未进入装配 / 全 180° 链时为恒等（⇒ 编辑器行为与转角前一致） */
  private focusedPlacement(): UnitPlacement {
    if (!this.assemblyLayout || !this.focusedUnitId) return IDENTITY_PLACEMENT;
    return this.assemblyLayout.placement.get(this.focusedUnitId) ?? IDENTITY_PLACEMENT;
  }

  /** placeNode 的参考点（取展开态框左上角；结果与该点取值无关，仅为数值条件） */
  private focusedAnchor(): Pt {
    const f = this.assemblyLayout && this.focusedUnitId
      ? this.assemblyLayout.units.get(this.focusedUnitId)?.frame
      : undefined;
    return { x: f?.x ?? 0, y: f?.y ?? 0 };
  }

  /** 聚焦腿是否被转角旋转（尺寸标注拖拽等仅轴对齐时才开放） */
  private isRotated(): boolean {
    const p = this.focusedPlacement();
    return p.rotationDeg !== 0;
  }

  /** 聚焦单元叠加层容器（高亮环 / 尺寸 / 分割与外框预览），随显示变换整体旋转 */
  private overlay(): Konva.Group {
    if (!this.overlayGroup) {
      this.overlayGroup = new Konva.Group({ listening: true });
      this.layers.guide.add(this.overlayGroup);
    }
    placeNode(this.overlayGroup, this.focusedPlacement(), this.focusedAnchor());
    return this.overlayGroup;
  }

  /** 屏幕指针 → 聚焦单元的**加工空间**坐标（恒等变换时 == worldPoint） */
  focusPoint(): { x: number; y: number } {
    return invertPlacement(this.focusedPlacement(), this.worldPoint());
  }

  private onWheel = (e: Konva.KonvaEventObject<WheelEvent>): void => {
    e.evt.preventDefault();
    this.zoomBy(e.evt.deltaY < 0 ? 1.1 : 0.9, this.pointerScreen());
  };

  // ── 树渲染与命中 ─────────────────────────────────────────

  setTree(tree: WindowTree | null): void {
    this.tree = cloneEditableTree(tree);
    this.render();
  }

  /**
   * 设置装配上下文（外框拼接）：聚焦单元由 setTree 单独提供（this.tree），
   * 这里只登记整体装配用于绘制只读上下文（其余单元 + 拼樘）与计算世界尺寸。
   */
  setAssembly(a: WindowAssembly | null, focusedUnitId: string | null): void {
    this.assembly = a;
    this.focusedUnitId = focusedUnitId;
    if (a && a.units.length) {
      const bb = this.computeLayout()?.displayBbox;
      if (!bb) return this.render();
      const nextW = Math.max(1, bb.x + bb.w + INSTALL_GAP) + 200;
      const nextH = Math.max(1, bb.y + bb.h + INSTALL_GAP) + 200;
      if (Math.abs(nextW - this.drawW) > 0.5 || Math.abs(nextH - this.drawH) > 0.5) {
        this.drawW = nextW;
        this.drawH = nextH;
        // 世界尺寸变了（加/减单元）→ 重新适应视口；否则保留用户当前的缩放与平移
        this.scale = this.fitScale();
        this.view = { ...VIEW_ORIGIN };
        this.applyTransform();
      }
    }
    this.render();
  }

  /** 刷新装配布局缓存（加工空间 + 转角显示变换） */
  private computeLayout(): AssemblyLayout | null {
    this.assemblyLayout = this.assembly ? layoutAssembly(this.assembly, { installGap: INSTALL_GAP }) : null;
    return this.assemblyLayout;
  }

  /** 选中拼樘（高亮环，null 取消） */
  setSelectedCombiner(id: string | null): void {
    this.selectedCombinerId = id;
    this.render();
  }

  setColors(colors: TreeEditorColors | undefined): void {
    this.colors = colors;
    this.render();
  }

  /** 压线绘制配置：真实宽度（mm，系列 beadWidth）+ 拼接方式（斜/直连接），变化时重绘 */
  setBeadConfig(cfg: { widthMm?: number; joint?: 'miter' | 'butt' }): void {
    this.beadWidthMm = cfg.widthMm;
    this.beadJoint = cfg.joint;
    this.render();
  }

  setTool(tool: TreeEditorTool, placeType?: SashType): void {
    this.tool = tool;
    this.placeType = placeType ?? null;
    this.cancelSplit();
    this.cancelMuntinDrag();
    this.cancelFrame();
    this.cancelEdgeDrag();
    this.setCursor();
  }

  setSelection(id: string | null, opts?: { bead?: boolean }): void {
    this.selectedId = id;
    this.selectedBead = !!opts?.bead;
    if (!id) this.selectedEdge = null;
    this.renderHighlight();
    this.opts.onSelect?.(id);
  }

  /** 外部入口（校验列表 / 构件树）驱动选中：高亮 + 尺寸标注一并刷新 */
  revealNode(id: string | null): void {
    if (!this.tree || !id) return;
    this.setSelection(id);
    this.render();
  }

  /** 设置选中的外框料（根料高亮） */
  private setSelectedEdge(edge: TreeEdge | null): void {
    this.selectedEdge = edge;
    this.renderHighlight();
  }

  private setCursor(): void {
    this.stage.container().style.cursor =
      this.tool === 'select' ? 'default' : this.tool === 'split' ? 'crosshair' : this.tool === 'framing' ? 'crosshair' : 'copy';
  }

  /** 画布导出 PNG（供图纸/PDF 使用，与旧画布 exportImage 语义一致） */
  exportImage(pixelRatio = 2): string | null {
    try {
      return this.stage.toDataURL({ pixelRatio, mimeType: 'image/png' });
    } catch {
      return null;
    }
  }

  private render(): void {
    this.computeLayout();
    this.renderGroup?.destroy();
    this.renderGroup = null;
    this.contextGroup?.destroy();
    this.contextGroup = null;
    this.overlayGroup?.destroy();
    this.overlayGroup = null;
    this.selectionHighlight?.destroy();
    this.selectionHighlight = null;
    this.combinerHighlight?.destroy();
    this.combinerHighlight = null;
    this.clearSnapGuide();
    this.dimLayer?.destroy();
    this.dimLayer = null;

    // 空白画布（无树且无装配）：舞台保持空白可交互，framing 拖拽仍可绘制首个外框
    const tree = this.tree;
    if (!tree) {
      this.nodeById.clear();
      this.layers.shape.batchDraw();
      this.layers.guide.batchDraw();
      return;
    }

    // 只读上下文：其余单元 + 拼樘（聚焦单元由 this.tree 以可编辑方式绘制）
    // 转角显示变换已在 renderAssembly 内部逐单元/逐拼樘套好
    if (this.assembly && this.focusedUnitId && this.assembly.units.length > 1) {
      const ctx = renderAssembly(this.assembly, {
        installGap: INSTALL_GAP,
        colors: this.colors,
        skipUnitId: this.focusedUnitId,
        interactiveUnits: false,
      });
      this.contextGroup = ctx.group;
      this.layers.shape.add(ctx.group);
    }

    const { group, nodes } = renderWindowTree(tree, {
      installGap: INSTALL_GAP,
      colors: this.colors,
      beadWidthMm: this.beadWidthMm,
      beadJoint: this.beadJoint,
    });
    this.renderGroup = group;
    this.layers.shape.add(group);
    placeNode(group, this.focusedPlacement(), this.focusedAnchor());
    this.overlay(); // 先建叠加层容器，供下面三个 render* 填充

    // 节点元数据归档（供命中映射）
    this.nodeById = nodes;
    this.renderHighlight();
    this.renderCombinerHighlight();
    this.renderDimensions();
    this.layers.shape.batchDraw();
    this.layers.guide.batchDraw();
  }

  // ── 尺寸标注（CAD 制图风格，可拖动调距）────────────────────

  private renderDimensions(): void {
    if (!this.tree) return;
    this.dimLayer?.destroy();
    const rendered = renderDimensions({
      tree: this.tree,
      assembly: this.assembly,
      assemblyLayout: this.assemblyLayout,
      selectedId: this.selectedId,
      scale: this.scale,
      gaps: { width: this.dimGapW, height: this.dimGapH },
      rotated: this.isRotated(),
      installGap: INSTALL_GAP,
      onDimEdit: this.opts.onDimEdit,
      onGapsChange: (gaps) => {
        this.dimGapW = gaps.width;
        this.dimGapH = gaps.height;
        this.render();
      },
    });
    this.dimLayer = rendered.group;
    this.overlay().add(rendered.group);
  }

  private emitAction(action: CanvasAction): void {
    this.opts.onAction(action);
  }

  /** 标注改值：外框总宽高 / 分格宽高（自动选择可调边界） */
  applyDimEdit(markId: string, value: number): void {
    if (!this.tree) return;
    const v = Math.max(60, Math.round(value));
    this.emitAction({ type: 'resize-dim', markId, value: v });
  }

  /** 标注当前值（mm）：外框宽/高、分格宽/高 */
  dimValue(markId: string): number | null {
    if (!this.tree) return null;
    const layout = layoutTree(this.tree, { installGap: INSTALL_GAP });
    if (markId === 'frame-w') return Math.round(layout.frame.w);
    if (markId === 'frame-h') return Math.round(layout.frame.h);
    const areaId = markId.endsWith('-w') || markId.endsWith('-h') ? markId.slice(0, -2) : null;
    if (!areaId) return null;
    const box = layout.boxes.get(areaId);
    if (!box) return null;
    return Math.round(markId.endsWith('-w') ? box.w : box.h);
  }

  private nodeById = new Map<string, Konva.Group>();

  /** 命中检测：聚焦树节点优先（frame/muntin/area + data-edge）；否则路由只读单元/拼樘 */
  private hitNode(screen: { x: number; y: number }): NodeHit | null {
    // topmost 用像素级命中（尊重祖先裁剪，异形外框不会命中到轮廓外）。
    // 但尺寸标注 Text 是 listening:true 且字号按 1/scale 补偿，缩小视图时其世界命中盒暴涨，
    // 会把下方构件整片盖住 → topmost 走不通时穿透该点的几何命中列表继续找带 name 的祖先。
    const namedOf = (start: Konva.Node | null): { node: Konva.Node; kind: 'frame' | 'muntin' | 'area'; edge?: TreeEdge; bead?: boolean } | null => {
      let n: Konva.Node | null = start;
      let edge: TreeEdge | undefined;
      let bead = false;
      while (n && n !== this.stage) {
        const edgeAttr = n.getAttr('data-edge');
        if (edgeAttr) edge = edgeAttr as TreeEdge;
        if (n.name() === 'bead') bead = true;
        const name = n.name();
        if (name === 'frame' || name === 'muntin' || name === 'area') {
          return { node: n, kind: name, edge, bead };
        }
        n = n.getParent();
      }
      return null;
    };

    const top = this.stage.getIntersection(screen);
    const first = namedOf(top);
    if (first) return { id: first.node.id(), kind: first.kind, edge: first.edge, bead: first.bead };

    // 几何命中顺序不保证 topmost 优先，且外框那枚覆盖整个洞口的透明命中盒会抢在前面
    // → 取命中盒面积最小的具名候选，等价于「最内层、最具体」的那个图形。
    let best: { node: Konva.Node; kind: 'frame' | 'muntin' | 'area'; edge?: TreeEdge; bead?: boolean; area: number } | null = null;
    let unit: string | undefined;
    let combiner: string | undefined;
    for (const target of this.stage.getAllIntersections(screen)) {
      if (target === top) continue;
      const named = namedOf(target);
      if (named) {
        const r = named.node.getClientRect({ relativeTo: this.stage });
        const area = r.width * r.height;
        if (!best || area < best.area) best = { ...named, area };
        continue;
      }
      let n: Konva.Node | null = target;
      while (n && n !== this.stage) {
        if (!combiner) combiner = n.getAttr('data-combiner') as string | undefined;
        if (!unit) unit = n.getAttr('data-unit') as string | undefined;
        n = n.getParent();
      }
    }
    if (best) return { id: best.node.id(), kind: best.kind, edge: best.edge, bead: best.bead };
    if (combiner) return { id: combiner, kind: 'combiner' };
    if (unit) return { id: unit, kind: 'unit' };
    return null;
  }

  // ── 选中高亮 ─────────────────────────────────────────────

  /** 拼樘/转角料选中高亮环（展开态坐标 + 上游腿显示变换，位于 guide 层） */
  private renderCombinerHighlight(): void {
    this.combinerHighlight?.destroy();
    this.combinerHighlight = renderCombinerHighlight(this.selectedCombinerId, this.assemblyLayout, this.scale);
    if (this.combinerHighlight) this.layers.guide.add(this.combinerHighlight);
  }

  private renderHighlight(): void {
    this.selectionHighlight?.destroy();
    this.selectionHighlight = null;
    if (!this.tree) return;
    this.selectionHighlight = renderTreeHighlight({
      tree: this.tree,
      selectedId: this.selectedId,
      selectedEdge: this.selectedEdge,
      selectedBead: this.selectedBead,
      selectedNodeExists: !!this.selectedId && this.nodeById.has(this.selectedId),
      scale: this.scale,
      beadWidthMm: this.beadWidthMm,
      installGap: INSTALL_GAP,
    });
    if (this.selectionHighlight) this.overlay().add(this.selectionHighlight);
    this.layers.guide.batchDraw();
  }

  // ── 鼠标事件 ─────────────────────────────────────────────

  private onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    if (e.evt.button === 1 || e.evt.button === 2 || (e.evt.ctrlKey || e.evt.metaKey)) {
      this.panning = true;
      this.panStart = { pointer: { x: e.evt.clientX, y: e.evt.clientY }, pan: { x: this.stage.x(), y: this.stage.y() } };
      return;
    }
    const world = this.focusPoint();

    // 空白画布（无树）：仅允许外框工具拖拽绘制首个外框；其余工具无效
    if (!this.tree) {
      if (this.tool === 'framing') {
        this.frameStart = world;
        this.framePreview?.destroy();
        this.framePreview = null;
      }
      return;
    }

    if (this.tool === 'framing') {
      // 空白处拖拽绘制外框（也可覆盖重画——重设洞口尺寸）
      this.frameStart = world;
      this.framePreview?.destroy();
      this.framePreview = null;
      return;
    }

    const hit = this.hitNode({ x: e.evt.clientX - this.stage.container().getBoundingClientRect().left, y: e.evt.clientY - this.stage.container().getBoundingClientRect().top });

    // 外框拼接：select 工具下点击只读单元切换聚焦、点击拼樘选中
    if (this.tool === 'select' && hit) {
      if (hit.kind === 'unit') {
        this.opts.onSelectUnit?.(hit.id);
        return;
      }
      if (hit.kind === 'combiner') {
        this.opts.onSelectCombiner?.(hit.id);
        return;
      }
    }

    if (this.tool === 'split') {
      if (hit?.kind === 'area') {
        this.beginSplit(hit.id);
      }
      return;
    }
    if (this.tool === 'place') {
      if (hit?.kind === 'area') {
        if (this.placeType) {
          this.placeOn(hit.id);
        } else {
          this.opts.onPlaceRequest(hit.id);
        }
      }
      return;
    }
    // select：框料宽度内=单边调尺寸；其余位置（叶/内腔/空白）=平移窗口
    if (hit) {
      this.setSelection(hit.id, { bead: hit.bead });
      if (hit.kind === 'muntin') {
        this.setSelectedEdge(null);
        this.dragWindow = null;
        const found = findMuntin(this.tree, hit.id);
        const layout = layoutTree(this.tree, { installGap: INSTALL_GAP });
        const hostBox = found ? layout.boxes.get(found.area.id) : undefined;
        if (found && hostBox) {
          this.dragMuntin = {
            muntinId: hit.id,
            hostId: found.area.id,
            rect: hostBox,
            direction: found.muntin.direction,
            // drag start 冻结参考线并排除宿主移动子树，整段拖拽中保持稳定，避免吸到自己
            lines: this.computeSnapLines(found.area.id),
          };
          this.dragEdge = null;
        }
      } else if (hit.kind === 'frame' && hit.edge) {
        // 命中某根框料（渲染层独立图形携带 data-edge）→ 选中并直接拖该料调尺寸
        this.setSelectedEdge(hit.edge);
        this.dragEdge = { id: 'frame', edge: hit.edge };
        this.dragWindow = null;
      } else {
        // 其余位置：拖动 = 移动窗口（offset）
        this.setSelectedEdge(null);
        this.dragEdge = null;
        this.beginWindowDrag(world);
      }
    } else {
      this.setSelection(null);
      this.setSelectedEdge(null);
      this.dragEdge = null;
      this.beginWindowDrag(world);
    }
    void world;
  };

  private onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    if (this.panning && this.panStart) {
      const dx = e.evt.clientX - this.panStart.pointer.x;
      const dy = e.evt.clientY - this.panStart.pointer.y;
      this.view = { x: this.panStart.pan.x + dx, y: this.panStart.pan.y + dy };
      this.applyTransform();
      return;
    }
    const world = this.focusPoint();
    this.opts.onPointerMove?.(world);
    // 空白画布：仅外框拖拽预览
    if (!this.tree) {
      if (this.tool === 'framing' && this.frameStart) this.updateFramePreview(world);
      return;
    }
    if (this.tool === 'split' && this.splitHost) {
      this.updateSplitPreview(world);
      return;
    }
    if (this.tool === 'framing' && this.frameStart) {
      this.updateFramePreview(world);
      return;
    }
    if (this.dragMuntin) {
      this.updateMuntinDrag(world);
      return;
    }
    if (this.dragEdge) {
      this.updateEdgeDrag(world);
      return;
    }
    if (this.dragWindow) {
      // 预览只移动 Konva 节点；业务树保持不变，mouseup 再提交一次 translate intent。
      const dx = world.x - this.dragWindow.start.x;
      const dy = world.y - this.dragWindow.start.y;
      this.dragWindow.nextOffsetX = Math.round((this.dragWindow.offsetX + dx) * 10) / 10;
      this.dragWindow.nextOffsetY = Math.round((this.dragWindow.offsetY + dy) * 10) / 10;
      const displayDelta = rotateDeg({ x: dx, y: dy }, this.focusedPlacement().rotationDeg);
      this.renderGroup?.position({
        x: this.dragWindow.renderPosition.x + displayDelta.x,
        y: this.dragWindow.renderPosition.y + displayDelta.y,
      });
      this.overlayGroup?.position({
        x: this.dragWindow.overlayPosition.x + displayDelta.x,
        y: this.dragWindow.overlayPosition.y + displayDelta.y,
      });
      this.layers.shape.batchDraw();
      this.layers.guide.batchDraw();
    }
  };

  private onMouseUp = (): void => {
    if (this.panning) {
      this.panning = false;
      this.panStart = null;
      return;
    }
    if (this.tool === 'split' && this.splitHost) {
      this.commitSplit();
      return;
    }
    if (this.tool === 'framing' && this.frameStart) {
      this.commitFrame();
      return;
    }
    if (this.dragWindow && this.tree) {
      const d = this.dragWindow;
      this.dragWindow = null;
      this.emitAction({ type: 'translate', offsetX: d.nextOffsetX, offsetY: d.nextOffsetY });
      return;
    }
    if (this.dragEdge && this.tree) {
      const d = this.dragEdge;
      this.cancelEdgeDrag();
      if (d.newPos != null) this.emitAction({ type: 'resize-edge', nodeId: d.id, edge: d.edge, newPos: d.newPos });
      return;
    }
    if (this.dragMuntin && this.tree) {
      const d = this.dragMuntin;
      if (d.ratio != null) this.emitAction({ type: 'move-muntin', muntinId: d.muntinId, newRatio: d.ratio });
      this.cancelMuntinDrag();
    }
  };

  // ── 图形边拖拽（外框/分格四边调尺寸）──────────────────────

  /** 记录渲染节点起点；拖动过程中不修改 WindowTree。 */
  private beginWindowDrag(world: Pt): void {
    if (!this.tree) return;
    const renderPosition = this.renderGroup?.position() ?? { x: 0, y: 0 };
    const overlayPosition = this.overlayGroup?.position() ?? { x: 0, y: 0 };
    const offsetX = this.tree.offsetX ?? 0;
    const offsetY = this.tree.offsetY ?? 0;
    this.dragWindow = {
      start: world,
      offsetX,
      offsetY,
      nextOffsetX: offsetX,
      nextOffsetY: offsetY,
      renderPosition: { ...renderPosition },
      overlayPosition: { ...overlayPosition },
    };
  }

  private updateEdgeDrag(world: Pt): void {
    const d = this.dragEdge!;
    if (!this.tree) return;
    const pos = d.edge === 'left' || d.edge === 'right' ? world.x : world.y;
    // 用一次性候选副本执行 core 约束/钳制；只读取结果画幽灵线，不把候选树设为 controller 状态。
    const candidate = cloneEditableTree(this.tree);
    if (!candidate || !resizeTreeEdge(candidate, d.id, d.edge, pos, { installGap: INSTALL_GAP })) return;
    d.newPos = pos;
    const layout = layoutTree(candidate, { installGap: INSTALL_GAP });
    const box = d.id === 'frame' ? layout.frame : layout.boxes.get(d.id);
    if (!box) return;
    this.edgeDragPreview?.destroy();
    const vertical = d.edge === 'left' || d.edge === 'right';
    const edgePos = d.edge === 'left' ? box.x : d.edge === 'right' ? box.x + box.w : d.edge === 'top' ? box.y : box.y + box.h;
    this.edgeDragPreview = new Konva.Line({
      points: vertical ? [edgePos, box.y, edgePos, box.y + box.h] : [box.x, edgePos, box.x + box.w, edgePos],
      stroke: HIGHLIGHT,
      strokeWidth: 2 / this.scale,
      dash: [8 / this.scale, 5 / this.scale],
      listening: false,
    });
    this.overlay().add(this.edgeDragPreview);
    this.layers.guide.batchDraw();
  }

  private cancelEdgeDrag(): void {
    this.dragEdge = null;
    this.edgeDragPreview?.destroy();
    this.edgeDragPreview = null;
    this.layers.guide.batchDraw();
  }

  // ── 外框绘制（framing）────────────────────────────────────

  private updateFramePreview(world: Pt): void {
    this.framePreview?.destroy();
    this.framePreview = null;
    const s = this.frameStart!;
    const x = Math.min(s.x, world.x);
    const y = Math.min(s.y, world.y);
    const w = Math.abs(world.x - s.x);
    const h = Math.abs(world.y - s.y);
    if (w < 60 || h < 60) return;
    this.framePreview = new Konva.Rect({
      x,
      y,
      width: w,
      height: h,
      fill: 'rgba(22,119,255,0.08)',
      stroke: HIGHLIGHT,
      strokeWidth: 1.5 / this.scale,
      dash: [8, 6],
      listening: false,
    });
    this.overlay().add(this.framePreview);
    this.layers.guide.batchDraw();
  }

  private commitFrame(): void {
    const s = this.frameStart;
    this.cancelFrame();
    if (!s) return;
    const end = this.focusPoint();
    const x = Math.min(s.x, end.x);
    const y = Math.min(s.y, end.y);
    const w = Math.abs(end.x - s.x);
    const h = Math.abs(end.y - s.y);
    if (w >= 60 && h >= 60) {
      this.opts.onFrameCreate(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    }
  }

  private cancelFrame(): void {
    this.frameStart = null;
    this.framePreview?.destroy();
    this.framePreview = null;
    this.layers.guide.batchDraw();
  }

  // ── 直接放置（带类型）─────────────────────────────────────

  private placeOn(areaId: string): void {
    if (!this.tree) return;
    const area = findArea(this.tree, areaId);
    if (!area || area.children || !this.placeType) return;
    const spec = specForSash(this.placeType);
    this.emitAction({ type: 'set-sash', areaId, spec });
    this.setSelection(areaId);
  }

  // ── 分割 ─────────────────────────────────────────────────

  private beginSplit(areaId: string): void {
    // 分割拖拽期间树不变（仅预览），参考线在 beginSplit 冻结即可；宿主是叶子，无需排除子树
    this.splitHost = { id: areaId, rect: this.hostRectOf(areaId), lines: this.computeSnapLines() };
    this.splitPreview?.destroy();
    this.splitPreview = null;
    this.setSelection(areaId);
  }

  private hostRectOf(areaId: string): { x: number; y: number; w: number; h: number } {
    if (!this.tree) return { x: 0, y: 0, w: 1, h: 1 };
    const layout = layoutTree(this.tree, { installGap: INSTALL_GAP });
    return layout.boxes.get(areaId) ?? { x: 0, y: 0, w: 1, h: 1 };
  }

  /** 斜梃模式开关：非空即"下一次分割沿该对角线族生成斜梃" */
  setSplitSlope(slope: MuntinSlope | null): void {
    this.splitSlope = slope;
  }

  private updateSplitPreview(world: PtWorld): void {
    const host = this.splitHost!;
    const rect = host.rect;
    this.splitPreview?.destroy();
    this.splitPreview = null;
    this.clearSnapGuide();
    const px = Math.max(0, Math.min(1, (world.x - rect.x) / Math.max(rect.w, 1)));
    const py = Math.max(0, Math.min(1, (world.y - rect.y) / Math.max(rect.h, 1)));
    const th = this.muntinMm();

    if (this.splitSlope) {
      // 与 clipByDiagonalBand 同一约定：f = v − u（↘）或 v + u − 1（↗），ratio = (1 − f) / 2
      const f = this.splitSlope === 'diagonal' ? py - px : py + px - 1;
      const ratio = (1 - f) / 2;
      if (ratio < MIN_RATIO || ratio > 1 - MIN_RATIO) return;
      const cut = clipByDiagonalBand(
        [
          { x: rect.x, y: rect.y },
          { x: rect.x + rect.w, y: rect.y },
          { x: rect.x + rect.w, y: rect.y + rect.h },
          { x: rect.x, y: rect.y + rect.h },
        ],
        this.splitSlope,
        ratio,
        th,
      );
      if (!cut) return;
      this.splitDir = this.splitSlope;
      this.splitRatio = ratio;
      this.splitPreview = new Konva.Line({
        points: cut.muntin.flatMap((p) => [p.x, p.y]),
        closed: true,
        fill: 'rgba(22,119,255,0.25)',
        stroke: HIGHLIGHT,
        strokeWidth: 1 / this.scale,
        dash: [6, 4],
        listening: false,
      });
      this.overlay().add(this.splitPreview);
      this.layers.guide.batchDraw();
      return;
    }

    // 方向：指针相对宿主起点的位移主导轴；无位移时按比例位置猜测
    const nearLeft = px < 0.15;
    const nearRight = px > 0.85;
    const vertical = nearLeft || nearRight || py < px;
    let ratio = vertical ? px : py;
    // 吸附：宿主均分线(k=2..6) + 落在宿主区间内的框/邻接元素边·中线（beginSplit 冻结）
    const origin = vertical ? rect.x : rect.y;
    const span = vertical ? rect.w : rect.h;
    const snapped = snapTo(
      origin + ratio * span,
      hostSnapLines(origin, span, vertical ? host.lines.v : host.lines.h),
      SNAP_THRESHOLD_PX / this.scale,
    );
    if (snapped != null) ratio = (snapped - origin) / span;
    if (ratio < MIN_RATIO || ratio > 1 - MIN_RATIO) return;
    this.splitDir = vertical ? 'vertical' : 'horizontal';
    this.splitRatio = ratio;
    this.splitPreview = new Konva.Rect({
      x: vertical ? rect.x + rect.w * ratio - th / 2 : rect.x,
      y: vertical ? rect.y : rect.y + rect.h * ratio - th / 2,
      width: vertical ? th : rect.w,
      height: vertical ? rect.h : th,
      fill: 'rgba(22,119,255,0.25)',
      stroke: HIGHLIGHT,
      strokeWidth: 1 / this.scale,
      dash: [6, 4],
      listening: false,
    });
    this.overlay().add(this.splitPreview);
    // 命中吸附时画蓝色参考线作为「已吸附」视觉反馈（与拖中梃一致）
    if (snapped != null) this.drawSnapGuide(vertical, snapped, rect);
    this.layers.guide.batchDraw();
  }

  private commitSplit(): void {
    const host = this.splitHost;
    if (!host || !this.tree || !this.splitPreview) {
      this.cancelSplit();
      return;
    }
    const layout = layoutTree(this.tree, { installGap: INSTALL_GAP });
    const hostBox = layout.boxes.get(host.id);
    if (hostBox) {
      const th = this.muntinMm();
      const clamped = Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, this.splitRatio));
      // 斜梃的弧高由 splitArea 内部归零；父区实际尺寸用于"切不动就拒绝"
      const candidate = cloneEditableTree(this.tree);
      if (candidate && splitArea(candidate, host.id, this.splitDir, clamped, th, muntinSagittaOf(candidate), { w: hostBox.w, h: hostBox.h })) {
        this.emitAction({ type: 'split', areaId: host.id, direction: this.splitDir, ratio: clamped });
      }
    }
    this.cancelSplit();
  }

  /** 中梃料厚（mm）：跟随整窗配置（缺省 40，实测直梃 40 / 弧梃 50 属分档） */
  private muntinMm(): number {
    return this.tree ? muntinWidthOf(this.tree) : DEFAULT_MUNTIN_MM;
  }

  private cancelSplit(): void {
    this.splitHost = null;
    this.splitPreview?.destroy();
    this.splitPreview = null;
    this.clearSnapGuide();
    this.layers.guide.batchDraw();
  }

  // ── 中梃拖拽调位 ─────────────────────────────────────────

  private updateMuntinDrag(world: PtWorld): void {
    const d = this.dragMuntin!;
    if (!this.tree) return;
    const sloped = d.direction === 'diagonal' || d.direction === 'antiDiagonal';
    if (sloped) {
      // 斜带：把指针投影到对角线族偏移上；轴对齐吸附线与参考线对它无意义
      const u = (world.x - d.rect.x) / Math.max(1, d.rect.w);
      const v = (world.y - d.rect.y) / Math.max(1, d.rect.h);
      const f = d.direction === 'diagonal' ? v - u : v + u - 1;
      const clamped = Math.max(0.08, Math.min(0.92, (1 - f) / 2));
      this.updateMuntinPreview(clamped);
      this.clearSnapGuide();
      return;
    }
    const vertical = d.direction === 'vertical';
    const origin = vertical ? d.rect.x : d.rect.y;
    const span = vertical ? d.rect.w : d.rect.h;
    let ratio = ((vertical ? world.x : world.y) - origin) / span;
    // 吸附：宿主均分线(k=2..6) + 落在宿主区间内的框/邻接元素边·中线（drag start 冻结、已排除宿主移动子树）
    const lines = hostSnapLines(origin, span, vertical ? d.lines.v : d.lines.h);
    const snapped = snapTo(origin + ratio * span, lines, SNAP_THRESHOLD_PX / this.scale);
    if (snapped != null) ratio = (snapped - origin) / span;
    const clamped = Math.max(0.08, Math.min(0.92, ratio));
    this.updateMuntinPreview(clamped);
    this.clearSnapGuide();
    if (snapped != null) this.drawSnapGuide(vertical, snapped, d.rect);
  }

  /** 在一次性候选树上验证目标比例，并把描述层几何物化为一条幽灵中梃。 */
  private updateMuntinPreview(ratio: number): void {
    const d = this.dragMuntin;
    if (!d || !this.tree) return;
    const candidate = cloneEditableTree(this.tree);
    if (!candidate || !moveMuntin(candidate, d.muntinId, ratio, { w: d.rect.w, h: d.rect.h })) return;
    const el = describeWindowTree(candidate, INSTALL_GAP).find((item) => item.id === d.muntinId);
    if (!el) return;
    d.ratio = ratio;
    this.muntinDragPreview?.destroy();
    this.muntinDragPreview = el.points?.length
      ? new Konva.Line({
          x: el.x,
          y: el.y,
          points: el.points,
          closed: true,
          fill: 'rgba(22,119,255,0.25)',
          stroke: HIGHLIGHT,
          strokeWidth: 1 / this.scale,
          dash: [6 / this.scale, 4 / this.scale],
          listening: false,
        })
      : new Konva.Rect({
          x: el.x,
          y: el.y,
          width: el.w,
          height: el.h,
          fill: 'rgba(22,119,255,0.25)',
          stroke: HIGHLIGHT,
          strokeWidth: 1 / this.scale,
          dash: [6 / this.scale, 4 / this.scale],
          listening: false,
        });
    this.overlay().add(this.muntinDragPreview);
    this.layers.guide.batchDraw();
  }

  private clearSnapGuide(): void {
    this.snapGuide?.destroy();
    this.snapGuide = null;
  }

  /** 计算当前树的全局吸附参考线（框边·中线 + 各区域边·中线）。
   *  excludeHostId：拖中梃时传宿主区域 id，排除其移动子树，参考线在整段拖拽中保持稳定（drag start 冻结）。 */
  private computeSnapLines(excludeHostId?: string): { v: number[]; h: number[] } {
    if (!this.tree) return { v: [], h: [] };
    const els = describeWindowTree(this.tree, INSTALL_GAP);
    const f = els.find((e) => e.kind === 'frame');
    const frame = f ? { x: f.x, y: f.y, w: f.w, h: f.h } : { x: 0, y: 0, w: 0, h: 0 };
    const excludeIds = excludeHostId ? subtreeAreaIds(this.tree, excludeHostId) : undefined;
    return collectSnapLines(els, frame, excludeIds);
  }

  /** 画一条吸附参考线（world 坐标，guide 层，蓝色虚线，非交互） */
  private drawSnapGuide(vertical: boolean, snapped: number, rect: { x: number; y: number; w: number; h: number }): void {
    this.snapGuide = new Konva.Line({
      points: vertical ? [snapped, rect.y, snapped, rect.y + rect.h] : [rect.x, snapped, rect.x + rect.w, snapped],
      stroke: HIGHLIGHT,
      strokeWidth: 1.5 / this.scale,
      dash: [6, 4],
      listening: false,
    });
    this.overlay().add(this.snapGuide);
    this.layers.guide.batchDraw();
  }

  private cancelMuntinDrag(): void {
    this.dragMuntin = null;
    this.muntinDragPreview?.destroy();
    this.muntinDragPreview = null;
    this.clearSnapGuide();
  }

  /** 删除当前选中节点（中梃分割 / 分格分割 / 构件），与 Delete 键一致；无选中或空画布时不操作 */
  deleteSelected(): void {
    if (!this.selectedId || !this.tree) return;
    const id = this.selectedId;
    // 选中的是中梃：删除其所在分割（合并区域）
    if (this.tree.root) {
      const muntinHost = findMuntin(this.tree, id);
      if (muntinHost) {
        this.emitAction({ type: 'remove-split', areaId: muntinHost.area.id });
        this.setSelection(null);
        return;
      }
    }
    const area = findArea(this.tree, id);
    if (area?.children) {
      this.emitAction({ type: 'remove-split', areaId: id });
    } else if (area?.sash) {
      this.emitAction({ type: 'remove-sash', areaId: id });
    }
    this.setSelection(null);
  }

  // ── 键盘 ─────────────────────────────────────────────────

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    this.deleteSelected();
  };

  // ── 生命周期 ─────────────────────────────────────────────

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    if (this.suppressContextMenu) this.stage.container().removeEventListener('contextmenu', this.suppressContextMenu);
    this.suppressContextMenu = null;
    this.stage.destroy();
  }
}

/**
 * 画布控制器的可变工作副本。
 * 这里保留节点 id 和所有业务字段，仅隔离 controller 与 store/assembly 的引用。
 */
function cloneEditableTree(tree: WindowTree | null): WindowTree | null {
  return tree ? (JSON.parse(JSON.stringify(tree)) as WindowTree) : null;
}
