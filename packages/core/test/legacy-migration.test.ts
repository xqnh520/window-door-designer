import { test } from 'node:test';
import assert from 'node:assert/strict';
import { series60, type DesignModel } from '@wdd/schema';
import {
  buildDesignModelFromLegacyShapes,
  buildDesignModelFromLegacyShapesWithReport,
  normalizeLegacyShapes,
  normalizeLegacyShapesWithReport,
  type LegacyShape,
} from '../src/legacy-shapes.js';
import { migrateLegacyShapes } from '../src/legacy-migration.js';
import { treeFromDesignModel } from '../src/window-tree-builder.js';
import {
  toDesignModel,
  walkAreas,
  type WindowMuntin,
  type WindowSashSpec,
  type WindowTree,
} from '../src/window-tree.js';
import { arcFromChord, bBoxOf, polygonArea, type Pt } from '../src/outline.js';

const GAP = 20;
const FW = 60;
const DESIGN = {
  id: 'legacy',
  name: 'legacy',
  openingW: 1000,
  openingH: 1000,
  seriesId: series60.id,
  glassId: 'g-5-12a-5',
};
const CTX = { installGap: GAP, name: 'legacy', seriesId: series60.id, glassId: 'g-5-12a-5', frameWidthMm: FW };
const FRAME = { x: 20, y: 20, w: 960, h: 960 };
const INNER = { x: 80, y: 80, w: 840, h: 840 };

function shape(patch: Partial<LegacyShape> & Pick<LegacyShape, 'id' | 'type' | 'bbox'>): LegacyShape {
  return { topRatio: 1, text: '', ...patch } as LegacyShape;
}
function frame(patch: Partial<LegacyShape> = {}): LegacyShape {
  return shape({ id: 'f', type: 'rect', bbox: { ...FRAME }, componentKind: 'outerFrame', ...patch });
}
function panel(patch: Partial<LegacyShape> & Pick<LegacyShape, 'id'>): LegacyShape {
  return shape({ type: 'rect', bbox: { ...INNER }, ...patch });
}
function migrate(shapes: LegacyShape[]): DesignModel {
  const model = buildDesignModelFromLegacyShapes(shapes, { design: DESIGN });
  assert.ok(model, '迁移应成功');
  return model;
}
function treeOf(shapes: LegacyShape[]): { model: DesignModel; tree: WindowTree } {
  const model = migrate(shapes);
  const tree = treeFromDesignModel(model, CTX);
  assert.ok(tree, '反推应成功');
  return { model, tree };
}
function muntinsOf(tree: WindowTree): WindowMuntin[] {
  const out: WindowMuntin[] = [];
  walkAreas(tree, (a) => {
    if (a.children) out.push(a.children[1]);
  });
  return out;
}
function sashesOf(tree: WindowTree): WindowSashSpec[] {
  const out: WindowSashSpec[] = [];
  walkAreas(tree, (a) => {
    if (a.sash) out.push(a.sash);
  });
  return out;
}
function pts(flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
}
function areaOf(flat?: number[]): number {
  return flat && flat.length >= 6 ? Math.abs(polygonArea(pts(flat))) : 0;
}
function approx(actual: number, expected: number, eps: number, label = ''): void {
  assert.ok(Math.abs(actual - expected) <= eps, `${label} ${actual} != ${expected} (±${eps})`);
}
function assertBox(actual: { x: number; y: number; w: number; h: number }, expected: typeof actual, eps = 1): void {
  approx(actual.x, expected.x, eps, 'x');
  approx(actual.y, expected.y, eps, 'y');
  approx(actual.w, expected.w, eps, 'w');
  approx(actual.h, expected.h, eps, 'h');
}

// ── 读取与迁移 ─────────────────────────────────────────────

