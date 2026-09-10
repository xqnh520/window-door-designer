import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWindowTree, splitArea, setSash, toDesignModel, type WindowFitting, type WindowTree } from '../src/window-tree.js';
import { computeBomFromDesignModel } from '../src/bom-design-model.js';
import { resolveFittingType, listFittingTypes, computeFittingBomRow } from '../src/fitting-registry.js';
import { assemblyFromWindowTree, addLinearUnit, setCombinerFittings, toDesignModelAssembly } from '../src/window-assembly.js';
import { series60, sampleLibrary } from '@wdd/schema';

const GAP = 20;

function makeTree(): WindowTree {
  const t = createWindowTree({ openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: 60, name: '配件窗' });
  t.fittings = [
    { id: 'f1', type: 'frameAddon', count: 2 },
    { id: 'f2', type: 'theftAddon' },
    { id: 'f3', type: 'slideLockAddon' },
  ];
  return t;
}

test('配件注册表：18 类齐全且层级正确', () => {
  const all = listFittingTypes();
  assert.equal(all.length, 18);
  assert.equal(resolveFittingType('frameAddon').host, 'tree');
  assert.equal(resolveFittingType('sashAddon').host, 'area');
  assert.equal(resolveFittingType('cornerJoinerAddon').host, 'combiner');
  assert.equal(resolveFittingType('slideCollisionAddon').host, 'area');
  // 把手（执手）：开启扇自动带，宿主=分格、出料=五金、单位=把
  assert.equal(resolveFittingType('handleHardware').category, 'hardware');
  assert.equal(resolveFittingType('handleHardware').host, 'area');
  assert.equal(resolveFittingType('handleHardware').unit, '把');
  // 玻璃格条：分格自动派生，按装饰条(bead)型材逐根出料
  const grid = resolveFittingType('glassGridAddon');
  assert.equal(grid.host, 'area');
  assert.equal(grid.category, 'profile');
  assert.equal(grid.role, 'bead');
  assert.equal(grid.unit, '支');
});

test('配件出料行：profile 按宿主长度、五金按件数', () => {
  const row = computeFittingBomRow(resolveFittingType('frameAddon'), 2, { hostLen: 2400, hostId: 'frame' }, '配件窗');
  assert.equal(row.category, 'profile');
  assert.equal(row.quantity, 2);
  assert.ok(row.spec.includes('2400mm'));

  const hw = computeFittingBomRow(resolveFittingType('slideLockAddon'), 1, { hostLen: 2000 }, '配件窗');
  assert.equal(hw.category, 'hardware');
  assert.equal(hw.quantity, 1);
});

