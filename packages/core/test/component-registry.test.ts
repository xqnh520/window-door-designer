import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWindowTree, splitArea, setSash, kindFromSashType, toDesignModel, type WindowTree } from '../src/window-tree.js';
import { describeWindowTree } from '../src/window-tree-describe.js';
import { computeBomFromDesignModel } from '../src/bom-design-model.js';
import { resolveComponentType, listComponentTypes } from '../src/component-registry.js';
import { series60, sampleLibrary } from '@wdd/schema';

const GAP = 20;

function makeTree(): WindowTree {
  return createWindowTree({ openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: 60, name: '构件' });
}

test('注册表：16 个内置构件类型齐全且分组正确', () => {
  const all = listComponentTypes();
  assert.equal(all.length, 16);
  assert.ok(resolveComponentType('securityFrame'));
  assert.equal(resolveComponentType('securityFrame')?.group, 'safety');
  assert.equal(resolveComponentType('foldSash')?.group, 'fold');
  assert.equal(resolveComponentType('sashBead')?.group, 'sliding');
  assert.equal(resolveComponentType('nonexist'), null);
});

test('双轨兼容：roleType 为空时回退 windowType 判定', () => {
  const tree = makeTree();
  splitArea(tree, tree.root!.id, 'vertical', 0.5, 40);
  const [a1, , a2] = tree.root!.children!;
  setSash(tree, a1.id, { windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1' });
  setSash(tree, a2.id, { windowType: 'fixed', roleType: 'securityFrame', label: '防盗框' });
  const model = toDesignModel(tree, { installGap: GAP, name: '构件', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const casement = model.components.find((c) => c.id === a1.id)!;
  const sec = model.components.find((c) => c.id === a2.id)!;
  assert.equal(casement.kind, 'casementSash'); // 旧类型回退
  assert.equal(sec.kind, 'securityFrame'); // 注册类型
  assert.equal(sec.roleType, 'securityFrame');
});

test('BOM：注册构件按 roles 出料（防盗框按 frame 角色、装饰条按 bead 角色）', () => {
  const tree = makeTree();
  splitArea(tree, tree.root!.id, 'vertical', 0.5, 40);
  const [a1, , a2] = tree.root!.children!;
  setSash(tree, a1.id, { windowType: 'fixed', roleType: 'securityFrame', label: '防盗框' });
  setSash(tree, a2.id, { windowType: 'fixed', roleType: 'decorBar', label: '装饰条' });
  const model = toDesignModel(tree, { installGap: GAP, name: '构件', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  assert.ok(bom.items.some((i) => i.name.includes('防盗框') && i.name.includes('frame')));
  assert.ok(bom.items.some((i) => i.name.includes('装饰条') && i.name.includes('bead')));
});

test('BOM：磨砂玻璃 needsGlass 出玻璃行，且 registration roles 为空时走玻璃行', () => {
  const tree = makeTree();
  setSash(tree, tree.root!.id, { windowType: 'fixed', roleType: 'frostedGlass', label: '磨砂' });
  const model = toDesignModel(tree, { installGap: GAP, name: '构件', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  const glassRow = bom.items.find((i) => i.name === '磨砂玻璃玻璃');
  assert.ok(glassRow, '磨砂玻璃应出玻璃行');
  assert.ok(glassRow.unitPrice > 0, '玻璃单价不应为 0');
  assert.ok(glassRow.amount > 0, '玻璃金额不应为 0（曾漏计价）');
});

test('describe：roleType 构件以 fixed 承载类型渲染', () => {
  const tree = makeTree();
  setSash(tree, tree.root!.id, { windowType: 'fixed', roleType: 'sashInSash', label: '扇中扇' });
  const els = describeWindowTree(tree, GAP);
  const area = els.find((e) => e.kind === 'area')!;
  assert.equal(area.type, 'fixed');
  assert.equal(area.sash?.roleType, 'sashInSash');
  assert.equal(area.label, '扇中扇');
});

test('kindFromSashType：旧类型映射不回归', () => {
  assert.equal(kindFromSashType('casement'), 'casementSash');
  assert.equal(kindFromSashType('screen'), 'screen');
  assert.equal(kindFromSashType('sliding'), 'slidingSash');
});