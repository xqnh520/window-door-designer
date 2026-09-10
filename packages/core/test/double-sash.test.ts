import { test } from 'node:test';
import assert from 'node:assert/strict';
import { series60, sampleLibrary } from '@wdd/schema';
import {
  createWindowTree,
  setSash,
  toDesignModel,
  sashLeafRects,
  meetingWidthOf,
  sashLeavesOf,
  DEFAULT_MEETING_MM,
  autoFittingsOfTree,
  type WindowTree,
} from '../src/window-tree.js';
import { computeBomFromDesignModel } from '../src/bom-design-model.js';
import { validateDesignModel } from '../src/validate-design.js';
import type { BomItem } from '../src/bom.js';
import type { WindowSashSpec } from '../src/window-tree.js';

const GAP = 20;

function treeWith(sash: Parameters<typeof setSash>[2]): WindowTree {
  const t = createWindowTree({
    openingW: 1500, openingH: 1500, seriesId: 'series-60', glassId: 'g-5-12a-5',
    frameWidthMm: 60, sashWidthMm: 45, name: '对开扇',
  });
  assert.equal(setSash(t, t.root!.id, sash), true);
  return t;
}

const modelOf = (t: WindowTree, name: string) =>
  toDesignModel(t, { installGap: GAP, name, seriesId: 'series-60', glassId: 'g-5-12a-5' });
const rowsNamed = (bom: { items: BomItem[] }, name: string) => bom.items.filter((i) => i.name === name);
const glassRows = (bom: { items: BomItem[] }) => bom.items.filter((i) => i.category === 'glass');
const firstGlassW = (bom: { items: BomItem[] }) => Number(String(glassRows(bom)[0].spec).split('x')[0]);

test('对开扇几何：两叶在中缝重叠一根对开料，缺省中缝 60', () => {
  const single: WindowSashSpec = { windowType: 'casement', label: 'A1' };
  const dbl: WindowSashSpec = { windowType: 'casement', label: 'A1', leaves: 2 };
  assert.equal(DEFAULT_MEETING_MM, 60);
  assert.equal(meetingWidthOf({}), 60);
  assert.equal(meetingWidthOf({ meetingWidthMm: 80 }), 80);
  assert.equal(sashLeavesOf(single), 1, '旧数据（无 leaves）仍是单扇');
  assert.equal(sashLeavesOf(dbl), 2);

  const one = sashLeafRects(1000, 800, 1, 60);
  assert.equal(one.length, 1);
  assert.deepEqual([one[0].x, one[0].w], [0, 1000]);

  const two = sashLeafRects(1000, 800, 2, 60);
  assert.equal(two.length, 2);
  assert.deepEqual(two.map((l) => l.w), [530, 530]);
  assert.equal(two[1].x, 470, '右叶起点 = 1000 − 530');
  assert.equal(two[0].x + two[0].w - two[1].x, 60, '两叶重叠宽度应恰为一根中缝料');
  assert.deepEqual(two.map((l) => l.hinge), ['left', 'right'], '对开扇两叶外向合页');
  assert.deepEqual(two.map((l) => l.freeBarMm), [60, 60]);
});

test('对开扇出料：玻璃两块且更小、对开料×2、竖料只剩两根、无中梃', () => {
  const doubleModel = modelOf(treeWith({ windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1', leaves: 2 }), '对开');
  const b1 = computeBomFromDesignModel(modelOf(treeWith({ windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1' }), '单扇'), series60, sampleLibrary);
  const b2 = computeBomFromDesignModel(doubleModel, series60, sampleLibrary);

  const comp = doubleModel.components.find((c) => c.kind === 'casementSash')!;
  assert.equal(comp.leaves, 2);
  assert.equal(comp.meetingWidthMm, 60);

  assert.equal(glassRows(b2).length, 1);
  assert.equal(glassRows(b2)[0].quantity, 2, '对开扇出两块玻璃');
  assert.ok(firstGlassW(b2) < firstGlassW(b1), `单块玻璃应比单扇的小：${firstGlassW(b2)} < ${firstGlassW(b1)}`);

  const meet = rowsNamed(b2, '对开料(中缝)');
  assert.equal(meet.length, 1, '应有一行对开料');
  assert.equal(meet[0].quantity, 2, '中缝两根对开料');
  assert.equal(rowsNamed(b2, '扇料(竖)')[0].quantity, 2, '普通竖料只剩两扇合页边各一根');
  assert.equal(rowsNamed(b2, '扇料(横)')[0].quantity, 4, '上下横档各两扇');
  assert.ok(!b2.items.some((i) => i.name.startsWith('中梃')), '对开扇不该有中梃行');

  // 五金按扇叶数成套
  for (const name of ['平开合页', '执手', '传动器', '锁点']) {
    const one = rowsNamed(b1, name)[0]?.quantity ?? 0;
    const two = rowsNamed(b2, name)[0]?.quantity ?? 0;
    assert.equal(two, one * 2, `${name} 应按两片扇翻倍：${one} → ${two}`);
  }
});

test('对开扇：单扇出料完全不变（零回归）', () => {
  const bom = computeBomFromDesignModel(modelOf(treeWith({ windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1' }), '单扇'), series60, sampleLibrary);
  assert.ok(!bom.items.some((i) => i.name === '对开料(中缝)'), '单扇不该出对开料');
  assert.equal(rowsNamed(bom, '扇料(竖)')[0].quantity, 2);
  assert.equal(rowsNamed(bom, '扇料(横)')[0].quantity, 2);
  assert.equal(glassRows(bom)[0].quantity, 1);
  assert.equal(modelOf(treeWith({ windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1' }), '单扇').components.find((c) => c.kind === 'casementSash')!.leaves, undefined);
});

test('对开扇校验与派生配件：按单叶判工艺上限，把手数=2，自动挂中挺锁', () => {
  const t = treeWith({ windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1', leaves: 2 });
  const issues = validateDesignModel(modelOf(t, '对开'), series60);
  assert.ok(!issues.some((i) => i.code === 'SASH_SIZE'), `两片 ~780 的扇不该报 SASH_SIZE：${issues.map((i) => i.code).join(' / ')}`);

  const fittings = autoFittingsOfTree(t, { installGap: GAP }, (id) => id);
  assert.equal(fittings.find((f) => f.type === 'handleHardware')!.count, 2, '两叶各一个把手');
  assert.ok(fittings.some((f) => f.type === 'doubleSashAddon'), '自动派生中挺锁');

  const t2 = treeWith({ windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1', leaves: 2 });
  t2.root!.fittings = [{ id: 'fit-1', type: 'doubleSashAddon', count: 2 }];
  assert.ok(!autoFittingsOfTree(t2, { installGap: GAP }, (id) => id).some((f) => f.type === 'doubleSashAddon'), '已手工添加则不重复派生');
});