test('toDesignModel：树级+叶子级配件进入 DesignModel.fittings', () => {
  const tree = makeTree();
  splitArea(tree, tree.root!.id, 'vertical', 0.5, 40);
  const [a1] = tree.root!.children!;
  setSash(tree, a1.id, { windowType: 'fixed', label: 'F1' });
  a1.fittings = [{ id: 'f4', type: 'doubleSashAddon' }];
  const model = toDesignModel(tree, { installGap: GAP, name: '配件窗', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  assert.equal(model.fittings?.length, 4);
  const treeFit = model.fittings!.find((f) => f.hostKind === 'tree')!;
  assert.equal(treeFit.type, 'frameAddon');
  const areaFit = model.fittings!.find((f) => f.hostKind === 'area')!;
  assert.equal(areaFit.type, 'doubleSashAddon');
});

test('BOM：配件行并入下料（profile 出型材、hardware 出五金行）', () => {
  const tree = makeTree();
  const model = toDesignModel(tree, { installGap: GAP, name: '配件窗', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  assert.ok(bom.items.some((i) => i.name.includes('外框连接件') || i.name.includes('外框配件')));
  assert.ok(bom.items.some((i) => i.name === '防盗框锁点'));
  assert.ok(bom.items.some((i) => i.name === '平开锁'));
});

test('BOM：同宿主同类型配件多份时 key 唯一（避免 rowKey 冲突）', () => {
  const tree = createWindowTree({ openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: 60, name: '重复配件窗' });
  tree.fittings = [
    { id: 'a', type: 'theftAddon', count: 1 },
    { id: 'b', type: 'theftAddon', count: 1 },
  ];
  const model = toDesignModel(tree, { installGap: GAP, name: '重复配件窗', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  const fitKeys = bom.items.filter((i) => i.key.startsWith('fit-')).map((i) => i.key);
  assert.ok(fitKeys.length >= 2, '应至少产生两行配件');
  assert.equal(new Set(fitKeys).size, fitKeys.length, '配件行 key 不得重复');
});

test('拼樘配件：listFittingTypes(combiner)=3 类，setCombinerFittings 不可变且贯通 DesignModel→BOM', () => {
  const combinerTypes = listFittingTypes('combiner').map((d) => d.id);
  assert.deepEqual(combinerTypes.sort(), ['connectorAddon', 'cornerJoinerAddon', 'frameConnectAddon'].sort(), '拼樘宿主恰好 3 类配件');

  const a0 = assemblyFromWindowTree(makeTree());
  const { assembly, newCombinerId } = addLinearUnit(a0, { anchorUnitId: 'u1', axis: 'x', tree: makeTree() });
  const fit: WindowFitting = { id: 'cf1', type: 'connectorAddon', count: 1 };
  const a1 = setCombinerFittings(assembly, newCombinerId, [fit]);

  assert.equal(assembly.combiners[0].fittings, undefined, '原装配体不变（不可变）');
  assert.equal(a1.combiners[0].fittings?.length, 1);
  assert.equal(a1.combiners[0].fittings?.[0].type, 'connectorAddon');

  const model = toDesignModelAssembly(a1, { installGap: GAP, name: '拼樘配件窗', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const combFit = model.fittings?.find((f) => f.hostKind === 'combiner');
  assert.ok(combFit, '拼樘配件进入 DesignModel.fittings');
  assert.equal(combFit!.type, 'connectorAddon');

  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  assert.ok(bom.items.some((i) => i.name.includes('拼樘连接件')), 'BOM 出现拼樘连接件行');

  // 空数组清除：归一为 undefined
  const cleared = setCombinerFittings(a1, newCombinerId, []);
  assert.equal(cleared.combiners[0].fittings, undefined, '空数组归一为 undefined');
});

test('格条进下料：按逐根长度分组出型材行，手工加过同类型则不重复派生', () => {
  const mk = (): WindowTree => {
    const t = createWindowTree({ openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: 60, name: '格条窗' });
    t.root!.bars = { pattern: 'colonial', cols: 3, rows: 2 };
    return t;
  };
  const ctx = { installGap: GAP, name: '格条窗', seriesId: 'series-60', glassId: 'g-5-12a-5' };

  const model = toDesignModel(mk(), ctx);
  const fit = model.fittings?.find((f) => f.type === 'glassGridAddon');
  assert.ok(fit?.lengthsMm?.length, '派生配件应带逐根长度');
  assert.equal(fit!.count, fit!.lengthsMm!.length);

  const rows = computeBomFromDesignModel(model, series60, sampleLibrary).items.filter((i) => i.name === '玻璃格条');
  assert.equal(rows.reduce((s, i) => s + i.quantity, 0), 3, '2 竖 + 1 横 = 3 支');
  assert.equal(rows.length, 2, '两种长度各一行（同长度的两根竖条合并）');
  assert.ok(rows.every((i) => i.category === 'profile' && i.unit === '支'));
  assert.ok(rows.some((i) => i.spec.includes('940mm') && i.quantity === 2), '竖条按玻璃净高 940 出 2 支');

  const manual = mk();
  manual.root!.fittings = [{ id: 'g1', type: 'glassGridAddon' }];
  const m2 = toDesignModel(manual, ctx);
  assert.equal(m2.fittings?.filter((f) => f.type === 'glassGridAddon').length, 1, '已手工添加则不再自动派生');
});

test('装配路径：单元内的开启把手与玻璃格条同样出料（宿主 id 带单元前缀）', () => {
  const t = createWindowTree({ openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: 60, name: '装配格条窗' });
  t.root!.sash = { windowType: 'casement', hingeSide: 'left', openDirection: 'in', label: 'S1' };
  t.root!.bars = { pattern: 'rect' };
  const model = toDesignModelAssembly(assemblyFromWindowTree(t), { installGap: GAP, name: '装配格条窗', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  assert.ok(model.fittings?.some((f) => f.type === 'handleHardware' && f.hostId.startsWith('u1:')), '装配单元里的开启扇应出把手行');
  assert.ok(model.fittings?.some((f) => f.type === 'glassGridAddon' && f.hostId.startsWith('u1:')), '装配单元里的格条应出料');

  const gridRow = computeBomFromDesignModel(model, series60, sampleLibrary).items.find((i) => i.name === '玻璃格条');
  assert.ok(gridRow, 'BOM 出现玻璃格条型材行');
});