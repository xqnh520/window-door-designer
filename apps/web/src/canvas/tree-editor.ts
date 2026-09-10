import Konva from 'konva';
import type { WindowTree, WindowTreeArea, WindowMuntin, SashType, WindowAssembly, AssemblyLayout, UnitPlacement, MuntinSlope } from '@wdd/core';
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
  placeNode,
  renderAssembly,
  removeSash,
  removeSplit,
  resizeTreeEdge,
  setSash,
  snapTo,
  splitArea,
  type TreeEdge,
  renderWindowTree,
  sashWidthOf,
  muntinWidthOf,
  muntinSagittaOf,
  DEFAULT_MUNTIN_MM,
  sashHandlePlacement,
} from '@wdd/core';
import type { Pt } from '../store';

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
 * 树为权威数据：所有编辑操作变更 tree 后通过 onChange 回调上抛（React 侧 setState），
 * 再由 setTree() 重新渲染；算料/报价/校验由上层用 toDesignModel 实时联动。
 *
 * 转角拼接（M2）空间分离：聚焦树与全部叠加层一律用**加工空间（展开态）**坐标构建，再经 placeNode
 * 套上该单元的显示变换（转角时旋转）；指针则先用 focusPoint() 逆旋转回展开态再喂给
 * split/muntin/edge-drag 等编辑逻辑。因此 angleDeg=180（恒等变换）时本文件行为与转角前完全一致。
 */

export type TreeEditorTool = 'select' | 'split' | 'place' | 'framing';

export interface TreeEditorOptions {
  onChange: (tree: WindowTree) => void;
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
}

/** 尺寸标注标记（world 坐标） */
export interface DimMark {
  id: string;
  /** 文本锚点（world） */
  x: number;
  y: number;
  text: string;
}

const INSTALL_GAP = 20;
const MIN_RATIO = 0.1;
/** 吸附阈值（屏幕 px，按缩放反算成 world mm） */
const SNAP_THRESHOLD_PX = 6;
const HIGHLIGHT = '#1677ff';
/** 尺寸标注颜色（深色，类似工程制图风格） */
const DIM_COLOR = '#333333';
/** 标注目标屏幕字号（px，随缩放反向补偿保持恒定）与默认间距 */
const DIM_FRAME_FONT = 24;
const DIM_CELL_FONT = 15;
const DIM_FRAME_GAP = 40;
const DIM_CELL_GAP = 14;
/** 标注最小 Gap（mm） */
const DIM_MIN_GAP = 20;

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
}

export interface TreeEditorColors {
  frame?: string;
  glass?: string;
  sash?: string;
  screen?: string;
  panel?: string;
  inner?: string;
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

  private tool: TreeEditorTool = 'select';
  private placeType: SashType | null = null;
  private renderGroup: Konva.Group | null = null;
  private contextGroup: Konva.Group | null = null;
  private highlightBox: Konva.Rect | null = null;
  private selectedId: string | null = null;

  // 外框拼接装配：聚焦单元走 this.tree（可编辑），其余单元 + 拼樘走 contextGroup（只读）
  private assembly: WindowAssembly | null = null;
  private focusedUnitId: string | null = null;
  private selectedCombinerId: string | null = null;
  private combinerHighlight: Konva.Node | null = null;
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
  private dragMuntin: { muntinId: string; hostId: string; rect: { x: number; y: number; w: number; h: number }; direction: WindowMuntin['direction']; lines: { v: number[]; h: number[] } } | null = null;

  // 图形边拖拽（外框框料/分格，仅框料宽度内触发）
  private dragEdge: { id: string; edge: TreeEdge } | null = null;
  /** 外框「四根框料」选中语义：当前选中的边（根料高亮） */
  private selectedEdge: TreeEdge | null = null;
  private edgeBandHighlight: Konva.Rect | null = null;
  /** 拖拽平移窗口（其余位置单击拖动=移动图形位置） */
  private dragWindow: { start: Pt; offsetX: number; offsetY: number } | null = null;