test('normalize：保留可识别字段，非法条目计入 dropped 而不是静默当空', () => {
  const raw = [
    {
      id: 'f',
      type: 'rect',
      bbox: { x: 20, y: 20, w: 960, h: 960 },
      topRatio: 0.5,
      componentKind: 'outerFrame',
      openSides: ['left', 'right', 'bogus'],
    },
    { id: 'bad-type', type: 'polygon', bbox: { x: 0, y: 0, w: 10, h: 10 } },
    { id: 'bad-box', type: 'rect', bbox: { x: 0, y: 0, w: 0, h: 10 } },
    null,
  ];
  const report = normalizeLegacyShapesWithReport(raw);
  assert.equal(report.shapes.length, 1);
  assert.equal(report.dropped, 3);
  assert.deepEqual(report.shapes[0].openSides, ['left', 'right'], '非法缺边值被过滤');
  assert.equal(report.shapes[0].topRatio, 0.5);
  assert.deepEqual(normalizeLegacyShapes(raw), report.shapes);
});

test('空数据 / 全丢弃：迁移返回 null，报告可区分两种情况', () => {
  assert.equal(buildDesignModelFromLegacyShapes([], { design: DESIGN }), null);
  const report = normalizeLegacyShapesWithReport([{ id: 'x', type: 'polygon', bbox: { x: 0, y: 0, w: 10, h: 10 } }]);
  assert.equal(report.shapes.length, 0);
  assert.equal(report.dropped, 1);
  assert.equal(buildDesignModelFromLegacyShapes(report.shapes, { design: DESIGN }), null);
});

// ── 外框 ──────────────────────────────────────────────────

test('外框：rect / trapezoid / arch / gothic 形状与顶宽比、缺边均保留', () => {
  for (const type of ['trapezoid', 'arch', 'gothic'] as const) {
    const topRatio = type === 'trapezoid' ? 0.55 : 1;
    const model = migrate([frame({ type, topRatio }), panel({ id: 'g' })]);
    const f = model.components.find((c) => c.kind === 'outerFrame')!;
    assert.equal(f.shape, type);
    assert.equal(f.topRatio, type === 'trapezoid' ? 0.55 : undefined);
    assert.equal(f.contour, undefined, '无角点数据时不应凭空造轮廓');
  }
  const sides = migrate([frame({ openSides: ['left', 'right'] }), panel({ id: 'g' })]).components[0];
  assert.deepEqual(sides.openSides, ['left', 'right']);
});

test('外框：拖拽角点 / 自定义轮廓按原始点保留，不被形状采样覆盖', () => {
  const corners = [
    { x: 90, y: 20 },
    { x: 950, y: 20 },
    { x: 960, y: 960 },
    { x: 20, y: 960 },
  ];
  const f = migrate([frame({ corners }), panel({ id: 'g' })]).components[0];
  assert.equal(f.shape, 'rect');
  assert.deepEqual(f.contour, [90, 20, 950, 20, 960, 960, 20, 960]);
});

// ── 中梃 ──────────────────────────────────────────────────

test('竖中梃：bbox 宽度退化为 0 也按中心线 ± 料厚/2 重建，不被误判成横梃', () => {
  const line = shape({
    id: 'v',
    type: 'line',
    bbox: { x: 500, y: 80, w: 0, h: 840 },
    widthMm: 40,
    componentKind: 'mullion',
  });
  const m = migrate([frame(), line]).components.find((c) => c.kind === 'mullion')!;
  assert.equal(m.slope, undefined);
  assert.equal(m.thicknessMm, 40);
  approx(m.x + m.w / 2, 500, 0.01, '中心线 x');
  approx(m.w, 40, 0.01, '料厚');
  approx(m.h, 840, 0.01, '长度');
});

test('横中梃：bbox 高度退化为 0 也按中心线 ± 料厚/2 重建', () => {
  const line = shape({
    id: 'h',
    type: 'line',
    bbox: { x: 80, y: 500, w: 840, h: 0 },
    widthMm: 40,
    componentKind: 'mullion',
  });
  const m = migrate([frame(), line]).components.find((c) => c.kind === 'mullion')!;
  assert.equal(m.slope, undefined);
  approx(m.y + m.h / 2, 500, 0.01, '中心线 y');
  approx(m.h, 40, 0.01, '料厚');
  approx(m.w, 840, 0.01, '长度');
});

