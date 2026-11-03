import { test } from 'node:test';
import assert from 'node:assert/strict';
import { series60 } from '@wdd/schema';
import { createWindowTree, splitArea, type WindowTree } from '../src/window-tree.js';
import {
  addLinearUnit,
  assemblyFromWindowTree,
  layoutAssembly,
  toDesignModelAssembly,
  type WindowAssembly,
} from '../src/window-assembly.js';
import { applyPlacement, transformBox, type UnitPlacement } from '../src/window-assembly-corner.js';
import {
  assemblySize,
  assemblyToShapes,
  isIdentityPlacement,
  transformShapeForDisplay,
} from '../src/assembly-display-shapes.js';
import { polygonArea, polygonLen, sampleOutline, type Pt } from '../src/outline.js';
import type { LegacyShape } from '../src/legacy-shapes.js';

const GAP = 20;
const FW = 60;
const CTX = { installGap: GAP, name: 'display', seriesId: series60.id, glassId: 'g-5-12a-5' };

function tree(
  w = 1000,
  h = 1000,
  extra: { frameShape?: WindowTree['frameShape']; topRatio?: number } = {},
): WindowTree {
  return createWindowTree({
    openingW: w,
    openingH: h,
    seriesId: series60.id,
    glassId: 'g-5-12a-5',
    frameWidthMm: FW,
    name: '单元',
    ...extra,
  });
}
function splitTree(): WindowTree {
  const t = tree();
  splitArea(t, t.root!.id, 'vertical', 0.5, 40);
  return t;
}
function arcTree(): WindowTree {
  const t = tree();
  splitArea(t, t.root!.id, 'vertical', 0.5, 40, 50);
  return t;
}
function assemblyOf(trees: WindowTree[], angles: number[]): WindowAssembly {
  let a = assemblyFromWindowTree(trees[0]);
  for (let i = 1; i < trees.length; i++) {
    a = addLinearUnit(a, {
      anchorUnitId: a.units[i - 1].id,
      axis: 'x',
      tree: trees[i],
      thicknessMm: 40,
      angleDeg: angles[i - 1],
    }).assembly;
  }
  return a;
}
function pts(points: Array<{ x: number; y: number }>): Pt[] {
  return points.map((p) => ({ x: p.x, y: p.y }));
}
function approx(actual: number, expected: number, eps: number, label = ''): void {
  assert.ok(Math.abs(actual - expected) <= eps, `${label} ${actual} != ${expected} (±${eps})`);
}
function approxPoint(actual: Pt, expected: Pt, eps = 0.002): void {
  approx(actual.x, expected.x, eps, 'x');
  approx(actual.y, expected.y, eps, 'y');
}
function approxBox(actual: LegacyShape['bbox'], expected: LegacyShape['bbox'], eps = 0.002): void {
  approx(actual.x, expected.x, eps, 'x');
  approx(actual.y, expected.y, eps, 'y');
  approx(actual.w, expected.w, eps, 'w');
  approx(actual.h, expected.h, eps, 'h');
}
function byId(shapes: LegacyShape[], id: string): LegacyShape {
  const found = shapes.find((s) => s.id === id);
  assert.ok(found, `缺少图形 ${id}`);
  return found;
}
function unitShape(shapes: LegacyShape[], unitId: string, internalId: string): LegacyShape {
  return byId(shapes, `${unitId}__${internalId}`);
}

// ── 180° 基准：显示 ≡ 加工 ─────────────────────────────────

