import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Button, InputNumber, Typography } from 'antd';
import type { WindowTree, WindowAssembly, MuntinSlope } from '@wdd/core';
import { findArea } from '@wdd/core';
import { TreeEditorController, type TreeEditorColors, type TreeEditorTool } from '../canvas/tree-editor';
import { useStore } from '../store';
import { colorHex, mixHex } from './studio/palette';

/**
 * 容器树编辑画布（R5 统一画布）：
 * - 工具由外部（左侧工具栏）控制：select / split / framing / place
 * - 树为权威数据：onChange 上抛变更，父级 setState 后回灌 setTree 重渲染
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
}

function TreeEditorCanvasImpl(
  {
    tree,
    assembly,
    focusedUnitId,
    selectedCombinerId,
    tool,
    onChange,
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
    onChange: (t: WindowTree) => void;
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

  // 回调 refs：避免初始化闭包过期
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
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
        onChange: (t) => onChangeRef.current(t),
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
      },
      initialTree ? initialTree.openingW + 200 : 1400,
      initialTree ? initialTree.openingH + 200 : 1200,
    );
    ctlRef.current = ctl;
    ctl.setTool(toolRef.current);

    const ro = new ResizeObserver(() => {
      ctl.resize(el.clientWidth, el.clientHeight);
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      ctl.destroy();
      el.innerHTML = '';
      ctlRef.current = null;
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
    } satisfies TreeEditorColors);
  }, [outerColor, innerColor]);

  useImperativeHandle(ref, () => ({
    exportImage: () => ctlRef.current?.exportImage() ?? null,
    deleteSelected: () => ctlRef.current?.deleteSelected(),
    setSplitSlope: (slope) => ctlRef.current?.setSplitSlope(slope ?? null),
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
          <InputNumber size="small" autoFocus value={dimVal} min={60} onChange={(v) => setDimVal(v ?? null)} style={{ width: 110 }} />
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