test('零尺寸直线：bbox 两维都为 0 时由 p1/p2 恢复中心线，按料厚重建', () => {
  const line = shape({
    id: 'v0',
    type: 'line',
    bbox: { x: 500, y: 920, w: 0, h: 0 },
    p1: { x: 500, y: 80 },
    p2: { x: 500, y: 920 },
    widthMm: 40,
    componentKind: 'mullion',
  });
  const m = migrate([frame(), line]).components.find((c) => c.kind === 'mullion')!;
  assert.equal(m.slope, undefined);
  assert.equal(m.thicknessMm, 40);
  approx(m.x + m.w / 2, 500, 0.01, '中心线 x');
  approx(m.y, 80, 0.01, '起点 y');
  approx(m.h, 840, 0.01, '长度');
});

test('零尺寸直线无法恢复中心线：丢弃并报告 line-geometry-lost', () => {
  const raw = [
    frame(),
    { id: 'lost', type: 'line', bbox: { x: 500, y: 500, w: 0, h: 0 }, widthMm: 40, componentKind: 'mullion' },
  ];
  const report = normalizeLegacyShapesWithReport(raw);
  assert.equal(report.shapes.length, 1, '只有外框可读');
  assert.equal(report.dropped, 1);
  assert.ok(report.issues.some((i) => i.code === 'line-geometry-lost' && i.shapeId === 'lost' && i.critical));
});

test('斜中梃：按 p1/p2 判朝向与真实长度，不按 bbox 宽高推断', () => {
  const diagonal = shape({
    id: 'd',
    type: 'line',
    bbox: { x: 68.8, y: 68.8, w: 862.4, h: 862.4 },
    p1: { x: 80, y: 80 },
    p2: { x: 920, y: 920 },
    widthMm: 30,
    componentKind: 'mullion',
  });
  const m = migrate([frame(), diagonal]).components.find((c) => c.kind === 'mullion')!;
  assert.equal(m.slope, 'diagonal');
  assert.equal(m.thicknessMm, 30);
  assert.equal(m.contour?.length, 8, '斜带轮廓为四边形');
  approx(m.arcLenMm!, Math.hypot(840, 840), 0.1, '真实中心线长度');
  approx(Math.abs(m.w - m.h), 0, 0.01, 'bbox 近正方形（不能据此当横梃）');

  const anti = shape({
    id: 'a',
    type: 'line',
    bbox: { x: 68.8, y: 68.8, w: 862.4, h: 862.4 },
    p1: { x: 920, y: 80 },
    p2: { x: 80, y: 920 },
    widthMm: 30,
    componentKind: 'mullion',
  });
  assert.equal(migrate([frame(), anti]).components.find((c) => c.kind === 'mullion')!.slope, 'antiDiagonal');
});

test('弧中梃：弧高、料厚与真实弧长显式携带，不降级为直梃', () => {
  const line = shape({
    id: 'a',
    type: 'line',
    bbox: { x: 475, y: 80, w: 10, h: 840 },
    p1: { x: 500, y: 80 },
    p2: { x: 500, y: 920 },
    widthMm: 50,
    curve: { sagittaMm: 50 },
    componentKind: 'mullion',
  });
  const m = migrate([frame(), line]).components.find((c) => c.kind === 'mullion')!;
  assert.equal(m.slope, undefined);
  assert.equal(m.sagittaMm, 50);
  assert.equal(m.thicknessMm, 50);
  const arc = arcFromChord({ x: 500, y: 80 }, { x: 500, y: 920 }, 50)!;
  const expected = Math.abs((arc.rMm * arc.sweepDeg * Math.PI) / 180);
  approx(m.arcLenMm!, expected, 1, '弧长');
  assert.ok(m.arcLenMm! > 840, '弧长必须大于弦长');
});

// ── 开启扇 ────────────────────────────────────────────────

