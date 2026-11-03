import Konva from 'konva';
import {
  layoutTree,
  type AssemblyLayout,
  type WindowAssembly,
  type WindowTree,
} from '@wdd/core';

/** 尺寸标注标记（加工空间坐标）。 */
export interface DimMark {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface DimensionGaps {
  width: number;
  height: number;
}

export interface DimensionRenderOptions {
  tree: WindowTree;
  assembly: WindowAssembly | null;
  assemblyLayout: AssemblyLayout | null;
  selectedId: string | null;
  scale: number;
  gaps: DimensionGaps;
  rotated: boolean;
  installGap: number;
  onDimEdit?: (markId: string) => void;
  /** 仅回传标注自身的视图状态；不得借此修改 WindowTree/WindowAssembly。 */
  onGapsChange: (gaps: DimensionGaps) => void;
}

export interface DimensionRenderResult {
  group: Konva.Group;
  marks: DimMark[];
}

const DIM_COLOR = '#333333';
const DIM_FRAME_FONT = 24;
const DIM_CELL_FONT = 15;
export const DIM_FRAME_GAP = 40;
const DIM_CELL_GAP = 14;
const DIM_MIN_GAP = 20;

interface PushDimOptions {
  layer: Konva.Group;
  marks: DimMark[];
  id: string;
  orient: 'horizontal' | 'vertical';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  fontSize: number;
  draggable: boolean;
  scale: number;
  gaps: DimensionGaps;
  onDimEdit?: (markId: string) => void;
  onGapsChange: (gaps: DimensionGaps) => void;
}

/**
 * 构造 CAD 尺寸线。该函数只物化 Konva 节点；业务尺寸修改必须经 onDimEdit
 * 回到控制器/store，标注拖拽也只更新 renderer 自身的间距状态。
 */
function pushDimCad(opts: PushDimOptions): void {
  const {
    layer,
    marks,
    id,
    orient,
    x1,
    y1,
    x2,
    y2,
    fontSize,
    draggable,
    scale,
    gaps,
    onDimEdit,
    onGapsChange,
  } = opts;
  const s = 1 / scale;
  const fontWorld = fontSize * s;
  const lineWidth = 2.2 * s;
  const tick = 8 * s;
  const pad = 9 * s;

  const value = Math.round(orient === 'horizontal' ? x2 - x1 : y2 - y1);
  const text = new Konva.Text({
    text: `${value}`,
    fontSize: fontWorld,
    fontStyle: 'bold',
    fill: DIM_COLOR,
    align: 'center',
    listening: true,
  });
  if (orient === 'vertical') text.rotation(-90);

  const half = text.width() / 2 + pad;
  const start = orient === 'horizontal' ? x1 : y1;
  const end = orient === 'horizontal' ? x2 : y2;
  const mid = (start + end) / 2;

  marks.push({
    id,
    x: orient === 'horizontal' ? mid : x1,
    y: orient === 'horizontal' ? y1 : mid,
    text: `${value}`,
  });

  const group = new Konva.Group({ listening: true, draggable });
  const addSegment = (a: number, b: number): void => {
    if (b - a < 1) return;
    group.add(
      new Konva.Line({
        points: orient === 'horizontal' ? [a, y1, b, y1] : [x1, a, x1, b],
        stroke: DIM_COLOR,
        strokeWidth: lineWidth,
        listening: false,
      }),
    );
  };
  addSegment(start, mid - half);
  addSegment(mid + half, end);

  if (orient === 'horizontal') {
    group.add(new Konva.Line({ points: [start, y1 - tick, start, y1 + tick], stroke: DIM_COLOR, strokeWidth: lineWidth, listening: false }));
    group.add(new Konva.Line({ points: [end, y1 - tick, end, y1 + tick], stroke: DIM_COLOR, strokeWidth: lineWidth, listening: false }));
  } else {
    group.add(new Konva.Line({ points: [x1 - tick, start, x1 + tick, start], stroke: DIM_COLOR, strokeWidth: lineWidth, listening: false }));
    group.add(new Konva.Line({ points: [x1 - tick, end, x1 + tick, end], stroke: DIM_COLOR, strokeWidth: lineWidth, listening: false }));
  }

  text.x(orient === 'horizontal' ? mid : x1);
  text.y(orient === 'horizontal' ? y1 : mid);
  text.offsetX(text.width() / 2);
  text.offsetY(text.height() / 2);
  text.on('click', () => onDimEdit?.(id));
  text.setAttr('cursor', 'pointer');

  const axis = orient === 'horizontal' ? 'y' : 'x';
  group.on('dragmove', () => {
    if (axis === 'y') group.y(Math.max(DIM_MIN_GAP, group.y()));
    else group.x(Math.max(DIM_MIN_GAP, group.x()));
  });
  let startPos = 0;
  group.on('dragstart', () => {
    startPos = axis === 'y' ? group.y() : group.x();
  });
  group.on('dragend', () => {
    if (!draggable) return;
    const delta = (axis === 'y' ? group.y() - startPos : group.x() - startPos) / scale;
    onGapsChange(
      axis === 'y'
        ? { ...gaps, width: Math.max(DIM_MIN_GAP, gaps.width + delta) }
        : { ...gaps, height: Math.max(DIM_MIN_GAP, gaps.height + delta) },
    );
  });

  group.add(text);
  layer.add(group);
}

function renderCombinerLabels(
  layer: Konva.Group,
  assembly: WindowAssembly,
  assemblyLayout: AssemblyLayout,
  scale: number,
): void {
  const s = 1 / scale;
  for (const combiner of assembly.combiners) {
    const box = assemblyLayout.combiners.get(combiner.id);
    if (!box) continue;

    const label = combiner.axis === 'x' && combiner.angleDeg !== 180 ? '转角料' : '连接件';
    const value = `${label}(${Math.round(combiner.thicknessMm)})`;
    const fontSize = 14 * s;
    const textX = box.x + box.w / 2;
    const textY = box.y - 20 * s;
    const group = new Konva.Group({ listening: false });

    group.add(
      new Konva.Line({
        points: [textX, textY + fontSize, textX, box.y],
        stroke: DIM_COLOR,
        strokeWidth: 1.5 * s,
        listening: false,
      }),
    );

    const text = new Konva.Text({
      text: value,
      fontSize,
      fontStyle: 'bold',
      fill: DIM_COLOR,
      align: 'center',
      listening: false,
    });
    text.x(textX);
    text.y(textY);
    text.offsetX(text.width() / 2);
    text.offsetY(text.height());
    group.add(text);
    layer.add(group);
  }
}

function renderAngleLabels(
  layer: Konva.Group,
  assembly: WindowAssembly,
  assemblyLayout: AssemblyLayout,
  scale: number,
): void {
  const s = 1 / scale;
  for (let index = 1; index < assembly.units.length; index++) {
    const previous = assembly.units[index - 1];
    const current = assembly.units[index];
    const combiner = assembly.combiners.find(
      (candidate) =>
        (candidate.between[0] === previous.id && candidate.between[1] === current.id) ||
        (candidate.between[1] === previous.id && candidate.between[0] === current.id),
    );
    if (!combiner || combiner.angleDeg === 180) continue;

    const previousFrame = assemblyLayout.units.get(previous.id)?.frame;
    const currentFrame = assemblyLayout.units.get(current.id)?.frame;
    if (!previousFrame || !currentFrame) continue;

    const cornerX = currentFrame.x;
    const cornerY = currentFrame.y;
    const group = new Konva.Group({ listening: false });
    group.add(
      new Konva.Arc({
        x: cornerX,
        y: cornerY,
        outerRadius: 20 * s,
        angle: 0,
        innerRadius: 0,
        fill: 'rgba(51, 51, 51, 0.3)',
        listening: false,
      }),
    );
    group.add(
      new Konva.Text({
        x: cornerX + 30 * s,
        y: cornerY + 30 * s,
        text: `${combiner.angleDeg.toFixed(1)}°`,
        fontSize: 16 * s,
        fontStyle: 'bold',
        fill: DIM_COLOR,
        listening: false,
      }),
    );
    layer.add(group);
  }
}

/** WindowTree/WindowAssembly 快照 → 尺寸标注 Konva 图。 */
export function renderDimensions(options: DimensionRenderOptions): DimensionRenderResult {
  const group = new Konva.Group({ listening: true });
  const marks: DimMark[] = [];
  const layout = layoutTree(options.tree, { installGap: options.installGap });
  const frame = layout.frame;
  const draggable = !options.rotated;
  const common = {
    layer: group,
    marks,
    scale: options.scale,
    gaps: options.gaps,
    onDimEdit: options.onDimEdit,
    onGapsChange: options.onGapsChange,
  };

  pushDimCad({
    ...common,
    id: 'frame-w',
    orient: 'horizontal',
    x1: frame.x,
    y1: frame.y - options.gaps.width,
    x2: frame.x + frame.w,
    y2: frame.y - options.gaps.width,
    fontSize: DIM_FRAME_FONT,
    draggable,
  });
  pushDimCad({
    ...common,
    id: 'frame-h',
    orient: 'vertical',
    x1: frame.x - options.gaps.height,
    y1: frame.y,
    x2: frame.x - options.gaps.height,
    y2: frame.y + frame.h,
    fontSize: DIM_FRAME_FONT,
    draggable,
  });

  if (options.selectedId) {
    const box = layout.boxes.get(options.selectedId);
    if (box) {
      pushDimCad({
        ...common,
        id: `${options.selectedId}-w`,
        orient: 'horizontal',
        x1: box.x + DIM_CELL_GAP,
        y1: box.y + box.h + DIM_CELL_GAP,
        x2: box.x + box.w - DIM_CELL_GAP,
        y2: box.y + box.h + DIM_CELL_GAP,
        fontSize: DIM_CELL_FONT,
        draggable: false,
      });
      pushDimCad({
        ...common,
        id: `${options.selectedId}-h`,
        orient: 'vertical',
        x1: box.x + box.w + DIM_CELL_GAP,
        y1: box.y + DIM_CELL_GAP,
        x2: box.x + box.w + DIM_CELL_GAP,
        y2: box.y + box.h - DIM_CELL_GAP,
        fontSize: DIM_CELL_FONT,
        draggable: false,
      });
    }
  }

  if (options.assembly && options.assemblyLayout) {
    renderCombinerLabels(group, options.assembly, options.assemblyLayout, options.scale);
    renderAngleLabels(group, options.assembly, options.assemblyLayout, options.scale);
  }

  return { group, marks };
}