  // 尺寸标注
  private dimLayer: Konva.Group | null = null;
  private dimMarks: DimMark[] = [];
  /** 标注可拖动：宽标注（顶部）与高标注（左侧）距边框的距离（mm），拖拽调整 */
  private dimGapW = DIM_FRAME_GAP;
  private dimGapH = DIM_FRAME_GAP;

  constructor(container: HTMLDivElement, tree: WindowTree | null, opts: TreeEditorOptions, drawW: number, drawH: number) {
    this.opts = opts;
    this.tree = tree;
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
    const pad = 60;
    this.scale = Math.min((container.clientWidth - pad) / drawW, (container.clientHeight - pad) / drawH);
    if (!Number.isFinite(this.scale) || this.scale <= 0) this.scale = 1;
    this.applyTransform();

    this.stage.on('wheel', this.onWheel);
    this.stage.on('mousedown', this.onMouseDown);
    this.stage.on('mousemove', this.onMouseMove);
    this.stage.on('mouseup', this.onMouseUp);
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
      area.sash.handle = next;
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
      this.render();
      this.opts.onChange(this.tree);
    });
    window.addEventListener('keydown', this.onKeyDown);

    this.render();
  }

  // ── 变换 ────────────────────────────────────────────────

  /** 容器尺寸变化：更新 stage 并按初始世界尺寸重算缩放 */
  resize(w: number, h: number): void {
    this.stage.size({ width: w, height: h });
    const pad = 60;
    const s = Math.min((w - pad) / this.drawW, (h - pad) / this.drawH);
    this.scale = Number.isFinite(s) && s > 0 ? s : 1;
    this.applyTransform();
  }

  private applyTransform(): void {
    const s = this.scale;
    this.stage.scale({ x: s, y: s });
    this.stage.position({ x: 40, y: 40 });
    this.stage.batchDraw();
  }

  worldPoint(): { x: number; y: number } {
    const p = this.stage.getPointerPosition() ?? { x: 0, y: 0 };
    return { x: (p.x - this.stage.x()) / this.scale, y: (p.y - this.stage.y()) / this.scale };
  }

  /** 世界坐标 → 屏幕坐标 */
  toScreen(p: { x: number; y: number }): { x: number; y: number } {
    return { x: p.x * this.scale + this.stage.x(), y: p.y * this.scale + this.stage.y() };
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
    const factor = e.evt.deltaY < 0 ? 1.1 : 0.9;
    this.scale = Math.max(0.2, Math.min(4, this.scale * factor));
    this.applyTransform();
    this.render(); // 缩放后重绘（标注以屏幕恒定字号补偿）
  };

  // ── 树渲染与命中 ─────────────────────────────────────────

  setTree(tree: WindowTree | null): void {
    this.tree = tree;
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
        const el = this.stage.container();
        const pad = 60;
        const s = Math.min((el.clientWidth - pad) / this.drawW, (el.clientHeight - pad) / this.drawH);
        this.scale = Number.isFinite(s) && s > 0 ? s : 1;
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

  setTool(tool: TreeEditorTool, placeType?: SashType): void {
    this.tool = tool;
    this.placeType = placeType ?? null;
    this.cancelSplit();
    this.cancelMuntinDrag();
    this.cancelFrame();
    this.cancelEdgeDrag();
    this.setCursor();
  }

  setSelection(id: string | null): void {
    this.selectedId = id;
    if (!id) this.selectedEdge = null;
    this.renderHighlight();
    this.opts.onSelect?.(id);
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
    this.highlightBox?.destroy();
    this.highlightBox = null;
    this.combinerHighlight?.destroy();
    this.combinerHighlight = null;
    this.clearSnapGuide();
    this.dimLayer?.destroy();
    this.dimLayer = null;
    this.dimMarks = [];

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

    const { group, nodes } = renderWindowTree(tree, { installGap: INSTALL_GAP, colors: this.colors });
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
    this.dimLayer = null;
    this.dimMarks = [];
    const layer = new Konva.Group({ listening: true });
    this.overlay().add(layer);
    this.dimLayer = layer;

    const layout = layoutTree(this.tree, { installGap: INSTALL_GAP });
    const f = layout.frame;
    // 旋转腿上标注引线随组旋转，但拖拽调距按单轴求解 → 暂不开放
    const draggable = !this.isRotated();

    // 矩形只标两处：总宽（上侧外侧）+ 总高（左侧外侧），大字号
    this.pushDimCad(layer, 'frame-w', 'horizontal', f.x, f.y - this.dimGapW, f.x + f.w, f.y - this.dimGapW, DIM_FRAME_FONT, draggable);
    this.pushDimCad(layer, 'frame-h', 'vertical', f.x - this.dimGapH, f.y, f.x - this.dimGapH, f.y + f.h, DIM_FRAME_FONT, draggable);

    // 选中分格时显示该格宽/高（小号标注，避免常态画布杂乱）
    if (this.selectedId) {
      const box = layout.boxes.get(this.selectedId);
      if (box) {
        this.pushDimCad(layer, `${this.selectedId}-w`, 'horizontal', box.x + DIM_CELL_GAP, box.y + box.h + DIM_CELL_GAP, box.x + box.w - DIM_CELL_GAP, box.y + box.h + DIM_CELL_GAP, DIM_CELL_FONT, false);
        this.pushDimCad(layer, `${this.selectedId}-h`, 'vertical', box.x + box.w + DIM_CELL_GAP, box.y + DIM_CELL_GAP, box.x + box.w + DIM_CELL_GAP, box.y + box.h - DIM_CELL_GAP, DIM_CELL_FONT, false);
      }
    }

    // 装配体标注：拼樘标签 + 转角角度标注
    if (this.assembly && this.assemblyLayout) {
      this.renderCombinerLabels(layer);
      this.renderAngleLabels(layer);
    }
  }

  /**
   * CAD 尺寸标注：两端刻度「|…<── ──>…|」+ 尺寸文本打断线中居中（水平文本水平、垂直文本旋转 -90°）。
   * 标注组可拖动：水平标注沿垂直方向、垂直标注沿水平方向调整与边框的距离。
   */
  private pushDimCad(
    layer: Konva.Group,
    id: string,
    orient: 'horizontal' | 'vertical',
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    fontSize: number,
    draggable: boolean,
  ): void {
    // 屏幕恒定：标注内容随缩放反向补偿（字/线/刻度在屏幕上保持固定观感）
    const s = 1 / this.scale;
    const fontWorld = fontSize * s;
    const lineWidth = 2.2 * s;
    const tick = 8 * s;
    const pad = 9 * s;

    const value = Math.round(orient === 'horizontal' ? x2 - x1 : y2 - y1);
    const t = new Konva.Text({ text: `${value}`, fontSize: fontWorld, fontStyle: 'bold', fill: DIM_COLOR, align: 'center', listening: true });
    if (orient === 'vertical') t.rotation(-90);

    const half = t.width() / 2 + pad;
    const start = orient === 'horizontal' ? x1 : y1;
    const end = orient === 'horizontal' ? x2 : y2;
    const mid = (start + end) / 2;

    this.dimMarks.push({
      id,
      x: orient === 'horizontal' ? mid : x1,
      y: orient === 'horizontal' ? y1 : mid,
      text: `${value}`,
    });

    const g = new Konva.Group({ listening: true, draggable });
    // 尺寸线：中段断开给文本让位
    const seg = (a: number, b: number): void => {
      if (b - a < 1) return;
      g.add(
        new Konva.Line({
          points: orient === 'horizontal' ? [a, y1, b, y1] : [x1, a, x1, b],
          stroke: DIM_COLOR,
          strokeWidth: lineWidth,
          listening: false,
        }),
      );
    };
    seg(start, mid - half);
    seg(mid + half, end);

    // 两端刻度（「|」）
    if (orient === 'horizontal') {
      g.add(new Konva.Line({ points: [start, y1 - tick, start, y1 + tick], stroke: DIM_COLOR, strokeWidth: lineWidth, listening: false }));
      g.add(new Konva.Line({ points: [end, y1 - tick, end, y1 + tick], stroke: DIM_COLOR, strokeWidth: lineWidth, listening: false }));
    } else {
      g.add(new Konva.Line({ points: [x1 - tick, start, x1 + tick, start], stroke: DIM_COLOR, strokeWidth: lineWidth, listening: false }));
      g.add(new Konva.Line({ points: [x1 - tick, end, x1 + tick, end], stroke: DIM_COLOR, strokeWidth: lineWidth, listening: false }));
    }

    // 文本居中（旋转以自身中心为锚）
    t.x(orient === 'horizontal' ? mid : x1);
    t.y(orient === 'horizontal' ? y1 : mid);
    t.offsetX(t.width() / 2);
    t.offsetY(t.height() / 2);
    t.on('click', () => this.opts.onDimEdit?.(id));
    t.setAttr('cursor', 'pointer');

    // 拖动调整标注距离：水平标注只垂直动、垂直标注只水平动
    const axis = orient === 'horizontal' ? 'y' : 'x';
    g.on('dragmove', () => {
      if (axis === 'y') g.y(Math.max(DIM_MIN_GAP, g.y()));
      else g.x(Math.max(DIM_MIN_GAP, g.x()));
    });
    let startPos = 0;
    g.on('dragstart', () => {
      startPos = axis === 'y' ? g.y() : g.x();
    });
    const onDragEnd = () => {
      if (!draggable) return;
      const delta = (axis === 'y' ? g.y() - startPos : g.x() - startPos) / this.scale;
      if (axis === 'y') {
        this.dimGapW = Math.max(DIM_MIN_GAP, this.dimGapW + delta);
      } else {
        this.dimGapH = Math.max(DIM_MIN_GAP, this.dimGapH + delta);
      }
      this.render(); // 按新 gap 重排标注
    };
    g.on('dragend', onDragEnd);

    g.add(t);
    layer.add(g);
  }

  /**
   * 拼樘/转角料标签：在拼樘矩形上方显示"连接件(厚度)"文字，带箭头指向拼樘中心
   */
  private renderCombinerLabels(layer: Konva.Group): void {
    if (!this.assembly || !this.assemblyLayout) return;
    const s = 1 / this.scale;

    for (const comb of this.assembly.combiners) {
      const box = this.assemblyLayout.combiners.get(comb.id);
      if (!box) continue;

      const label = comb.axis === 'x' && comb.angleDeg !== 180 ? '转角料' : '连接件';
      const text = `${label}(${Math.round(comb.thicknessMm)})`;
      const fontSize = 14 * s;

      // 标签位置：拼樘上方
      const textX = box.x + box.w / 2;
      const textY = box.y - 20 * s;

      // 箭头：从文字底部指向拼樘顶部中心
      const arrowEndX = box.x + box.w / 2;
      const arrowEndY = box.y;

      const g = new Konva.Group({ listening: false });

      // 箭头线
      g.add(
        new Konva.Line({
          points: [textX, textY + fontSize, arrowEndX, arrowEndY],
          stroke: DIM_COLOR,
          strokeWidth: 1.5 * s,
          listening: false,
        }),
      );

      // 文字
      const t = new Konva.Text({
        text,
        fontSize,
        fontStyle: 'bold',
        fill: DIM_COLOR,
        align: 'center',
        listening: false,
      });
      t.x(textX);
      t.y(textY);
      t.offsetX(t.width() / 2);
      t.offsetY(t.height());

      g.add(t);
      layer.add(g);
    }
  }

  /**
   * 角度标注：在转角窗的内角处显示角度值（如 99.7°、80.3°），带弧形指示
   */
  private renderAngleLabels(layer: Konva.Group): void {
    if (!this.assembly || !this.assemblyLayout) return;
    const s = 1 / this.scale;

    for (let i = 1; i < this.assembly.units.length; i++) {
      const comb = this.assembly.combiners.find((c) =>
        (c.between[0] === this.assembly!.units[i - 1].id && c.between[1] === this.assembly!.units[i].id) ||
        (c.between[1] === this.assembly!.units[i - 1].id && c.between[0] === this.assembly!.units[i].id),
      );
      if (!comb || comb.angleDeg === 180) continue;

      // 获取两个单元的布局框
      const prevFrame = this.assemblyLayout.units.get(this.assembly.units[i - 1].id)?.frame;
      const currFrame = this.assemblyLayout.units.get(this.assembly.units[i].id)?.frame;
      if (!prevFrame || !currFrame) continue;

      // 内角位置（两框相交的内角点）
      const cornerX = currFrame.x;
      const cornerY = currFrame.y;

      // 角度文字位置：内角内侧
      const textX = cornerX + 30 * s;
      const textY = cornerY + 30 * s;

      const angleText = `${comb.angleDeg.toFixed(1)}°`;
      const fontSize = 16 * s;

      const g = new Konva.Group({ listening: false });

      // 弧形指示（简化为小圆弧）
      const arcRadius = 20 * s;
      const arc = new Konva.Arc({
        x: cornerX,
        y: cornerY,
        outerRadius: arcRadius,
        angle: 0,
        innerRadius: 0,
        fill: 'rgba(51, 51, 51, 0.3)',
        listening: false,
      });
      g.add(arc);

      // 角度文字
      const t = new Konva.Text({
        text: angleText,
        fontSize,
        fontStyle: 'bold',
        fill: DIM_COLOR,
        listening: false,
      });
      t.x(textX);
      t.y(textY);

      g.add(t);
      layer.add(g);
    }
  }

  /** 标注改值：外框总宽高 / 分格宽高（自动选择可调边界） */
  applyDimEdit(markId: string, value: number): void {
    if (!this.tree) return;
    const v = Math.max(60, Math.round(value));
    if (markId === 'frame-w') {
      const layout = layoutTree(this.tree, { installGap: INSTALL_GAP });
      this.tree.openingW = Math.round(v + 2 * INSTALL_GAP);
      void layout;
    } else if (markId === 'frame-h') {
      const layout = layoutTree(this.tree, { installGap: INSTALL_GAP });
      this.tree.openingH = Math.round(v + 2 * INSTALL_GAP);
      void layout;
    } else if (markId.endsWith('-w')) {
      const areaId = markId.slice(0, -2);
      const layout = layoutTree(this.tree, { installGap: INSTALL_GAP });
      const box = layout.boxes.get(areaId);
      if (!box) return;
      const leftDone = resizeTreeEdge(this.tree, areaId, 'left', box.x + box.w - v, { installGap: INSTALL_GAP });
      if (!leftDone) {
        resizeTreeEdge(this.tree, areaId, 'right', box.x + v, { installGap: INSTALL_GAP });
      }
    } else if (markId.endsWith('-h')) {
      const areaId = markId.slice(0, -2);
      const layout = layoutTree(this.tree, { installGap: INSTALL_GAP });
      const box = layout.boxes.get(areaId);
      if (!box) return;
      const topDone = resizeTreeEdge(this.tree, areaId, 'top', box.y + box.h - v, { installGap: INSTALL_GAP });
      if (!topDone) {
        resizeTreeEdge(this.tree, areaId, 'bottom', box.y + v, { installGap: INSTALL_GAP });
      }
    }
    this.opts.onChange(this.tree);
    this.render();
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
    const namedOf = (start: Konva.Node | null): { node: Konva.Node; kind: 'frame' | 'muntin' | 'area'; edge?: TreeEdge } | null => {
      let n: Konva.Node | null = start;
      let edge: TreeEdge | undefined;
      while (n && n !== this.stage) {
        const edgeAttr = n.getAttr('data-edge');
        if (edgeAttr) edge = edgeAttr as TreeEdge;
        const name = n.name();
        if (name === 'frame' || name === 'muntin' || name === 'area') {
          return { node: n, kind: name, edge };
        }
        n = n.getParent();
      }
      return null;
    };

    const top = this.stage.getIntersection(screen);
    const first = namedOf(top);
    if (first) return { id: first.node.id(), kind: first.kind, edge: first.edge };

    // 几何命中顺序不保证 topmost 优先，且外框那枚覆盖整个洞口的透明命中盒会抢在前面
    // → 取命中盒面积最小的具名候选，等价于「最内层、最具体」的那个图形。
    let best: { node: Konva.Node; kind: 'frame' | 'muntin' | 'area'; edge?: TreeEdge; area: number } | null = null;
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
    if (best) return { id: best.node.id(), kind: best.kind, edge: best.edge };
    if (combiner) return { id: combiner, kind: 'combiner' };
    if (unit) return { id: unit, kind: 'unit' };
    return null;
  }

  // ── 选中高亮 ─────────────────────────────────────────────

  /** 拼樘/转角料选中高亮环（展开态坐标 + 上游腿显示变换，位于 guide 层） */
  private renderCombinerHighlight(): void {
    if (!this.selectedCombinerId || !this.assemblyLayout) return;
    const box = this.assemblyLayout.combiners.get(this.selectedCombinerId);
    if (!box) return;
    const ring = new Konva.Rect({
      x: box.x - 2,
      y: box.y - 2,
      width: Math.max(1, box.w + 4),
      height: Math.max(1, box.h + 4),
      stroke: HIGHLIGHT,
      strokeWidth: 2.5 / this.scale,
      dash: [8, 5],
      listening: false,
    });
    const wrapper = new Konva.Group();
    wrapper.add(ring);
    this.layers.guide.add(wrapper);
    placeNode(wrapper, this.assemblyLayout.combinerPlacement.get(this.selectedCombinerId), { x: box.x, y: box.y });
    this.combinerHighlight = wrapper;
  }

  private renderHighlight(): void {
    if (this.highlightBox) {
      this.highlightBox.destroy();
      this.highlightBox = null;
    }
    if (this.edgeBandHighlight) {
      this.edgeBandHighlight.destroy();
      this.edgeBandHighlight = null;
    }
    if (!this.selectedId || !this.tree) return;
    const g = this.nodeById.get(this.selectedId);
    const layout = layoutTree(this.tree, { installGap: INSTALL_GAP });
    // 外框：选中某根框料 → 该边整条带高亮（四根料语义）
    if (this.selectedId === 'frame' && this.selectedEdge) {
      const f = layout.frame;
      const fw = Math.max(this.tree.frameWidthMm, 20);
      const band =
        this.selectedEdge === 'left'
          ? { x: f.x, y: f.y, w: fw, h: f.h }
          : this.selectedEdge === 'right'
            ? { x: f.x + f.w - fw, y: f.y, w: fw, h: f.h }
            : this.selectedEdge === 'top'
              ? { x: f.x, y: f.y, w: f.w, h: fw }
              : { x: f.x, y: f.y + f.h - fw, w: f.w, h: fw };
      this.edgeBandHighlight = new Konva.Rect({
        ...band,
        fill: 'rgba(22,119,255,0.22)',
        stroke: HIGHLIGHT,
        strokeWidth: 2,
        dash: [8, 5],
        listening: false,
      });
      this.overlay().add(this.edgeBandHighlight);
      this.layers.guide.batchDraw();
      void g;
      return;
    }
    if (!g) return;
    const box = layout.boxes.get(this.selectedId);
    if (!box) return;
    this.highlightBox = new Konva.Rect({
      x: box.x - 2,
      y: box.y - 2,
      width: box.w + 4,
      height: box.h + 4,
      stroke: HIGHLIGHT,
      strokeWidth: 2.5 / this.scale,
      dash: [8, 5],
      listening: false,
    });
    this.overlay().add(this.highlightBox);
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
      this.setSelection(hit.id);
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
        this.dragWindow = { start: world, offsetX: this.tree.offsetX ?? 0, offsetY: this.tree.offsetY ?? 0 };
      }
    } else {
      this.setSelection(null);
      this.setSelectedEdge(null);
      this.dragEdge = null;
      this.dragWindow = { start: world, offsetX: this.tree.offsetX ?? 0, offsetY: this.tree.offsetY ?? 0 };
    }
    void world;
  };

  private onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    void e;
    if (this.panning && this.panStart) {
      const dx = e.evt.clientX - this.panStart.pointer.x;
      const dy = e.evt.clientY - this.panStart.pointer.y;
      this.stage.position({ x: this.panStart.pan.x + dx, y: this.panStart.pan.y + dy });
      this.stage.batchDraw();
      return;
    }
    const world = this.focusPoint();
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
      // 其余位置拖动 = 平移窗口（offset）
      const dx = world.x - this.dragWindow.start.x;
      const dy = world.y - this.dragWindow.start.y;
      this.tree.offsetX = Math.round((this.dragWindow.offsetX + dx) * 10) / 10;
      this.tree.offsetY = Math.round((this.dragWindow.offsetY + dy) * 10) / 10;
      this.render();
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
      this.opts.onChange(this.tree);
      this.dragWindow = null;
      return;
    }
    if (this.dragEdge && this.tree) {
      this.opts.onChange(this.tree);
      this.dragEdge = null;
      return;
    }
    if (this.dragMuntin && this.tree) {
      this.opts.onChange(this.tree);
      this.cancelMuntinDrag();
    }
  };

  // ── 图形边拖拽（外框/分格四边调尺寸）──────────────────────

  private updateEdgeDrag(world: Pt): void {
    const d = this.dragEdge!;
    if (!this.tree) return;
    const pos = d.edge === 'left' || d.edge === 'right' ? world.x : world.y;
    if (resizeTreeEdge(this.tree, d.id, d.edge, pos, { installGap: INSTALL_GAP })) {
      this.render();
    }
  }

  private cancelEdgeDrag(): void {
    this.dragEdge = null;
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
    setSash(this.tree, areaId, specFor(this.placeType));
    this.opts.onChange(this.tree);
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
      if (splitArea(this.tree, host.id, this.splitDir, clamped, th, muntinSagittaOf(this.tree), { w: hostBox.w, h: hostBox.h })) {
        this.opts.onChange(this.tree);
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
      moveMuntin(this.tree, d.muntinId, clamped, { w: d.rect.w, h: d.rect.h });
      this.render();
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
    moveMuntin(this.tree, d.muntinId, clamped);
    // 实时预览：直接重渲染（心跳频繁，交给浏览器合并）；render() 会清掉旧参考线
    this.render();
    // 参考线必须在 render() 之后绘制，否则会被 render() 内的 clearSnapGuide() 立即销毁
    this.clearSnapGuide();
    if (snapped != null) this.drawSnapGuide(vertical, snapped, d.rect);
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
    this.layers.guide.add(this.snapGuide);
    this.layers.guide.batchDraw();
  }

  private cancelMuntinDrag(): void {
    this.dragMuntin = null;
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
        removeSplit(this.tree, muntinHost.area.id);
        this.opts.onChange(this.tree);
        this.setSelection(null);
        return;
      }
    }
    const area = findArea(this.tree, id);
    if (area?.children) {
      removeSplit(this.tree, id);
      this.opts.onChange(this.tree);
    } else if (area?.sash) {
      removeSash(this.tree, id);
      this.opts.onChange(this.tree);
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
    this.stage.destroy();
  }
}

/** 直接放置：构件类型 → 默认放置规范（标签/铰链/开启方向） */
function specFor(type: SashType): { windowType: SashType; label: string; hingeSide?: 'left' | 'right' | 'top' | 'bottom'; openDirection?: 'in' | 'out' } {
  switch (type) {
    case 'screen':
      return { windowType: 'screen', label: 'WC' };
    case 'casement':
      return { windowType: 'casement', label: 'A1', hingeSide: 'left', openDirection: 'out' };
    case 'casementUp':
      return { windowType: 'casementUp', label: 'A1', hingeSide: 'left', openDirection: 'out' };
    case 'tiltSlide':
      return { windowType: 'tiltSlide', label: 'A1', hingeSide: 'left', openDirection: 'in' };
    case 'sliding':
      return { windowType: 'sliding', label: 'S1' };
    case 'topHinged':
      return { windowType: 'topHinged', label: 'A1', hingeSide: 'top', openDirection: 'out' };
    default:
      return { windowType: 'fixed', label: 'F1' };
  }
}