test('开启扇：单扇 / 对开 / 上下悬的铰链、开向、叶数与填充物全部保留', () => {
  const single = shape({
    id: 'w1',
    type: 'rect',
    bbox: { ...INNER },
    windowType: 'casement',
    sashes: [{ hingeSide: 'right', openDirection: 'in', rect: { x: 0, y: 0, w: 840, h: 840 }, label: 'A1' }],
  });
  const s1 = migrate([frame(), single]).components.find((c) => c.kind === 'casementSash')!;
  assert.equal(s1.hingeSide, 'right');
  assert.equal(s1.openDirection, 'in');
  assert.equal(s1.label, 'A1');
  assert.equal(s1.leaves, undefined);

  const pair = shape({
    id: 'w2',
    type: 'rect',
    bbox: { ...INNER },
    windowType: 'casement',
    sashes: [
      { hingeSide: 'left', openDirection: 'out', rect: { x: 0, y: 0, w: 410, h: 840 }, label: 'A1' },
      { hingeSide: 'right', openDirection: 'out', rect: { x: 430, y: 0, w: 410, h: 840 }, label: 'A2' },
    ],
  });
  const pairComps = migrate([frame(), pair]).components.filter((c) => c.kind === 'casementSash');
  assert.equal(pairComps.length, 1, '镜像对开合并为一个构件');
  assert.equal(pairComps[0].leaves, 2);
  assert.equal(pairComps[0].meetingWidthMm, 20);
  approx(pairComps[0].w, 840, 0.01, '对开总宽');

  const hung = shape({
    id: 'w3',
    type: 'rect',
    bbox: { ...INNER },
    windowType: 'topHinged',
    sashes: [
      { hingeSide: 'top', openDirection: 'out', rect: { x: 0, y: 0, w: 840, h: 400 }, label: 'T1' },
      { hingeSide: 'bottom', openDirection: 'out', rect: { x: 0, y: 440, w: 840, h: 400 }, label: 'T2' },
    ],
  });
  const hungComps = migrate([frame(), hung]).components.filter((c) => c.kind === 'topHungSash');
  assert.equal(hungComps.length, 2, '上下堆叠不合并为对开');
  assert.deepEqual(hungComps.map((c) => c.hingeSide).sort(), ['bottom', 'top']);
  assert.ok(hungComps.every((c) => c.windowType === 'topHinged' && c.openDirection === 'out'));
});

// ── 迁移 → 容器树 ──────────────────────────────────────────

test('迁移→树：竖 / 横中梃方向、比例、料厚进入容器树', () => {
  const vertical = shape({
    id: 'v',
    type: 'line',
    bbox: { x: 495, y: 80, w: 10, h: 840 },
    p1: { x: 500, y: 80 },
    p2: { x: 500, y: 920 },
    widthMm: 40,
    componentKind: 'mullion',
  });
  const tv = treeOf([frame(), vertical]).tree;
  const [mv] = muntinsOf(tv);
  assert.equal(mv.direction, 'vertical');
  approx(mv.ratio, 0.5, 0.001, '竖梃比例');
  assert.equal(mv.thicknessMm, 40);

  const horizontal = shape({
    id: 'h',
    type: 'line',
    bbox: { x: 80, y: 480, w: 840, h: 40 },
    p1: { x: 80, y: 500 },
    p2: { x: 920, y: 500 },
    widthMm: 40,
    componentKind: 'mullion',
  });
  const [mh] = muntinsOf(treeOf([frame(), horizontal]).tree);
  assert.equal(mh.direction, 'horizontal');
  approx(mh.ratio, 0.5, 0.001, '横梃比例');
  assert.equal(mh.thicknessMm, 40);
});

