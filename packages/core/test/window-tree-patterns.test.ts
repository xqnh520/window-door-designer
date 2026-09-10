import { test } from 'node:test';
import assert from 'node:assert/strict';
import { series60, sampleLibrary } from '@wdd/schema';
import {
  createWindowTree,
  setSash,
  walkAreas,
  layoutContours,
  toDesignModel,
  type WindowTree,
  type WindowTreeArea,
} from '../src/window-tree.js';
import { polygonArea } from '../src/outline.js';
import {
  applyMuntinPattern,
  MUNTIN_PATTERN_IDS,
  type MuntinPattern,
} from '../src/window-tree-patterns.js';
import { computeBomFromDesignModel } from '../src/bom-design-model.js';

const GAP = 20;
const FW = 60;
const CAVITY = (1500 - 2 * GAP - 2 * FW) * (1100 - 2 * GAP - 2 * FW); // 1340 × 940

function makeTree(withSash = true): WindowTree {
  const t = createWindowTree({
    openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5',
    frameWidthMm: FW, muntinWidthMm: 40, name: '复合梃',
  });
  if (withSash) setSash(t, t.root!.id, { windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1' });
  return t;
}

const leavesOf = (t: WindowTree): WindowTreeArea[] => {
  const out: WindowTreeArea[] = [];
  walkAreas(t, (a) => {
    if (!a.children) out.push(a);
  });
  return out;
};

const EXPECT_CELLS: Record<MuntinPattern, number> = {
  square2x2: 4,
  grid3x3: 9,
  crossX: 4,
  diamond: 5,
  octagon: 5,
  spin: 8,
};

test('复合梃预设：六个 pattern 一次成格，面积守恒且每格都有非退化轮廓', () => {
  for (const pattern of MUNTIN_PATTERN_IDS) {
    const t = makeTree();
    assert.equal(applyMuntinPattern(t, t.root!.id, pattern, { installGap: GAP }), true, `${pattern} 应成套成功`);
    const contours = layoutContours(t, { installGap: GAP });
    const leaves = leavesOf(t);
    assert.equal(leaves.length, EXPECT_CELLS[pattern], `${pattern} 分格数`);

    let sum = 0;
    for (const leaf of leaves) {
      const pts = contours.get(leaf.id);
      assert.ok(pts && pts.length >= 3, `${pattern}/${leaf.id} 应有轮廓`);
      const area = Math.abs(polygonArea(pts!));
      assert.ok(area > 1000, `${pattern}/${leaf.id} 面积退化：${Math.round(area)}`);
      sum += area;
    }
    walkAreas(t, (a) => {
      if (!a.children) return;
      const band = contours.get(a.children[1].id);
      assert.ok(band && band.length >= 4, `${pattern} 每根中梃都必须真的切出带轮廓`);
      sum += Math.abs(polygonArea(band));
    });
    assert.ok(Math.abs(sum - CAVITY) / CAVITY < 1e-4, `${pattern} 分格+料应拼回内腔：${Math.round(sum)} vs ${CAVITY}`);
  }
});

test('复合梃预设：每格继承原扇并自动顺延标号', () => {
  const t = makeTree();
  assert.equal(applyMuntinPattern(t, t.root!.id, 'grid3x3', { installGap: GAP }), true);
  const labels = leavesOf(t).map((l) => l.sash?.label);
  assert.equal(labels.length, 9);
  assert.equal(new Set(labels).size, 9, `标号应互不相同：${labels.join(',')}`);
  assert.ok(labels.every((l) => !!l && /^A\d+$/.test(l)), `标号应延续 A 系列：${labels.join(',')}`);
  assert.ok(leavesOf(t).every((l) => l.sash?.windowType === 'casement'), '每格都继承平开扇');
});

test('复合梃预设：只作用于选中格，兄弟格原样保留', () => {
  const t = makeTree();
  assert.equal(applyMuntinPattern(t, t.root!.id, 'square2x2', { installGap: GAP }), true);
  const four = leavesOf(t).map((l) => l.id);
  assert.equal(four.length, 4);
  assert.equal(applyMuntinPattern(t, four[0], 'grid3x3', { installGap: GAP }), true);
  const now = leavesOf(t);
  assert.equal(now.length, 4 - 1 + 9, '只应把第一格换成九宫');
  for (const id of four.slice(1)) {
    assert.ok(now.some((l) => l.id === id), `兄弟格 ${id} 不该被动过`);
  }
});

test('复合梃预设：切不出就整单回滚，原树逐字节不变', () => {
  const t = createWindowTree({
    openingW: 260, openingH: 200, seriesId: 'series-60', glassId: 'g-5-12a-5',
    frameWidthMm: FW, muntinWidthMm: 40, name: '小窗',
  });
  const before = JSON.stringify(t);
  assert.equal(applyMuntinPattern(t, t.root!.id, 'diamond', { installGap: GAP }), false, '内腔太小时菱形应整体失败');
  assert.equal(JSON.stringify(t), before, '失败后原树必须完全不变（不留半套分格）');
  // 已分割的格子也不能再套
  const t2 = makeTree();
  assert.equal(applyMuntinPattern(t2, t2.root!.id, 'square2x2', { installGap: GAP }), true);
  const split = JSON.stringify(t2);
  assert.equal(applyMuntinPattern(t2, t2.root!.id, 'grid3x3', { installGap: GAP }), false, '宿主已分割时拒绝');
  assert.equal(JSON.stringify(t2), split);
});

test('复合梃预设：斜料出斜中梃行、直料出普通行，且不受整窗弧高设置影响', () => {
  const t = makeTree();
  t.muntinSagittaMm = 200;
  assert.equal(applyMuntinPattern(t, t.root!.id, 'diamond', { installGap: GAP }), true);
  assert.equal(t.muntinSagittaMm, 200, '整窗弧高设置不该被预设改写');
  const model = toDesignModel(t, { installGap: GAP, name: '复合梃', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  const rows = bom.items.filter((i) => i.name.includes('中梃'));
  assert.equal(rows.length, 4, `菱形四根斜料应出 4 行中梃：${rows.map((r) => r.name).join(' / ')}`);
  assert.ok(rows.every((r) => r.name.startsWith('斜中梃')), `全是斜中梃：${rows.map((r) => r.name).join(' / ')}`);
  assert.ok(!rows.some((r) => r.name.startsWith('弧中梃')), '预设不该按弧出料');
  assert.equal(rows.reduce((s, r) => s + r.quantity, 0), 4);
});
