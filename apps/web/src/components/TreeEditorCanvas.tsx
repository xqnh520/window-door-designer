import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Button, Divider, InputNumber, Tooltip, Typography } from 'antd';
import type { WindowTree, WindowAssembly, MuntinSlope } from '@wdd/core';
import { findArea } from '@wdd/core';
import { TreeEditorController, type TreeEditorColors, type TreeEditorTool } from '../canvas/tree-editor';
import { useStore, type CanvasAction } from '../store';
import { colorHex, mixHex } from './studio/palette';

/** 与 tree-editor 的 clampScale 一致：仅用于按钮禁用态，真实限幅始终在控制器侧 */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;

/**
 * 容器树编辑画布（R5 统一画布）：
 * - 工具由外部（左侧工具栏）控制：select / split / framing / place
 * - WindowAssembly 为权威数据：画布只上抛 CanvasAction，父级更新后回灌只读树投影
 * - onPlaceRequest：place 模式点击分格时触发，由父级直接放置左侧分类菜单选中的构件
 * - onFrameCreate：framing 拖出外框矩形后由父级（重建窗口）
 */

/**
 * 画布工具：select / split / framing / place。
 * place 为通用放置模式——具体构件类型由左侧分类菜单选中（DesignStudio 的 placeSpec），
 * 点击分格时经 onPlaceRequest 回调直接放置，不再把类型编码进工具字符串。
 */
export type TreeCanvasTool = TreeEditorTool;

export interface TreeEditorCanvasHandle {
  exportImage: () => string | null;
  /** 删除当前选中节点（与 Delete 键一致） */
  deleteSelected: () => void;
  /** 分割方向：null=按拖拽主导轴自动（横/竖梃）；非空=斜梃模式（对角线族） */
  setSplitSlope: (slope: MuntinSlope | null) => void;
  /** 键入尺寸：与点击标注走同一条 resize-dim 通路（markId='frame-w'|'frame-h'|'{areaId}-w|-h'） */
  applyDimEdit: (markId: string, value: number) => void;
  /** 标注当前值（mm）；与写入侧同一份换算，避免两处口径漂移 */
  dimValue: (markId: string) => number | null;
  /** 适应窗口：整幅窗型回到视口，缩放倍率复位 */
  fitView: () => void;
  /** 围绕视口中心缩放（限幅） */
  zoomBy: (factor: number) => void;
  /** 设定缩放倍率（限幅） */
  zoomTo: (scale: number) => void;
  getScale: () => number;
  /** 由外部（校验列表）选中构件：高亮 + 标注 */
  revealNode: (id: string | null) => void;
}