test('180° 直线：显示与加工逐字段一致，BOM 输入与装配体均未被修改', () => {
  const a = assemblyOf([splitTree(), splitTree()], [180]);
  const bomBefore = toDesignModelAssembly(a, CTX);
  const snapshot = JSON.stringify(a);
  const layout = layoutAssembly(a, { installGap: GAP });

  for (const p of layout.placement.values()) assert.equal(isIdentityPlacement(p), true);
  assert.deepEqual(layout.displayBbox, layout.bbox);
  assert.deepEqual(assemblySize(a), {
    w: Math.round(layout.bbox.x + layout.bbox.w + GAP),
    h: Math.round(layout.bbox.y + layout.bbox.h + GAP),
  });

  const proc = assemblyToShapes(a, series60, { space: 'processing' });
  const disp = assemblyToShapes(a, series60);
  assert.deepEqual(disp, proc, '180° 时显示输出与加工输出完全一致');
  assert.ok(disp.length > 4);
  assert.equal(
    disp.every((s) => !s.contour || s.type !== 'rect'),
    true,
    '恒等变换不得把矩形改写成轮廓',
  );
  assert.equal(JSON.stringify(a), snapshot, '不得修改原装配体');
  assert.deepEqual(toDesignModelAssembly(a, CTX), bomBefore, 'BOM / 下料输入不变');
});

// ── 90° 转角 ──────────────────────────────────────────────

test('90° 转角：单元绕铰点旋转，框为真实四边形，拼樘随上游腿贴合', () => {
  const a = assemblyOf([splitTree(), splitTree()], [90]);
  const [u1, u2] = a.units;
  const layout = layoutAssembly(a, { installGap: GAP });
  const p1 = layout.placement.get(u1.id)!;
  const p2 = layout.placement.get(u2.id)!;

  // 真实数值：锚腿仅做归一化平移；第二腿 -90° 旋转
  assert.equal(p1.rotationDeg, 0);
  approxPoint(p1.translate, { x: 0, y: 960 }, 1e-6);
  assert.equal(p2.rotationDeg, -90);
  approxPoint(p2.translate, { x: 1000, y: 2000 }, 1e-6);
  approxBox(layout.displayBbox, { x: 20, y: 20, w: 1960, h: 1920 }, 1e-6);
  assert.deepEqual(assemblySize(a), { w: 2000, h: 1960 });

  const proc = assemblyToShapes(a, series60, { space: 'processing' });
  const disp = assemblyToShapes(a, series60);
  const f1p = unitShape(proc, u1.id, 'sh-frame-1');
  const f2p = unitShape(proc, u2.id, 'sh-frame-1');
  const f1 = unitShape(disp, u1.id, 'sh-frame-1');
  const f2 = unitShape(disp, u2.id, 'sh-frame-1');

  approxBox(f1.bbox, {
    x: f1p.bbox.x + p1.translate.x,
    y: f1p.bbox.y + p1.translate.y,
    w: f1p.bbox.w,
    h: f1p.bbox.h,
  });
  const frame2 = layout.units.get(u2.id)!.frame;
  approxBox(f2.bbox, transformBox(p2, frame2));
  assert.equal(f2.contour?.length, 4, '旋转矩形转成真实四边形');
  approx(Math.abs(polygonArea(pts(f2.contour!))), frame2.w * frame2.h, 0.5, '旋转不改变面积');
  approx(polygonLen(pts(f2.contour!)), 2 * (frame2.w + frame2.h), 0.5, '旋转不改变周长');

  const corners = [
    { x: f2p.bbox.x, y: f2p.bbox.y },
    { x: f2p.bbox.x + f2p.bbox.w, y: f2p.bbox.y },
    { x: f2p.bbox.x + f2p.bbox.w, y: f2p.bbox.y + f2p.bbox.h },
    { x: f2p.bbox.x, y: f2p.bbox.y + f2p.bbox.h },
  ];
  f2.contour!.forEach((pt, i) => approxPoint(pt, applyPlacement(p2, corners[i])));

  // 中梃端点同样走 placement
  const m2p = byId(proc, `${u2.id}__sh-mullion-2`);
  const m2 = byId(disp, `${u2.id}__sh-mullion-2`);
  approxPoint(m2.p1!, applyPlacement(p2, m2p.p1!));
  approxPoint(m2.p2!, applyPlacement(p2, m2p.p2!));
  assert.equal(m2.widthMm, m2p.widthMm);

  // 拼樘随上游腿：左缘贴上游框右缘、跨满上游框高
  const c = a.combiners[0];
  const cp = layout.combinerPlacement.get(c.id)!;
  const combP = byId(proc, c.id);
  const comb = byId(disp, c.id);
  approxPoint(comb.p1!, applyPlacement(cp, combP.p1!));
  approxPoint(comb.p2!, applyPlacement(cp, combP.p2!));
  approxBox(comb.bbox, transformBox(cp, layout.combiners.get(c.id)!));
  assert.equal(comb.widthMm, c.thicknessMm);
  approx(comb.bbox.x, f1.bbox.x + f1.bbox.w, 0.01, '拼樘左缘贴上游框右缘');
  approx(comb.bbox.y, f1.bbox.y, 0.01, '拼樘顶对齐上游框顶');
  approx(comb.bbox.h, f1.bbox.h, 0.01, '拼樘跨满上游框高');

  // 下游腿铰点 = 下游框角，且落在拼樘厚度范围内、与拼樘顶缘同高
  const pivot = applyPlacement(p2, { x: frame2.x, y: frame2.y });
  assert.ok(
    f2.contour!.some((pt) => Math.abs(pt.x - pivot.x) < 0.01 && Math.abs(pt.y - pivot.y) < 0.01),
    '下游框角等于铰点',
  );
  assert.ok(pivot.x >= comb.bbox.x - 0.01 && pivot.x <= comb.bbox.x + comb.bbox.w + 0.01, '铰点落在拼樘厚度内');
  approx(pivot.y, comb.bbox.y, 0.01, '铰点与拼樘顶缘同高');
});

