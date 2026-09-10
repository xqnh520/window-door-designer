import { test } from 'node:test';
import assert from 'node:assert/strict';
import { series60, sampleLibrary, WindowTypeLabel } from '@wdd/schema';
import {
  createWindowTree,
  setSash,
  toDesignModel,
  type WindowTree,
} from '../src/window-tree.js';
import { describeWindowTree } from '../src/window-tree-describe.js';
import { computeBomFromDesignModel } from '../src/bom-design-model.js';
import { computeBom } from '../src/bom.js';
import { createDesign } from '../src/design.js';
import { WINDOW_TYPE_ROLES } from '../src/formula-context.js';
import { validateDesignModel } from '../src/validate-design.js';

const GAP = 20;

function treeWith(windowType: 'tiltSlide' | 'casementUp' | 'casement'): WindowTree {
  const t = createWindowTree({
    openingW: 1200, openingH: 1500, seriesId: 'series-60', glassId: 'g-5-12a-5',
    frameWidthMm: 60, sashWidthMm: 45, name: '内倒平移',
  });
  assert.equal(setSash(t, t.root!.id, { windowType, hingeSide: 'left', openDirection: windowType === 'tiltSlide' ? 'in' : 'out', label: 'A1' }), true);
  return t;
}

const bomOf = (t: WindowTree) =>
  computeBomFromDesignModel(
    toDesignModel(t, { installGap: GAP, name: '内倒平移', seriesId: 'series-60', glassId: 'g-5-12a-5' }),
    series60,
    sampleLibrary,
  );

test('内倒平移扇：走平开扇角色、描述层带自己的类型、校验不报类型不匹配', () => {
  const t = treeWith('tiltSlide');
  const model = toDesignModel(t, { installGap: GAP, name: '内倒平移', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const sash = model.components.find((c) => c.kind === 'casementSash');
  assert.ok(sash, '应作为平开扇角色出构件（复用扇料/玻璃/压线）');
  assert.equal(sash!.windowType, 'tiltSlide');
  assert.equal(describeWindowTree(t, GAP).find((e) => e.kind === 'area')!.type, 'tiltSlide');
  assert.equal(WindowTypeLabel.tiltSlide, '内倒平移扇');

  const issues = validateDesignModel(model, series60);
  assert.ok(!issues.some((i) => i.code === 'TYPE_MISMATCH' || /不匹配|不属于/.test(i.message)), `不该报窗型/角色不匹配：${issues.map((i) => i.message).join(' / ')}`);
});

test('内倒平移扇出料：平开一套五金 + 滑轨走轮 + 内开内倒五金，扇料照旧', () => {
  const bom = bomOf(treeWith('tiltSlide'));
  const names = bom.items.filter((i) => i.category === 'hardware').map((i) => i.name);
  for (const need of ['推拉滑轮', '内开内倒五金', '平开合页', '执手', '传动器', '锁点']) {
    assert.ok(names.includes(need), `五金应含「${need}」：${names.join(' / ')}`);
  }
  assert.ok(bom.items.some((i) => i.name === '扇料(横)' && i.quantity === 2), '扇料横档两根');
  assert.ok(bom.items.some((i) => i.name === '扇料(竖)' && i.quantity === 2), '扇料竖料两根');
  assert.equal(bom.items.find((i) => i.category === 'glass')!.quantity, 1, '单扇一块玻璃');

  // 内开内倒在模型通路的五金保持原样（本次只新增 tiltSlide 分支）
  const up = bomOf(treeWith('casementUp'));
  const upHw = up.items.filter((i) => i.category === 'hardware').map((i) => i.name).join(' / ');
  assert.equal(upHw, '平开合页 / 执手 / 传动器 / 锁点 / 把手', 'casementUp 五金不该被改动');
});

test('内倒平移扇：算料角色含滑轨，legacy 窗型模板也能出整格扇', () => {
  assert.deepEqual(WINDOW_TYPE_ROLES.tiltSlide, ['frame', 'sash', 'track', 'mullion', 'bead']);
  const design = createDesign('tiltSlide', { openingW: 1200, openingH: 1500, seriesId: 'series-60', name: 't' }, series60);
  assert.equal(design.panels.length, 1);
  assert.equal(design.panels[0].windowType, 'tiltSlide');
  assert.equal(design.panels[0].hasSash, true);
  const bom = computeBom(design, series60, sampleLibrary);
  const names = bom.items.filter((i) => i.category === 'hardware').map((i) => i.name);
  assert.ok(names.includes('推拉滑轮') && names.includes('内开内倒五金') && names.includes('平开合页'), `legacy 通路同样成套：${names.join(' / ')}`);
});