function TreeEditorCanvasImpl(
  {
    tree,
    assembly,
    focusedUnitId,
    selectedCombinerId,
    tool,
    onAction,
    onPlaceRequest,
    onFrameCreate,
    onSelectUnit,
    onSelectCombiner,
    onSelect,
  }: {
    tree: WindowTree | null;
    assembly?: WindowAssembly | null;
    focusedUnitId?: string | null;
    selectedCombinerId?: string | null;
    tool: TreeCanvasTool;
    onAction: (action: CanvasAction) => void;
    onPlaceRequest?: (areaId: string) => void;
    onFrameCreate?: (x: number, y: number, w: number, h: number) => void;
    onSelectUnit?: (unitId: string) => void;
    onSelectCombiner?: (combinerId: string) => void;
    onSelect?: (id: string | null) => void;
  },
  ref: Ref<TreeEditorCanvasHandle>,
) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const ctlRef = useRef<TreeEditorController | null>(null);
  const [selectedInfo, setSelectedInfo] = useState<string | null>(null);
  const [dimEdit, setDimEdit] = useState<string | null>(null);
  const [dimVal, setDimVal] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  /** 光标坐标读数走 DOM 直写：mousemove 频率高，不应当成 React state 反复重渲染 */
  const cursorRef = useRef<HTMLSpanElement | null>(null);

  // 回调 refs：避免初始化闭包过期
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const onPlaceRef = useRef(onPlaceRequest);
  onPlaceRef.current = onPlaceRequest;
  const onFrameRef = useRef(onFrameCreate);
  onFrameRef.current = onFrameCreate;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onSelectUnitRef = useRef(onSelectUnit);
  onSelectUnitRef.current = onSelectUnit;
  const onSelectCombinerRef = useRef(onSelectCombiner);
  onSelectCombinerRef.current = onSelectCombiner;
  const toolRef = useRef<TreeCanvasTool>('select');
  toolRef.current = tool;

  // 初始化控制器（仅一次）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const initialTree = treeRef.current;
    const ctl = new TreeEditorController(
      el,
      initialTree,
      {
        onAction: (action) => onActionRef.current(action),
        onSelect: (id) => {
          onSelectRef.current?.(id);
          setSelectedInfo(describeSelected(treeRef.current, id));
        },
        onPlaceRequest: (areaId) => onPlaceRef.current?.(areaId),
        onFrameCreate: (x, y, w, h) => onFrameRef.current?.(x, y, w, h),
        onSelectUnit: (unitId) => onSelectUnitRef.current?.(unitId),
        onSelectCombiner: (combinerId) => onSelectCombinerRef.current?.(combinerId),
        onDimEdit: (markId) => {
          const c = ctlRef.current;
          if (!c) return;
          setDimEdit(markId);
          setDimVal(c.dimValue(markId));
        },
        onViewChange: (scale) => setZoom(scale),
        onPointerMove: (p) => {
          const el = cursorRef.current;
          if (el) el.textContent = p ? `X ${Math.round(p.x)} · Y ${Math.round(p.y)} mm` : '';
        },
      },
      initialTree ? initialTree.openingW + 200 : 1400,
      initialTree ? initialTree.openingH + 200 : 1200,
    );
    ctlRef.current = ctl;
    ctl.setTool(toolRef.current);
    // 无头 QA 入口：内置浏览器截图不可用，只能靠脚本驱动控制器断言视图/命中。
    // 生产构建下 import.meta.env.DEV 为常量 false，整段被摇掉。
    if (import.meta.env.DEV) (window as unknown as { __wddTreeCtl?: TreeEditorController }).__wddTreeCtl = ctl;

    const ro = new ResizeObserver(() => {
      ctl.resize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      ctl.destroy();
      el.innerHTML = '';
      ctlRef.current = null;
      if (import.meta.env.DEV) (window as unknown as { __wddTreeCtl?: TreeEditorController }).__wddTreeCtl = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const treeRef = useRef(tree);
  treeRef.current = tree;
  useEffect(() => {
    ctlRef.current?.setTree(tree);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  useEffect(() => {
    ctlRef.current?.setTool(tool);
  }, [tool]);

  // 外框拼接：整体装配上下文 + 聚焦单元（绘制只读幽灵、拼樘、重算世界尺寸）
  useEffect(() => {
    ctlRef.current?.setAssembly(assembly ?? null, focusedUnitId ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assembly, focusedUnitId]);

  useEffect(() => {
    ctlRef.current?.setSelectedCombiner(selectedCombinerId ?? null);
  }, [selectedCombinerId]);

  const outerColor = useStore((s) => s.orderConfig.outerColor);
  const innerColor = useStore((s) => s.orderConfig.innerColor);
  const beadJoint = useStore((s) => s.orderConfig.beadJoint);
  const beadWidth = useStore(
    (s) => (s.library.series.find((x) => x.id === s.seriesId) ?? s.library.series[0])?.beadWidth,
  );
  useEffect(() => {
    const ctl = ctlRef.current;
    if (!ctl) return;
    // 2D 立面视图为单面（默认室外侧）：型材所有部分同色，与 3D 室外面保持一致
    const profile = colorHex(outerColor);
    const white = '#ffffff';
    void innerColor;
    ctl.setColors({
      frame: profile,
      sash: profile,
      glass: mixHex(profile, '#E8F4F8', 0.75),
      inner: mixHex(profile, white, 0.9),
      panel: mixHex(profile, white, 0.96),
      screen: '#e9ebee',
      bead: mixHex(profile, white, 0.34), // 压线：外框掺白得到的差异化浅银，扣边可辨
    } satisfies TreeEditorColors);
    ctl.setBeadConfig({ widthMm: beadWidth, joint: beadJoint });
  }, [outerColor, innerColor, beadWidth, beadJoint]);

  useImperativeHandle(ref, () => ({
    exportImage: () => ctlRef.current?.exportImage() ?? null,
    deleteSelected: () => ctlRef.current?.deleteSelected(),
    setSplitSlope: (slope) => ctlRef.current?.setSplitSlope(slope ?? null),
    applyDimEdit: (markId, value) => ctlRef.current?.applyDimEdit(markId, value),
    dimValue: (markId) => ctlRef.current?.dimValue(markId) ?? null,
    fitView: () => ctlRef.current?.fitView(),
    zoomBy: (factor) => ctlRef.current?.zoomBy(factor),
    zoomTo: (scale) => ctlRef.current?.setScale(scale),
    getScale: () => ctlRef.current?.getScale() ?? 1,
    revealNode: (id) => ctlRef.current?.revealNode(id),
  }));

  const commitDim = () => {
    if (!dimEdit || dimVal == null) {
      setDimEdit(null);
      return;
    }
    ctlRef.current?.applyDimEdit(dimEdit, dimVal);
    setDimEdit(null);
    setDimVal(null);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }} />
      {/* 选中节点信息 */}
      {selectedInfo && (
        <div
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            zIndex: 10,
            background: '#fff',
            border: '1px solid #d9d9d9',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            color: '#555',
            boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
          }}
        >
          {selectedInfo}
        </div>
      )}
      {/* 视图条：光标读数 + 缩放控件（右下角常驻） */}
      <div
        style={{
          position: 'absolute',
          right: 12,
          bottom: 12,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: '#fff',
          border: '1px solid #d9d9d9',
          borderRadius: 6,
          padding: '3px 8px',
          boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
          fontSize: 12,
          color: '#555',
        }}
      >
        <span ref={cursorRef} style={{ minWidth: 118, color: '#8c8c8c' }} />
        <Divider type="vertical" style={{ margin: '0 2px', height: 14 }} />
        <Tooltip title="缩小">
          <Button size="small" type="text" disabled={zoom <= MIN_ZOOM + 1e-6} onClick={() => ctlRef.current?.zoomBy(1 / 1.25)}>
            −
          </Button>
        </Tooltip>
        <span style={{ minWidth: 42, textAlign: 'center', color: '#555' }}>{Math.round(zoom * 100)}%</span>
        <Tooltip title="放大">
          <Button size="small" type="text" disabled={zoom >= MAX_ZOOM - 1e-6} onClick={() => ctlRef.current?.zoomBy(1.25)}>
            +
          </Button>
        </Tooltip>
        <Tooltip title="1:1（1 屏幕像素 = 1 mm）">
          <Button size="small" type="text" onClick={() => ctlRef.current?.setScale(1)}>
            1:1
          </Button>
        </Tooltip>
        <Tooltip title="适应窗口（整樘窗回到视口）">
          <Button size="small" type="text" onClick={() => ctlRef.current?.fitView()}>
            适应
          </Button>
        </Tooltip>
      </div>
      {/* 尺寸标注编辑浮层 */}
      {dimEdit && (
        <div
          style={{
            position: 'absolute',
            bottom: 48,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            background: '#fff',
            border: '1px solid #d9d9d9',
            borderRadius: 8,
            padding: '8px 12px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.16)',
          }}
        >
          <Typography.Text strong style={{ fontSize: 12 }}>
            设置尺寸（mm）
          </Typography.Text>
          <InputNumber
            size="small"
            autoFocus
            value={dimVal}
            min={60}
            onChange={(v) => setDimVal(v ?? null)}
            onPressEnter={commitDim}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDimEdit(null);
            }}
            style={{ width: 110 }}
          />
          <Button size="small" type="primary" onClick={commitDim}>
            确定
          </Button>
          <Button size="small" onClick={() => setDimEdit(null)}>
            取消
          </Button>
        </div>
      )}
    </div>
  );
}

export const TreeEditorCanvas = forwardRef(TreeEditorCanvasImpl);

function describeSelected(tree: WindowTree | null, id: string | null): string | null {
  if (!id || !tree) return null;
  if (id === 'frame') return '选中：外框';
  const area = findArea(tree, id);
  if (area) {
    if (area.children) return '选中：分格容器（Delete 删除此格分割）';
    return area.sash ? `选中：分格区域 · ${area.sash.label ?? area.sash.windowType}` : '选中：空分格区域（可放置构件）';
  }
  return '选中：中梃（拖拽调位，Delete 删除分割）';
}