// ── 135° 转角 ─────────────────────────────────────────────

test('135° 转角：45° 旋转、铰点附着拼樘顶缘，全部构件落在显示外接内', () => {
  const a = assemblyOf([splitTree(), splitTree()], [135]);
  const [u1, u2] = a.units;
  const layout = layoutAssembly(a, { installGap: GAP });
  const p2 = layout.placement.get(u2.id)!;
  approx(p2.rotationDeg, -45, 1e-9, '旋转角');

  const proc = assemblyToShapes(a, series60, { space: 'processing' });
  const disp = assemblyToShapes(a, series60);
  const f2p = unitShape(proc, u2.id, 'sh-frame-1');
  const f2 = unitShape(disp, u2.id, 'sh-frame-1');
  const frame2 = layout.units.get(u2.id)!.frame;
  approxBox(f2.bbox, transformBox(p2, frame2));
  approx(Math.abs(polygonArea(pts(f2.contour!))), frame2.w * frame2.h, 0.5, '面积守恒');

  const corners = [
    { x: f2p.bbox.x, y: f2p.bbox.y },
    { x: f2p.bbox.x + f2p.bbox.w, y: f2p.bbox.y },
    { x: f2p.bbox.x + f2p.bbox.w, y: f2p.bbox.y + f2p.bbox.h },
    { x: f2p.bbox.x, y: f2p.bbox.y + f2p.bbox.h },
  ];
  f2.contour!.forEach((pt, i) => approxPoint(pt, applyPlacement(p2, corners[i])));

  // 显示外接必须包住所有构件（不含负坐标越界）
  for (const s of disp) {
    assert.ok(s.bbox.x >= layout.displayBbox.x - 0.01, `${s.id} 左缘越界`);
    assert.ok(s.bbox.y >= layout.displayBbox.y - 0.01, `${s.id} 上缘越界`);
    assert.ok(s.bbox.x + s.bbox.w <= layout.displayBbox.x + layout.displayBbox.w + 0.01, `${s.id} 右缘越界`);
    assert.ok(s.bbox.y + s.bbox.h <= layout.displayBbox.y + layout.displayBbox.h + 0.01, `${s.id} 下缘越界`);
  }

  // 铰点与拼樘顶缘相接
  const pivot = applyPlacement(p2, { x: frame2.x, y: frame2.y });
  const c = a.combiners[0];
  const comb = byId(disp, c.id);
  approx(pivot.y, comb.bbox.y, 0.01, '铰点与拼樘顶缘等高');
  assert.ok(pivot.x >= comb.bbox.x - 0.01 && pivot.x <= comb.bbox.x + comb.bbox.w + 0.01, '铰点落在拼樘厚度内');
  const f1 = unitShape(disp, u1.id, 'sh-frame-1');
  approx(comb.bbox.x, f1.bbox.x + f1.bbox.w, 0.01, '拼樘左缘贴上游框右缘');
});