test('迁移→树：斜中梃切出真实三角子区，面积守恒且按斜带出料', () => {
  const diagonal = shape({
    id: 'd',
    type: 'line',
    bbox: { x: 68.8, y: 68.8, w: 862.4, h: 862.4 },
    p1: { x: 80, y: 80 },
    p2: { x: 920, y: 920 },
    widthMm: 30,
    componentKind: 'mullion',
  });
  const { tree } = treeOf([
    frame(),
    diagonal,
    panel({ id: 'ga', bbox: { x: 600, y: 280, w: 100, h: 100 } }),
    panel({ id: 'gb', bbox: { x: 180, y: 600, w: 100, h: 100 } }),
  ]);
  const [m] = muntinsOf(tree);
  assert.equal(m.direction, 'diagonal');
  assert.equal(m.thicknessMm, 30);
  approx(m.ratio, 0.5, 0.002, '斜带偏移');

  const back = toDesignModel(tree, CTX);
  const mc = back.components.find((c) => c.kind === 'mullion')!;
  assert.equal(mc.slope, 'diagonal');
  assert.equal(mc.thicknessMm, 30);
  assert.ok(mc.arcLenMm! > 1100, `斜带真实长度 ${mc.arcLenMm}`);
  const leaves = back.components.filter((c) => c.kind === 'fixedGlass');
  assert.equal(leaves.length, 2, '斜切后两片玻璃');
  assert.ok(leaves.every((c) => pts(c.contour!).length === 3), '斜切子区为三角形');
  const total = leaves.reduce((s, c) => s + areaOf(c.contour), 0) + areaOf(mc.contour);
  approx(total, 840 * 840, 1, '子区 + 斜带面积守恒');
});

test('迁移→树：弧中梃弧高进入树，回写模型仍为弧带，二次往返不降级', () => {
  const line = shape({
    id: 'a',
    type: 'line',
    bbox: { x: 475, y: 80, w: 10, h: 840 },
    p1: { x: 500, y: 80 },
    p2: { x: 500, y: 920 },
    widthMm: 50,
    curve: { sagittaMm: 50 },
    componentKind: 'mullion',
  });
  const { tree } = treeOf([frame(), line]);
  const [m] = muntinsOf(tree);
  assert.equal(m.direction, 'vertical');
  assert.equal(m.thicknessMm, 50);
  assert.equal(m.curve?.sagittaMm, 50);

  const back = toDesignModel(tree, CTX);
  const mc = back.components.find((c) => c.kind === 'mullion')!;
  assert.equal(mc.sagittaMm, 50);
  assert.equal(mc.slope, undefined, '弧梃不能被当成斜梃');
  assert.ok(mc.arcLenMm! > 840 && mc.arcLenMm! < 870, `弧长 ${mc.arcLenMm}`);

  const tree2 = treeFromDesignModel(back, CTX)!;
  const [m2] = muntinsOf(tree2);
  assert.equal(m2.curve?.sagittaMm, 50);
  assert.equal(m2.thicknessMm, 50);
  approx(m2.ratio, m.ratio, 1e-6, '弧梃比例');
});

test('迁移→树：单扇 → 树 → 模型，铰链 / 开向 / 窗口类型不丢', () => {
  const host = shape({
    id: 'w',
    type: 'rect',
    bbox: { ...INNER },
    windowType: 'casement',
    sashes: [{ hingeSide: 'right', openDirection: 'in', rect: { x: 0, y: 0, w: 840, h: 840 }, label: 'A1' }],
  });
  const { tree } = treeOf([frame(), host]);
  const [s] = sashesOf(tree);
  assert.equal(s.windowType, 'casement');
  assert.equal(s.hingeSide, 'right');
  assert.equal(s.openDirection, 'in');
  assert.equal(s.label, 'A1');

  const c = toDesignModel(tree, CTX).components.find((x) => x.kind === 'casementSash')!;
  assert.equal(c.windowType, 'casement');
  assert.equal(c.hingeSide, 'right');
  assert.equal(c.openDirection, 'in');
  assert.equal(c.label, 'A1');
});

test('迁移→树：对开扇 leaves=2 与中缝宽两次往返后一致', () => {
  const host = shape({
    id: 'w2',
    type: 'rect',
    bbox: { ...INNER },
    windowType: 'casement',
    sashes: [
      { hingeSide: 'left', openDirection: 'out', rect: { x: 0, y: 0, w: 410, h: 840 }, label: 'A1' },
      { hingeSide: 'right', openDirection: 'out', rect: { x: 430, y: 0, w: 410, h: 840 }, label: 'A2' },
    ],
  });
  const model = migrate([frame(), host]);
  assert.equal(model.components.find((c) => c.kind === 'casementSash')!.leaves, 2);

  const tree = treeFromDesignModel(model, CTX)!;
  assert.equal(tree.meetingWidthMm, 20);
  assert.equal(sashesOf(tree)[0].leaves, 2);

  const back = toDesignModel(tree, CTX);
  const leaf = back.components.find((c) => c.leaves === 2)!;
  assert.equal(leaf.meetingWidthMm, 20);
  const tree2 = treeFromDesignModel(back, CTX)!;
  assert.equal(tree2.meetingWidthMm, 20);
  assert.equal(sashesOf(tree2)[0].leaves, 2);
});

