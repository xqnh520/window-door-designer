import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWindowTree, splitArea, setSash, layoutContours, sashWidthOf, type WindowTree } from '../src/window-tree.js';
import { describeWindowTree } from '../src/window-tree-describe.js';
import { pointInPoly, polygonArea, type Pt } from '../src/outline.js';

const GAP = 20;
const FW = 60;

function makeTree(): WindowTree {
  return createWindowTree({ openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: FW, name: '描述' });
}

function pointsOf(flat: number[] | undefined): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; flat && i + 1 < flat.length; i += 2) points.push({ x: flat[i], y: flat[i + 1] });
  return points;
}

test('描述：外框元素几何正确', () => {
  const els = describeWindowTree(makeTree(), GAP);
  const frame = els.find((e) => e.kind === 'frame')!;
  assert.equal(frame.type, 'frame');
  assert.deepEqual([frame.x, frame.y, frame.w, frame.h], [20, 20, 1460, 1060]);
});

test('描述：一固定一平开 → 外框+中梃+双叶子，构件类型与几何正确', () => {
  const tree = makeTree();
  splitArea(tree, tree.root!.id, 'vertical', 0.45, 40);
  const [a1, m, a2] = tree.root!.children!;
  setSash(tree, a1.id, { windowType: 'fixed', label: 'F1' });
  setSash(tree, a2.id, { windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1' });

  const els = describeWindowTree(tree, GAP);
  assert.equal(els.length, 4);

  const muntin = els.find((e) => e.kind === 'muntin')!;
  assert.equal(muntin.id, m.id);
  assert.deepEqual([muntin.x, muntin.y, muntin.w, muntin.h], [663, 80, 40, 940]);

  const fixed = els.find((e) => e.type === 'fixed')!;
  const casement = els.find((e) => e.type === 'casement')!;
  assert.equal(fixed.id, a1.id);
  assert.equal(fixed.label, 'F1');
  assert.deepEqual([fixed.x, fixed.y, fixed.w, fixed.h], [80, 80, 583, 940]);
  assert.equal(casement.id, a2.id);
  assert.equal(casement.sash?.hingeSide, 'left');
  assert.equal(casement.sash?.openDirection, 'out');
  assert.equal(casement.x, 703);
});

test('描述：空叶子为 empty 类型，纱窗叶子为 screen 类型', () => {
  const empty = describeWindowTree(makeTree(), GAP);
  assert.equal(empty.find((e) => e.kind === 'area')!.type, 'empty');

  const tree = makeTree();
  setSash(tree, tree.root!.id, { windowType: 'screen', label: 'WC' });
  const els = describeWindowTree(tree, GAP);
  const area = els.find((e) => e.kind === 'area')!;
  assert.equal(area.type, 'screen');
  assert.equal(area.label, 'WC');
});

test('描述：全部构件类型映射到对应渲染类型', () => {
  const tree = createWindowTree({ openingW: 3000, openingH: 2200, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: FW, name: '全类型' });
  const cases: [string, string][] = [
    ['fixed', 'fixed'],
    ['casement', 'casement'],
    ['sliding', 'sliding'],
    ['topHinged', 'topHinged'],
    ['casementUp', 'casementUp'],
    ['screen', 'screen'],
  ];
  let current = tree.root!;
  for (let i = 0; i < cases.length; i++) {
    splitArea(tree, current.id, i % 2 === 0 ? 'vertical' : 'horizontal', 0.4, 30);
    setSash(tree, current.children![0].id, { windowType: cases[i][0] as never, label: `T${i}` });
    current = current.children![2];
  }
  const els = describeWindowTree(tree, GAP);
  const types = els.map((e) => e.type);
  for (const [, expected] of cases) {
    assert.ok(types.includes(expected as never), `应包含 ${expected}`);
  }
  assert.ok(types.includes('empty'), '末端未放构件叶子为空面板');
  assert.equal(types.filter((t) => t === 'muntin').length, 6);
});

test('描述：矩形窗叶子/中梃不带轮廓点（走经典渲染），异形窗带轮廓点', () => {
  // 矩形：points 必须为 undefined，否则推拉/纱窗/平开会退化成多边形近似
  const rect = makeTree();
  splitArea(rect, rect.root!.id, 'vertical', 0.5, 40);
  setSash(rect, rect.root!.children![0].id, { windowType: 'sliding', label: 'S1' });
  const rectEls = describeWindowTree(rect, GAP);
  assert.equal(rectEls.find((e) => e.kind === 'muntin')!.points, undefined);
  assert.equal(rectEls.find((e) => e.type === 'sliding')!.points, undefined);

  // 异形（拱形）：叶子/中梃应携带裁剪后的轮廓点
  const arch = createWindowTree({ openingW: 1500, openingH: 1500, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: FW, name: '拱形', frameShape: 'arch' });
  splitArea(arch, arch.root!.id, 'vertical', 0.5, 40);
  const archEls = describeWindowTree(arch, GAP);
  assert.ok(archEls.find((e) => e.kind === 'frame')!.points, '异形外框应有轮廓点');
  assert.ok((archEls.find((e) => e.kind === 'muntin')!.points?.length ?? 0) > 0, '异形中梃应有轮廓点');
  for (const leaf of archEls.filter((e) => e.kind === 'area')) {
    assert.ok((leaf.points?.length ?? 0) > 0, '异形叶子应有轮廓点');
  }
});

test('描述：异形轮廓点为局部坐标（相对元素 x/y），渲染层不会二次平移', () => {
  // 回归：曾把 layoutContours 的世界坐标直接塞进 points，而渲染层已把 Group 定位到 (x,y)，
  // 结果异形外框/中梃/叶子被整体平移一个 (x,y)，画在错位处（内腔还少了一圈外框）。
  const arch = createWindowTree({ openingW: 1500, openingH: 1500, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: FW, name: '拱形', frameShape: 'arch' });
  splitArea(arch, arch.root!.id, 'vertical', 0.5, 40);
  setSash(arch, arch.root!.children![0].id, { windowType: 'fixed', label: 'F1' });
  const els = describeWindowTree(arch, GAP);

  // 外框：局部外轮廓从 ~0 起、跨度 = w/h（世界坐标会是 ~20..1480，一眼可辨）
  const frame = els.find((e) => e.kind === 'frame')!;
  const fp = frame.points!;
  const fx = fp.filter((_, i) => i % 2 === 0);
  const fy = fp.filter((_, i) => i % 2 === 1);
  assert.ok(Math.abs(Math.min(...fx)) < 1e-6, '外框局部轮廓 minX 应为 0');
  assert.ok(Math.abs(Math.min(...fy)) < 1e-6, '外框局部轮廓 minY 应为 0（拱顶落在框顶）');
  assert.ok(Math.abs(Math.max(...fx) - frame.w) < 1e-6, '外框局部轮廓横向跨度 = w');
  assert.ok(Math.abs(Math.max(...fy) - frame.h) < 1e-6, '外框局部轮廓纵向跨度 = h');

  // 叶子：局部点 + (el.x, el.y) 应精确还原 layoutContours 的世界轮廓
  const contours = layoutContours(arch, { installGap: GAP });
  const leaf = els.find((e) => e.kind === 'area')!;
  const world = contours.get(leaf.id)!;
  const lp = leaf.points!;
  assert.equal(lp.length, world.length * 2);
  for (let i = 0; i < world.length; i++) {
    assert.ok(Math.abs(lp[i * 2] + leaf.x - world[i].x) < 1e-6, `叶子局部点还原世界 x[${i}]`);
    assert.ok(Math.abs(lp[i * 2 + 1] + leaf.y - world[i].y) < 1e-6, `叶子局部点还原世界 y[${i}]`);
  }
});

test('描述：对开百叶的扇语义和单叶几何在 core 中一次解析', () => {
  const tree = makeTree();
  setSash(tree, tree.root!.id, {
    windowType: 'casement',
    hingeSide: 'left',
    openDirection: 'out',
    label: 'L2',
    leaves: 2,
    infill: 'louver',
  });

  const area = describeWindowTree(tree, GAP).find((e) => e.kind === 'area')!;
  assert.equal(area.sashInsetMm, sashWidthOf(tree));
  assert.equal(area.sashLeaves, 2);
  assert.equal(area.sashInfill, 'louver');
  assert.equal(area.sashLeafGeometries?.length, 2);
  assert.equal(area.sashLeafGeometries?.[0].hinge, 'left');
  assert.equal(area.sashLeafGeometries?.[1].hinge, 'right');
  assert.equal(area.sashLeafGeometries?.[0].w, area.sashLeafGeometries?.[1].w);
  assert.ok((area.sashLeafGeometries?.[0].louver?.slatYs.length ?? 0) >= 2);
  assert.ok((area.louverPitchMm ?? 0) > 0);
});

test('描述：上玻下板和玻璃格条在 core 中产出显式渲染几何', () => {
  const tree = makeTree();
  setSash(tree, tree.root!.id, {
    windowType: 'casement',
    hingeSide: 'right',
    openDirection: 'in',
    label: 'P1',
    infill: 'panel',
  });
  tree.root!.bars = { pattern: 'colonial', cols: 2, rows: 2 };

  const area = describeWindowTree(tree, GAP).find((e) => e.kind === 'area')!;
  assert.equal(area.sashInfill, 'panel');
  assert.ok(area.panel, '单扇应直接提供上玻下板布局');
  assert.ok((area.panel?.glass.h ?? 0) > 0);
  assert.ok((area.panel?.panel.h ?? 0) > 0);
  assert.equal(area.glassBars?.lines.length, 2);
});

test('描述：异形扇的内缩轮廓、内容锚点和把手最终落点均由 core 给出', () => {
  const tree = createWindowTree({
    openingW: 1500,
    openingH: 1200,
    seriesId: 'series-60',
    glassId: 'g-5-12a-5',
    frameWidthMm: FW,
    name: '三角异形扇',
    frameShape: 'triangle',
  });
  setSash(tree, tree.root!.id, {
    windowType: 'casement',
    hingeSide: 'left',
    openDirection: 'out',
    label: 'T1',
  });

  const area = describeWindowTree(tree, GAP).find((e) => e.kind === 'area')!;
  const outer = pointsOf(area.points);
  const pane = pointsOf(area.panePoints);
  const sashGlass = pointsOf(area.sashGlassPoints);
  const handle = area.handlePlacements?.[0];

  assert.ok(outer.length >= 3, '异形叶区应提供外轮廓');
  assert.ok(pane.length >= 3, '异形叶区应提供内缩后的内容轮廓');
  assert.ok(sashGlass.length >= 3, '异形开启扇应提供扇玻璃轮廓');
  assert.ok(Math.abs(polygonArea(pane)) < Math.abs(polygonArea(outer)), '内容轮廓面积应小于叶区外轮廓');
  assert.ok(Math.abs(polygonArea(sashGlass)) < Math.abs(polygonArea(outer)), '扇玻璃轮廓面积应小于叶区外轮廓');
  assert.ok(area.contentAnchor && pointInPoly(area.contentAnchor, outer), '内容锚点应位于叶区轮廓内');
  assert.ok(handle && pointInPoly({ x: handle.drawX, y: handle.drawY }, outer), '把手最终落点应位于叶区轮廓内');
});
