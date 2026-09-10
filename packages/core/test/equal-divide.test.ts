import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWindowTree, equalDivide, layoutTree, walkAreas, muntinWidthOf, splitArea, DEFAULT_MUNTIN_MM, type WindowTree } from '../src/window-tree.js';

const GAP = 20;

function makeTree(): WindowTree {
  return createWindowTree({ openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: 60, name: '等分' });
}

function countLeaves(tree: WindowTree): number {
  let n = 0;
  walkAreas(tree, (a) => {
    if (!a.children) n++;
  });
  return n;
}

function spread(arr: number[]): number {
  return Math.max(...arr) - Math.min(...arr);
}

test('等分：2/3/4/6 份叶子数量正确且宽度近似相等（容差≈1%，中梃厚度几何性占位）', () => {
  for (const n of [2, 3, 4, 6]) {
    const tree = makeTree();
    assert.equal(equalDivide(tree, tree.root!.id, 'vertical', n), true);
    assert.equal(countLeaves(tree), n, `n=${n} 叶子数`);
    const layout = layoutTree(tree, { installGap: GAP });
    const widths: number[] = [];
    walkAreas(tree, (a) => {
      if (!a.children) widths.push(Math.round(layout.boxes.get(a.id)!.w));
    });
    const avg = widths.reduce((s, v) => s + v, 0) / widths.length;
    assert.ok(spread(widths) <= avg * 0.012 + 1, `n=${n} 各片宽度近似相等: ${widths.join(',')}`);
  }
});

test('等分：非法参数拒绝（n<2、n>12、已分割区域）', () => {
  const tree = makeTree();
  assert.equal(equalDivide(tree, tree.root!.id, 'vertical', 1), false);
  assert.equal(equalDivide(tree, tree.root!.id, 'vertical', 13), false);
  // 已分割区域不可再等分
  equalDivide(tree, tree.root!.id, 'vertical', 3);
  assert.equal(equalDivide(tree, tree.root!.id, 'vertical', 2), false);
});

test('等分：水平等分后各片高度近似相等', () => {
  const tree = makeTree();
  equalDivide(tree, tree.root!.id, 'horizontal', 3);
  const layout = layoutTree(tree, { installGap: GAP });
  const heights: number[] = [];
  walkAreas(tree, (a) => {
    if (!a.children) heights.push(Math.round(layout.boxes.get(a.id)!.h));
  });
  assert.equal(heights.length, 3);
  const avg = heights.reduce((s, v) => s + v, 0) / heights.length;
  assert.ok(spread(heights) <= avg * 0.012 + 1);
});

test('中梃料厚可配：缺省 40 不变，配置后分割与等分都按它占位', () => {
  assert.equal(muntinWidthOf({}), DEFAULT_MUNTIN_MM, '未配置应回到默认 40');
  assert.equal(muntinWidthOf({ muntinWidthMm: 60 }), 60);

  const tDefault = makeTree();
  assert.equal(splitArea(tDefault, tDefault.root!.id, 'vertical', 0.5), true);
  assert.equal(tDefault.root!.children![1].thicknessMm, 40, '既有用例的默认厚度不得变');

  const tCfg = makeTree();
  tCfg.muntinWidthMm = 60;
  assert.equal(splitArea(tCfg, tCfg.root!.id, 'vertical', 0.5), true);
  assert.equal(tCfg.root!.children![1].thicknessMm, 60, '未显式传厚度时取整窗配置');

  const tDiv = makeTree();
  tDiv.muntinWidthMm = 60;
  assert.equal(equalDivide(tDiv, tDiv.root!.id, 'vertical', 3), true);
  const lay = layoutTree(tDiv, { installGap: GAP });
  const ws: number[] = [];
  walkAreas(tDiv, (a) => {
    if (!a.children) ws.push(Math.round(lay.boxes.get(a.id)!.w));
  });
  assert.equal(ws.length, 3);
  const target = (1500 - 2 * GAP - 2 * 60 - 2 * 60) / 3; // 内腔 1340 减两根 60 厚梃
  const mean = ws.reduce((s, v) => s + v, 0) / ws.length;
  assert.ok(Math.abs(mean - target) <= 2, `每格应≈${target}mm，实得 ${ws.join(',')}`);
});