test('迁移→树：上下悬两扇各自保留 top / bottom 铰链与上悬类型', () => {
  const host = shape({
    id: 'w3',
    type: 'rect',
    bbox: { ...INNER },
    windowType: 'topHinged',
    sashes: [
      { hingeSide: 'top', openDirection: 'out', rect: { x: 0, y: 0, w: 840, h: 400 }, label: 'T1' },
      { hingeSide: 'bottom', openDirection: 'out', rect: { x: 0, y: 440, w: 840, h: 400 }, label: 'T2' },
    ],
  });
  const { tree } = treeOf([frame(), host]);
  const muntins = muntinsOf(tree);
  assert.equal(muntins.length, 1);
  assert.equal(muntins[0].direction, 'horizontal');
  const sashes = sashesOf(tree);
  assert.equal(sashes.length, 2);
  assert.ok(sashes.every((s) => s.windowType === 'topHinged'));
  assert.deepEqual(sashes.map((s) => s.hingeSide).sort(), ['bottom', 'top']);

  const back = toDesignModel(tree, CTX);
  const kinds = back.components.filter((c) => c.kind === 'topHungSash');
  assert.equal(kinds.length, 2);
  assert.deepEqual(kinds.map((c) => c.hingeSide).sort(), ['bottom', 'top']);
  assert.ok(kinds.every((c) => c.windowType === 'topHinged' && c.openDirection === 'out'));
});

test('迁移→树：对开 + 上玻下板的整窗级参数回填到树并回写模型', () => {
  const model: DesignModel = {
    id: 'kfc',
    name: 'kfc',
    openingW: 1000,
    openingH: 1000,
    seriesId: series60.id,
    glassId: 'g-5-12a-5',
    components: [
      { id: 'f', kind: 'outerFrame', x: 20, y: 20, w: 960, h: 960 },
      {
        id: 'leaf',
        kind: 'casementSash',
        x: 80,
        y: 80,
        w: 840,
        h: 840,
        parentId: 'f',
        windowType: 'casement',
        leaves: 2,
        meetingWidthMm: 75,
        infill: 'panel',
        panelHeightMm: 300,
        hingeSide: 'left',
        openDirection: 'out',
      },
    ],
  };
  const tree = treeFromDesignModel(model, CTX)!;
  assert.equal(tree.meetingWidthMm, 75);
  assert.equal(tree.panelHeightMm, 300);
  const [s] = sashesOf(tree);
  assert.equal(s.leaves, 2);
  assert.equal(s.infill, 'panel');

  const back = toDesignModel(tree, CTX);
  const leaf = back.components.find((c) => c.leaves === 2)!;
  assert.equal(leaf.meetingWidthMm, 75);
  assert.equal(leaf.infill, 'panel');
  assert.equal(leaf.panelHeightMm, 300);
});

// ── 二次往返（防重复迁移/缩框） ────────────────────────────

test('迁移→树→模型→树：梯形 / 拱形 / 尖拱二次往返不再缩框', () => {
  for (const type of ['trapezoid', 'arch', 'gothic'] as const) {
    const topRatio = type === 'trapezoid' ? 0.55 : 1;
    const { tree } = treeOf([frame({ type, topRatio }), panel({ id: 'g' })]);
    assert.equal(tree.frameShape, type);
    if (type === 'trapezoid') approx(tree.topRatio!, 0.55, 1e-9);
    assert.equal(tree.frameContour, undefined, '形状采样口径不写自定义轮廓');

    const back1 = toDesignModel(tree, CTX);
    const tree2 = treeFromDesignModel(back1, CTX)!;
    assert.equal(tree2.frameShape, type);
    const back2 = toDesignModel(tree2, CTX);
    const f1 = back1.components[0];
    const f2 = back2.components[0];
    assertBox(f2, f1, 0.001);
    assert.equal(f2.shape, f1.shape);
    if (f1.contour && f2.contour) {
      assertBox(bBoxOf(pts(f2.contour)), bBoxOf(pts(f1.contour)), 0.01);
    }
  }
});

