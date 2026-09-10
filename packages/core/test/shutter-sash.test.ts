import { test } from 'node:test';
import assert from 'node:assert/strict';
import { series60, sampleLibrary } from '@wdd/schema';
import {
  createWindowTree,
  setSash,
  toDesignModel,
  louverSlats,
  louverPitchOf,
  sashInfillOf,
  DEFAULT_LOUVER_PITCH_MM,
  type WindowTree,
  type WindowSashSpec,
} from '../src/window-tree.js';
import { describeWindowTree } from '../src/window-tree-describe.js';
import { computeBomFromDesignModel } from '../src/bom-design-model.js';
import { validateDesignModel } from '../src/validate-design.js';

const GAP = 20;

function treeWith(sash: WindowSashSpec, louverPitchMm?: number): WindowTree {
  const t = createWindowTree({
    openingW: 1500, openingH: 1500, seriesId: 'series-60', glassId: 'g-5-12a-5',
    frameWidthMm: 60, sashWidthMm: 45, name: '百叶窗',
  });
  if (louverPitchMm != null) t.louverPitchMm = louverPitchMm;
  assert.equal(setSash(t, t.root!.id, sash), true);
  return t;
}

const bomOf = (t: WindowTree) =>
  computeBomFromDesignModel(
    toDesignModel(t, { installGap: GAP, name: '百叶窗', seriesId: 'series-60', glassId: 'g-5-12a-5' }),
    series60,
    sampleLibrary,
  );
const has = (bom: ReturnType<typeof bomOf>, name: string) => bom.items.some((i) => i.name === name);

test('百叶帘片布局：按间距均摊、至少两片、都落在扇口内', () => {
  assert.equal(DEFAULT_LOUVER_PITCH_MM, 100);
  assert.equal(louverPitchOf({}), 100);
  assert.equal(louverPitchOf({ louverPitchMm: 60 }), 60);
  assert.equal(louverPitchOf({ louverPitchMm: 1 }), 10, '间距有下限');

  const ys = louverSlats(1200, 45, 100);
  assert.ok(ys.length >= 10 && ys.length <= 13, `1200 高扇口按 100 间距应约 11 片，实得 ${ys.length}`);
  assert.ok(ys.every((y) => y > 45 && y < 1155), '帘片中心必须落在扇口内');
  assert.ok(ys.every((y, i) => i === 0 || y > ys[i - 1]), '帘片应自上而下递增');
  assert.equal(louverSlats(300, 45, 100).length, 2, '矮扇口也要两片');
  assert.deepEqual(louverSlats(60, 45, 100), [], '扇口小于框宽时不出片');
});

test('百叶窗出料：无玻璃无压线，改出百叶帘片；扇料与五金照旧', () => {
  const bom = bomOf(treeWith({ windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1', infill: 'louver' }));
  assert.ok(!bom.items.some((i) => i.category === 'glass'), '百叶扇不该出玻璃行');
  assert.ok(!has(bom, '压线'), '百叶扇不该出压线行');
  const louver = bom.items.find((i) => i.name === '百叶帘片');
  assert.ok(louver, '应出百叶帘片行');
  assert.equal(louver!.quantity, 1);
  assert.ok(louver!.unitPrice > 0 && louver!.amount > 0, '帘片要进报价');
  assert.ok(has(bom, '扇料(横)') && has(bom, '扇料(竖)'), '扇料仍按扇出');
  assert.ok(has(bom, '平开合页') && has(bom, '执手'), '开启五金仍成套');
});

test('对开百叶窗 = 百叶填充 + 两片扇：帘片两块、对开料两根、仍无玻璃', () => {
  const bom = bomOf(treeWith({ windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1', leaves: 2, infill: 'louver' }));
  assert.ok(!bom.items.some((i) => i.category === 'glass'), '对开百叶也不出玻璃');
  assert.equal(bom.items.find((i) => i.name === '百叶帘片')!.quantity, 2, '两片扇各一副帘片');
  assert.equal(bom.items.find((i) => i.name === '对开料(中缝)')!.quantity, 2);
  assert.equal(bom.items.find((i) => i.name === '扇料(横)')!.quantity, 4);
});

test('百叶：缺省仍是玻璃扇（零回归），描述层带间距，校验不报玻璃尺寸', () => {
  const plain = bomOf(treeWith({ windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1' }));
  assert.ok(plain.items.some((i) => i.category === 'glass'), '缺省扇面仍出玻璃');
  assert.ok(has(plain, '压线'), '缺省扇面仍出压线');
  assert.ok(!has(plain, '百叶帘片'));

  const plainSash: WindowSashSpec = { windowType: 'casement', label: 'A1' };
  assert.equal(sashInfillOf(plainSash), 'glass');
  const t = treeWith({ windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1', infill: 'louver' }, 80);
  const el = describeWindowTree(t, GAP).find((e) => e.kind === 'area')!;
  assert.equal(el.louverPitchMm, 80, '间距要传到渲染层');
  const model = toDesignModel(t, { installGap: GAP, name: '百叶窗', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  assert.equal(model.components.find((c) => c.kind === 'casementSash')!.infill, 'louver');
  const issues = validateDesignModel(model, series60);
  assert.ok(!issues.some((i) => i.code === 'GLASS_SIZE'), `百叶扇不该报玻璃尺寸：${issues.map((i) => i.code).join(' / ')}`);
});
