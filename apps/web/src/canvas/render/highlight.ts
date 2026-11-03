import Konva from 'konva';
import {
  findArea,
  layoutTree,
  sashWidthOf,
  type AssemblyLayout,
  type TreeEdge,
  type WindowTree,
} from '@wdd/core';
import { placeNode } from './window-assembly-render';

const HIGHLIGHT = '#1677ff';

export interface TreeHighlightOptions {
  tree: WindowTree;
  selectedId: string | null;
  selectedEdge: TreeEdge | null;
  selectedBead: boolean;
  selectedNodeExists: boolean;
  scale: number;
  beadWidthMm?: number;
  installGap: number;
}

/**
 * 当前选择 → Konva 高亮节点。只读取树快照，不修改树或提交业务动作。
 * 返回 null 表示当前选择没有可绘制的几何。
 */
export function renderTreeHighlight(options: TreeHighlightOptions): Konva.Group | null {
  const {
    tree,
    selectedId,
    selectedEdge,
    selectedBead,
    selectedNodeExists,
    scale,
    beadWidthMm,
    installGap,
  } = options;
  if (!selectedId) return null;

  const layout = layoutTree(tree, { installGap });
  const group = new Konva.Group({ listening: false });

  if (selectedId === 'frame' && selectedEdge) {
    const frame = layout.frame;
    const frameWidth = Math.max(tree.frameWidthMm, 20);
    const band =
      selectedEdge === 'left'
        ? { x: frame.x, y: frame.y, w: frameWidth, h: frame.h }
        : selectedEdge === 'right'
          ? { x: frame.x + frame.w - frameWidth, y: frame.y, w: frameWidth, h: frame.h }
          : selectedEdge === 'top'
            ? { x: frame.x, y: frame.y, w: frame.w, h: frameWidth }
            : { x: frame.x, y: frame.y + frame.h - frameWidth, w: frame.w, h: frameWidth };
    group.add(
      new Konva.Rect({
        ...band,
        fill: 'rgba(22,119,255,0.22)',
        stroke: HIGHLIGHT,
        strokeWidth: 2,
        dash: [8, 5],
        listening: false,
      }),
    );
    return group;
  }

  if (selectedBead) {
    const pane = beadPaneOf(tree, selectedId, layout);
    if (pane && pane.w > 2 && pane.h > 2) {
      const screenScale = 1 / scale;
      const beadWidth = Math.max(1, Math.min(beadWidthMm ?? 15, Math.min(pane.w, pane.h) / 2 - 1));
      group.add(
        new Konva.Rect({
          x: pane.x + beadWidth / 2,
          y: pane.y + beadWidth / 2,
          width: Math.max(1, pane.w - beadWidth),
          height: Math.max(1, pane.h - beadWidth),
          stroke: HIGHLIGHT,
          strokeWidth: beadWidth,
          opacity: 0.5,
          listening: false,
        }),
      );
      group.add(
        new Konva.Rect({
          x: pane.x,
          y: pane.y,
          width: pane.w,
          height: pane.h,
          stroke: HIGHLIGHT,
          strokeWidth: 2 / scale,
          dash: [8, 5],
          listening: false,
        }),
      );
      const tag = new Konva.Label({
        x: pane.x + pane.w / 2,
        y: pane.y,
        opacity: 0.95,
        listening: false,
      });
      tag.add(
        new Konva.Tag({
          fill: HIGHLIGHT,
          pointerDirection: 'down',
          pointerWidth: 8 * screenScale,
          pointerHeight: 5 * screenScale,
          lineThroughOffset: -1,
          cornerRadius: 3 * screenScale,
          shadowColor: 'rgba(0,0,0,0.3)',
          shadowBlur: 3 * screenScale,
        }),
      );
      tag.add(
        new Konva.Text({
          text: '压线',
          fontSize: 13 * screenScale,
          fontStyle: 'bold',
          fill: '#ffffff',
          padding: 3 * screenScale,
        }),
      );
      group.add(tag);
      return group;
    }
  }

  if (!selectedNodeExists) return null;
  const box = layout.boxes.get(selectedId);
  if (!box) return null;
  group.add(
    new Konva.Rect({
      x: box.x - 2,
      y: box.y - 2,
      width: box.w + 4,
      height: box.h + 4,
      stroke: HIGHLIGHT,
      strokeWidth: 2.5 / scale,
      dash: [8, 5],
      listening: false,
    }),
  );
  return group;
}

/** 拼樘/转角料选择 → 已套显示变换的高亮节点。 */
export function renderCombinerHighlight(
  selectedCombinerId: string | null,
  assemblyLayout: AssemblyLayout | null,
  scale: number,
): Konva.Group | null {
  if (!selectedCombinerId || !assemblyLayout) return null;
  const box = assemblyLayout.combiners.get(selectedCombinerId);
  if (!box) return null;

  const group = new Konva.Group({ listening: false });
  group.add(
    new Konva.Rect({
      x: box.x - 2,
      y: box.y - 2,
      width: Math.max(1, box.w + 4),
      height: Math.max(1, box.h + 4),
      stroke: HIGHLIGHT,
      strokeWidth: 2.5 / scale,
      dash: [8, 5],
      listening: false,
    }),
  );
  placeNode(group, assemblyLayout.combinerPlacement.get(selectedCombinerId), { x: box.x, y: box.y });
  return group;
}

/** 选中压线对应的玻璃 pane：外框内腔、固定格整格或开启扇内玻璃。 */
function beadPaneOf(
  tree: WindowTree,
  selectedId: string,
  layout: ReturnType<typeof layoutTree>,
): { x: number; y: number; w: number; h: number } | null {
  if (selectedId === 'frame') {
    const frame = layout.frame;
    const frameWidth = Math.max(tree.frameWidthMm, 20);
    return {
      x: frame.x + frameWidth,
      y: frame.y + frameWidth,
      w: frame.w - 2 * frameWidth,
      h: frame.h - 2 * frameWidth,
    };
  }
  const box = layout.boxes.get(selectedId);
  if (!box) return null;
  const area = findArea(tree, selectedId);
  const inset = area?.sash ? sashWidthOf(tree) : 0;
  return {
    x: box.x + inset,
    y: box.y + inset,
    w: Math.max(1, box.w - 2 * inset),
    h: Math.max(1, box.h - 2 * inset),
  };
}