test('迁移→树：自定义外轮廓逐点保持，二次往返不漂移', () => {
  const corners = [
    { x: 90, y: 20 },
    { x: 950, y: 20 },
    { x: 980, y: 980 },
    { x: 20, y: 980 },
  ];
  const { tree } = treeOf([frame({ corners }), panel({ id: 'g' })]);
  assert.deepEqual(tree.frameContour, [
    { x: 70, y: 0 },
    { x: 930, y: 0 },
    { x: 960, y: 960 },
    { x: 0, y: 960 },
  ]);

  const back1 = toDesignModel(tree, CTX);
  assert.deepEqual(back1.components[0].contour, [90, 20, 950, 20, 980, 980, 20, 980]);
  const tree2 = treeFromDesignModel(back1, CTX)!;
  assert.deepEqual(tree2.frameContour, tree.frameContour);
  const back2 = toDesignModel(tree2, CTX);
  assert.deepEqual(back2.components[0].contour, back1.components[0].contour);
});

test('迁移→树：缺边进入树并回写模型', () => {
  const { tree } = treeOf([frame({ openSides: ['left', 'right'] }), panel({ id: 'g' })]);
  assert.deepEqual(tree.frameOpenSides, ['left', 'right']);
  assert.deepEqual(toDesignModel(tree, CTX).components[0].openSides, ['left', 'right']);
});

test('竖梃分格 + 固定/平开：二次往返几何与业务属性不漂移', () => {
  const shapes = [
    frame(),
    shape({
      id: 'v',
      type: 'line',
      bbox: { x: 495, y: 80, w: 10, h: 840 },
      p1: { x: 500, y: 80 },
      p2: { x: 500, y: 920 },
      widthMm: 40,
      componentKind: 'mullion',
    }),
    panel({ id: 'gl', bbox: { x: 80, y: 80, w: 400, h: 840 } }),
    shape({
      id: 'wr',
      type: 'rect',
      bbox: { x: 520, y: 80, w: 400, h: 840 },
      windowType: 'casement',
      sashes: [{ hingeSide: 'left', openDirection: 'out', rect: { x: 0, y: 0, w: 400, h: 840 }, label: 'A1' }],
    }),
  ];
  const { tree: t1 } = treeOf(shapes);
  const m1 = toDesignModel(t1, CTX);
  const t2 = treeFromDesignModel(m1, CTX)!;
  const m2 = toDesignModel(t2, CTX);

  const [a] = muntinsOf(t1);
  const [b] = muntinsOf(t2);
  assert.equal(b.direction, a.direction);
  assert.equal(b.thicknessMm, a.thicknessMm);
  approx(b.ratio, a.ratio, 1e-6, '中梃比例');

  const f1 = m1.components[0];
  const f2 = m2.components[0];
  assertBox(f2, f1, 0.001);

  const leavesOf = (m: DesignModel) =>
    m.components
      .filter((c) => c.kind !== 'outerFrame' && c.kind !== 'mullion')
      .map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h, kind: c.kind, label: c.label }))
      .sort((p, q) => p.x - q.x || p.y - q.y);
  const l1 = leavesOf(m1);
  const l2 = leavesOf(m2);
  assert.equal(l2.length, l1.length);
  l1.forEach((leaf, i) => {
    assertBox(l2[i], leaf, 1);
    assert.equal(l2[i].kind, leaf.kind);
    assert.equal(l2[i].label, leaf.label);
  });
  const c1 = m1.components.find((c) => c.kind === 'casementSash')!;
  const c2 = m2.components.find((c) => c.kind === 'casementSash')!;
  assert.equal(c2.hingeSide, c1.hingeSide);
  assert.equal(c2.openDirection, c1.openDirection);
  assert.equal(c2.label, c1.label);
});