// ── 多单元链 180 → 90 → 135 ────────────────────────────────

test('多单元链 180→90→135：旋转逐段叠加、铰点不动、各单元按自身 placement 变换', () => {
  const a = assemblyOf([splitTree(), splitTree(), tree(), tree()], [180, 90, 135]);
  const layout = layoutAssembly(a, { installGap: GAP });
  const rotations = a.units.map((u) => layout.placement.get(u.id)!.rotationDeg);
  assert.equal(rotations.length, 4);
  approx(rotations[0], 0, 1e-9);
  approx(rotations[1], 0, 1e-9);
  approx(rotations[2], -90, 1e-9);
  approx(rotations[3], -135, 1e-9);

  for (let i = 1; i < a.units.length; i++) {
    const pivot = { x: layout.units.get(a.units[i].id)!.frame.x, y: layout.units.get(a.units[i].id)!.frame.y };
    approxPoint(
      applyPlacement(layout.placement.get(a.units[i].id)!, pivot),
      applyPlacement(layout.placement.get(a.units[i - 1].id)!, pivot),
    );
  }

  const disp = assemblyToShapes(a, series60);
  a.units.forEach((u) => {
    const f = unitShape(disp, u.id, 'sh-frame-1');
    const frame = layout.units.get(u.id)!.frame;
    approxBox(f.bbox, transformBox(layout.placement.get(u.id)!, frame));
  });
  assert.deepEqual(assemblySize(a), {
    w: Math.round(layout.displayBbox.x + layout.displayBbox.w + GAP),
    h: Math.round(layout.displayBbox.y + layout.displayBbox.h + GAP),
  });
});

// ── 异形单元转角 ──────────────────────────────────────────

test('异形单元转角：梯形 / 拱形轮廓随 placement 刚体变换，面积周长守恒且不越界', () => {
  for (const shape of ['trapezoid', 'arch'] as const) {
    const irregular = tree(1000, 1000, { frameShape: shape, topRatio: 0.5 });
    const a = assemblyOf([tree(), irregular], [90]);
    const layout = layoutAssembly(a, { installGap: GAP });
    const u2 = a.units[1];
    const p2 = layout.placement.get(u2.id)!;
    const proc = assemblyToShapes(a, series60, { space: 'processing' });
    const disp = assemblyToShapes(a, series60);
    const fp = unitShape(proc, u2.id, 'sh-frame-1');
    const f = unitShape(disp, u2.id, 'sh-frame-1');

    assert.equal(f.type, shape);
    if (shape === 'trapezoid') approx(f.topRatio, 0.5, 1e-9, '顶宽比');
    const sourcePts = sampleOutline(shape, fp.bbox, { inset: 0, topRatio: fp.topRatio });
    assert.equal(f.contour?.length, sourcePts.length, '轮廓采样点不得丢弃');
    f.contour!.forEach((pt, i) => approxPoint(pt, applyPlacement(p2, sourcePts[i])));
    approx(Math.abs(polygonArea(pts(f.contour!))), Math.abs(polygonArea(sourcePts)), 0.5, '面积守恒');
    approx(polygonLen(pts(f.contour!)), polygonLen(sourcePts), 0.5, '周长守恒');
    approxBox(f.bbox, transformBox(p2, fp.bbox));

    assert.ok(f.bbox.x >= layout.displayBbox.x - 0.01);
    assert.ok(f.bbox.y >= layout.displayBbox.y - 0.01);
    assert.ok(f.bbox.x + f.bbox.w <= layout.displayBbox.x + layout.displayBbox.w + 0.01);
    assert.ok(f.bbox.y + f.bbox.h <= layout.displayBbox.y + layout.displayBbox.h + 0.01);

    assert.equal(irregular.frameShape, shape, '不得修改原树');
    assert.equal(irregular.frameContour, undefined);
  }
});

// ── 弧梃转角 ──────────────────────────────────────────────