// ── 多外框 / 部分迁移 ─────────────────────────────────────

const MIGRATE_OPTS = { installGap: GAP, frameWidthMm: FW };

test('多个外框：逐框建树，并按旧图真实间隙还原拼樘', () => {
  const shapes = [
    shape({ id: 'fa', type: 'rect', bbox: { x: 20, y: 20, w: 460, h: 960 }, componentKind: 'outerFrame' }),
    panel({ id: 'ga', bbox: { x: 80, y: 80, w: 340, h: 840 } }),
    shape({ id: 'fb', type: 'rect', bbox: { x: 520, y: 20, w: 460, h: 960 }, componentKind: 'outerFrame' }),
    panel({ id: 'gb', bbox: { x: 580, y: 80, w: 340, h: 840 } }),
  ];
  const res = migrateLegacyShapes(shapes, { design: DESIGN }, MIGRATE_OPTS);
  assert.equal(res.complete, true);
  assert.ok(res.assembly, '应反推出装配体');
  assert.equal(res.assembly!.units.length, 2, '两个外框都必须恢复，不能只取第一个');
  assert.equal(res.assembly!.combiners.length, 1);
  assert.equal(res.assembly!.combiners[0].thicknessMm, 40, '拼樘厚度按旧图真实间隙还原');
  const leafCounts = res.assembly!.units.map(
    (u) => toDesignModel(u.tree, CTX).components.filter((c) => c.kind !== 'outerFrame').length,
  );
  assert.deepEqual(leafCounts, [1, 1], '每框各自保留自己的分格');
  assert.equal(res.assembly!.units[0].tree.openingW, 500);
  assert.equal(res.assembly!.units[1].tree.openingW, 500);
});

test('多个外框拼接关系不可证明：不猜，返回 null + 诊断', () => {
  const shapes = [
    shape({ id: 'fa', type: 'rect', bbox: { x: 20, y: 20, w: 460, h: 960 }, componentKind: 'outerFrame' }),
    shape({ id: 'fb', type: 'rect', bbox: { x: 700, y: 700, w: 460, h: 960 }, componentKind: 'outerFrame' }),
  ];
  const res = migrateLegacyShapes(shapes, { design: DESIGN }, MIGRATE_OPTS);
  assert.equal(res.assembly, null);
  assert.equal(res.complete, false);
  assert.ok(res.issues.some((i) => i.critical && (i.code === 'frames-not-linear' || i.code === 'frames-not-joined')));
});

test('有效图形与无效图形混合导入：诊断必须为 critical，不能当完整迁移', () => {
  const raw = [
    frame(),
    panel({ id: 'g' }),
    { id: 'bad', type: 'polygon', bbox: { x: 0, y: 0, w: 10, h: 10 } },
  ];
  const report = normalizeLegacyShapesWithReport(raw);
  assert.equal(report.shapes.length, 2);
  assert.equal(report.dropped, 1);
  assert.ok(report.issues.some((i) => i.critical));
  const res = migrateLegacyShapes(report.shapes, { design: DESIGN }, MIGRATE_OPTS);
  const all = [...report.issues, ...res.issues];
  assert.ok(all.some((i) => i.critical), '调用方必须合并规范化诊断后才能判断完整性');
  assert.ok(res.assembly, '可识别的部分仍能构建，供用户确认后采用');
});

test('不规则分格：产出 panel-contour-unsupported 诊断，不静默改形', () => {
  const irregular = panel({
    id: 'irregular',
    contour: [
      { x: 80, y: 80 },
      { x: 900, y: 80 },
      { x: 900, y: 600 },
      { x: 500, y: 920 },
      { x: 80, y: 920 },
    ],
  });
  const built = buildDesignModelFromLegacyShapesWithReport([frame(), irregular], { design: DESIGN });
  assert.ok(built.model);
  assert.ok(built.issues.some((i) => i.code === 'panel-contour-unsupported' && i.critical));
  const res = migrateLegacyShapes([frame(), irregular], { design: DESIGN }, MIGRATE_OPTS);
  assert.equal(res.complete, false);
});