test('弧梃随单元转角：端点按 placement 变换，弧高显式保留', () => {
  const a = assemblyOf([tree(), arcTree()], [90]);
  const u2 = a.units[1];
  const layout = layoutAssembly(a, { installGap: GAP });
  const p2 = layout.placement.get(u2.id)!;
  const proc = assemblyToShapes(a, series60, { space: 'processing' });
  const disp = assemblyToShapes(a, series60);
  const mp = byId(proc, `${u2.id}__sh-mullion-2`);
  const m = byId(disp, `${u2.id}__sh-mullion-2`);

  assert.equal(mp.curve?.sagittaMm, 50);
  assert.equal(m.curve?.sagittaMm, 50, '旋转不得丢失弧高');
  approxPoint(m.p1!, applyPlacement(p2, mp.p1!));
  approxPoint(m.p2!, applyPlacement(p2, mp.p2!));
  assert.equal(m.widthMm, 40);
});

// ── 变换函数本身 ──────────────────────────────────────────

test('transformShapeForDisplay：恒等返回原对象；非恒等同时变换端点与轮廓', () => {
  const rect: LegacyShape = { id: 'r', type: 'rect', bbox: { x: 0, y: 0, w: 100, h: 50 }, topRatio: 1, text: '' };
  const identity: UnitPlacement = { rotationDeg: 0, translate: { x: 0, y: 0 } };
  assert.equal(transformShapeForDisplay(rect, identity), rect, '恒等必须原样返回');

  const line: LegacyShape = {
    id: 'l',
    type: 'line',
    bbox: { x: 0, y: 0, w: 100, h: 50 },
    p1: { x: 0, y: 25 },
    p2: { x: 100, y: 25 },
    topRatio: 1,
    text: '',
  };
  const p: UnitPlacement = { rotationDeg: 90, translate: { x: 10, y: 20 } };
  const out = transformShapeForDisplay(line, p);
  approxPoint(out.p1!, applyPlacement(p, line.p1!));
  approxPoint(out.p2!, applyPlacement(p, line.p2!));
  assert.equal(out.contour, undefined, '直线没有面轮廓');
});

// ── 空间纪律 ──────────────────────────────────────────────

test('processing 空间与夹角无关：90° 装配的展开坐标与 180° 完全一致', () => {
  const a = assemblyOf([splitTree(), splitTree()], [90]);
  const straight = assemblyOf([splitTree(), splitTree()], [180]);
  const proc = assemblyToShapes(a, series60, { space: 'processing' });
  const procStraight = assemblyToShapes(straight, series60, { space: 'processing' });
  const pick = (shapes: LegacyShape[], uid: string) =>
    shapes
      .filter((s) => s.id.startsWith(`${uid}__`))
      .map((s) => ({
        type: s.type,
        bbox: s.bbox,
        p1: s.p1,
        p2: s.p2,
        widthMm: s.widthMm,
        contour: s.contour,
        topRatio: s.topRatio,
      }));
  assert.deepEqual(pick(proc, a.units[1].id), pick(procStraight, straight.units[1].id));
  assert.deepEqual(
    layoutAssembly(a, { installGap: GAP }).bbox,
    layoutAssembly(straight, { installGap: GAP }).bbox,
    '加工外接与夹角无关',
  );
});

test('assemblySize 用显示外接，BOM / 报价 / 下料仍用加工洞口', () => {
  const a = assemblyOf([splitTree(), splitTree()], [90]);
  const layout = layoutAssembly(a, { installGap: GAP });
  const model = toDesignModelAssembly(a, CTX);
  assert.equal(model.openingW, Math.max(1, layout.bbox.w + 2 * GAP));
  assert.equal(model.openingH, Math.max(1, layout.bbox.h + 2 * GAP));

  const size = assemblySize(a);
  assert.notDeepEqual(size, { w: model.openingW, h: model.openingH }, '转角显示尺寸不得回喂加工洞口');
  assert.deepEqual(size, {
    w: Math.round(layout.displayBbox.x + layout.displayBbox.w + GAP),
    h: Math.round(layout.displayBbox.y + layout.displayBbox.h + GAP),
  });
});
