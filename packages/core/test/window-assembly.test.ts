import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleLibrary, sampleWindowTemplates, series60, type DesignModel } from '@wdd/schema';
import { createDesignModelFromTemplate } from '../src/window-template.js';
import { createWindowTree, splitArea, setSash, toDesignModel, type WindowTree } from '../src/window-tree.js';
import { computeBomFromDesignModel } from '../src/bom-design-model.js';
import { validateDesignModel } from '../src/validate-design.js';
import { describeAssembly } from '../src/window-assembly-describe.js';
import { assemblyFromDesignModel } from '../src/window-assembly-builder.js';
import {
  DEFAULT_COMBINER_MM,
  addLinearUnit,
  assemblyFromWindowTree,
  layoutAssembly,
  removeUnit,
  setCombinerAngle,
  setUnitTree,
  toDesignModelAssembly,
  windowTreeOfAssembly,
  type WindowAssembly,
} from '../src/window-assembly.js';
import {
  applyPlacement,
  combinerDisplayLabel,
  composePlacementChain,
  normalizeAngleDeg,
  transformBox,
  withDefaultAngles,
  type Vec2,
} from '../src/window-assembly-corner.js';
import type { BomResult } from '../src/bom.js';

const GAP = 20;
const FW = 60;
const CTX = { installGap: GAP, name: 't', seriesId: series60.id, glassId: 'g-5-12a-5' };

function tree(w = 1000, h = 1000): WindowTree {
  return createWindowTree({ openingW: w, openingH: h, seriesId: series60.id, glassId: 'g-5-12a-5', frameWidthMm: FW, name: '单元' });
}

function splitTree(): WindowTree {
  const t = tree(1500, 1100);
  splitArea(t, t.root!.id, 'vertical', 0.45, 40);
  const [a1, , a2] = t.root!.children!;
  setSash(t, a1.id, { windowType: 'fixed', label: 'F1' });
  setSash(t, a2.id, { windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1' });
  return t;
}

test('装配兼容：单框树 ↔ 1 单元装配体互转', () => {
  const t = tree();
  const a = assemblyFromWindowTree(t);
  assert.equal(a.units.length, 1);
  assert.equal(a.combiners.length, 0);
  assert.equal(windowTreeOfAssembly(a), t, '单单元应还原原树');
  assert.equal(windowTreeOfAssembly(addLinearUnit(a, { anchorUnitId: 'u1', axis: 'x', tree: tree() }).assembly), null, '多单元返回 null');
});

test('layoutAssembly：两单元左右并排 + 竖拼樘几何严丝合缝', () => {
  const a = assemblyFromWindowTree(tree(1000, 1000));
  const { assembly } = addLinearUnit(a, { anchorUnitId: 'u1', axis: 'x', tree: tree(1000, 1000), thicknessMm: 40 });
  const layout = layoutAssembly(assembly, { installGap: GAP });
  assert.equal(layout.units.size, 2);
  assert.equal(layout.combiners.size, 1);

  const fa = layout.units.get('u1')!.frame;
  const [cid] = [...layout.combiners.keys()];
  const cb = layout.combiners.get(cid)!;
  const fb = [...layout.units.entries()][1][1].frame;

  // frameA.right == 拼樘.left；拼樘.right == frameB.left
  assert.equal(fa.x + fa.w, cb.x, '拼樘左缘贴 A 框右缘');
  assert.equal(cb.x + cb.w, fb.x, '拼樘右缘贴 B 框左缘');
  assert.equal(cb.w, 40, '拼樘厚度');
  assert.equal(cb.h, Math.min(fa.h, fb.h), '拼樘高=共享跨度');
  // bbox = 外接并集
  assert.equal(layout.bbox.x, Math.min(fa.x, fb.x, cb.x));
  assert.equal(layout.bbox.x + layout.bbox.w, Math.max(fa.x + fa.w, fb.x + fb.w, cb.x + cb.w));
});

test('toDesignModelAssembly：单单元 == toDesignModel 几何（id 加前缀）', () => {
  const t = splitTree();
  const plain = toDesignModel(t, CTX);
  const asm = toDesignModelAssembly(assemblyFromWindowTree(t), CTX);
  assert.equal(asm.components.length, plain.components.length);
  for (let i = 0; i < plain.components.length; i++) {
    const p = plain.components[i];
    const a = asm.components[i];
    assert.equal(a.id, `u1:${p.id}`, '全部 id 命名空间化');
    assert.deepEqual([a.x, a.y, a.w, a.h], [p.x, p.y, p.w, p.h], '几何逐字节一致');
  }
});

test('toDesignModelAssembly：两单元 → 2 外框 + 各板归属正确 + 1 拼樘', () => {
  const a = assemblyFromWindowTree(tree(1200, 1000));
  const { assembly } = addLinearUnit(a, { anchorUnitId: 'u1', axis: 'x', tree: tree(1200, 1000) });
  const model = toDesignModelAssembly(assembly, CTX);
  const frames = model.components.filter((c) => c.kind === 'outerFrame');
  const combiners = model.components.filter((c) => c.kind === 'combiner');
  assert.equal(frames.length, 2);
  assert.equal(combiners.length, 1);
  const frameIds = new Set(frames.map((f) => f.id));
  for (const f of frames) assert.match(f.id, /^u[^:]*:frame$/);
  for (const c of model.components) {
    if (c.kind === 'outerFrame' || c.kind === 'combiner') continue;
    assert.ok(c.parentId && frameIds.has(c.parentId), '非框构件父级指向所属外框');
  }
});

test('装配模型校验：无 error、有 MULTI_FRAME info、拼樘不被 OUT_OF_FRAME 标记', () => {
  const a = assemblyFromWindowTree(splitTree());
  const { assembly } = addLinearUnit(a, { anchorUnitId: 'u1', axis: 'x', tree: splitTree() });
  const model = toDesignModelAssembly(assembly, CTX);
  const issues = validateDesignModel(model, series60);
  assert.equal(issues.some((i) => i.level === 'error'), false, '组合装配不应有 error');
  assert.ok(issues.some((i) => i.code === 'MULTI_FRAME' && i.level === 'info'), '应有组合窗 info');
  const combinerId = model.components.find((c) => c.kind === 'combiner')!.id;
  assert.equal(issues.some((i) => i.code === 'OUT_OF_FRAME' && i.componentId === combinerId), false, '拼樘不应越界');
});

test('装配 BOM：框料两份 + 一条拼樘料行', () => {
  const a = assemblyFromWindowTree(tree(1200, 1000));
  const { assembly } = addLinearUnit(a, { anchorUnitId: 'u1', axis: 'x', tree: tree(1200, 1000) });
  const model = toDesignModelAssembly(assembly, CTX);
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  assert.equal(bom.items.filter((i) => i.name === '横框').length, 2, '两樘横料');
  const comb = bom.items.filter((i) => i.name.startsWith('拼樘料'));
  assert.equal(comb.length, 1, '一条拼樘料');
  assert.ok(comb[0].amount > 0);
  assert.ok(bom.totalAmount > 0);
});

test('describeAssembly：元素数=Σ各单元+拼樘，id 全前缀，拼樘 kind=combiner', () => {
  const a = assemblyFromWindowTree(splitTree()); // 4 元素（框+中梃+2叶）
  const { assembly } = addLinearUnit(a, { anchorUnitId: 'u1', axis: 'x', tree: splitTree() });
  const els = describeAssembly(assembly, GAP);
  const combiners = els.filter((e) => e.kind === 'combiner');
  assert.equal(combiners.length, 1);
  assert.equal(combiners[0].type, 'combiner');
  assert.equal(els.length - combiners.length, 8, '两单元各 4 元素');
  const nonCombIds = els.filter((e) => e.kind !== 'combiner').map((e) => e.id);
  assert.ok(nonCombIds.every((id) => id.startsWith('u1:') || id.startsWith('u-')), '单元内元素 id 命名空间化');
});

test('往返：tpl-combo-two-fixed → 装配体 → 模型保留 2 框 2 板 + 拼樘', () => {
  const tpl = sampleWindowTemplates.find((t) => t.id === 'tpl-combo-two-fixed')!;
  const src = createDesignModelFromTemplate(tpl, { openingW: 2000, openingH: 1200, series: series60, seriesId: series60.id, glassId: 'g-5-12a-5', name: '组合' });
  const assembly = assemblyFromDesignModel(src, { installGap: GAP, name: '组合', seriesId: series60.id, glassId: 'g-5-12a-5', frameWidthMm: FW });
  assert.ok(assembly, '应反推出装配体');
  assert.equal(assembly!.units.length, 2, '两单元（旧树反推会丢第二框）');
  assert.equal(assembly!.combiners.length, 1);
  const back = toDesignModelAssembly(assembly!, CTX);
  assert.equal(back.components.filter((c) => c.kind === 'outerFrame').length, 2, '2 外框');
  assert.equal(back.components.filter((c) => c.kind === 'fixedGlass').length, 2, '2 固定玻璃');
  assert.equal(back.components.filter((c) => c.kind === 'combiner').length, 1);
  assert.equal(validateDesignModel(back, series60).some((i) => i.level === 'error'), false);
});

test('结构操作：addLinearUnit / removeUnit 不可变且链重接', () => {
  const a = assemblyFromWindowTree(tree());
  const { assembly: a2, newUnitId } = addLinearUnit(a, { anchorUnitId: 'u1', axis: 'y', tree: tree() });
  assert.equal(a.units.length, 1, '原装配体不变');
  assert.equal(a2.units.length, 2);
  assert.equal(a2.combiners.length, 1);
  assert.deepEqual(a2.combiners[0].between, ['u1', newUnitId]);
  assert.equal(a2.combiners[0].axis, 'y');
  assert.equal(a2.combiners[0].thicknessMm, DEFAULT_COMBINER_MM);

  const a3 = removeUnit(a2, newUnitId);
  assert.equal(a3.units.length, 1);
  assert.equal(a3.combiners.length, 0);
  assert.equal(a2.units.length, 2, 'remove 不改动 a2');
});

test('组合校验回归：普通多框模型（无拼樘）仍不误报', () => {
  const model: DesignModel = {
    id: 'm',
    name: '两框',
    openingW: 2000,
    openingH: 1000,
    seriesId: series60.id,
    glassId: 'g-5-12a-5',
    components: [
      { id: 'f1', kind: 'outerFrame', x: 20, y: 20, w: 960, h: 960 },
      { id: 'g1', kind: 'fixedGlass', x: 80, y: 80, w: 840, h: 840, parentId: 'f1' },
      { id: 'f2', kind: 'outerFrame', x: 1020, y: 20, w: 960, h: 960 },
      { id: 'g2', kind: 'fixedGlass', x: 1080, y: 80, w: 840, h: 840, parentId: 'f2' },
    ],
  };
  const issues = validateDesignModel(model, series60);
  assert.equal(issues.some((i) => i.level === 'error'), false);
  assert.ok(issues.some((i) => i.code === 'MULTI_FRAME' && i.level === 'info'));
});

// ── M2 转角拼接 ────────────────────────────────────────────

/** 带一块固定玻璃的单框树（空格叶子会被校验判 NO_PANEL，与转角无关） */
function leafTree(w: number, h: number): WindowTree {
  const t = tree(w, h);
  setSash(t, t.root!.id, { windowType: 'fixed', label: 'F1' });
  return t;
}

/** 两同规框 + 一条给定夹角的横向拼接 */
function cornerAssembly(angleDeg: number): WindowAssembly {
  const a = assemblyFromWindowTree(leafTree(1200, 1000));
  return addLinearUnit(a, { anchorUnitId: 'u1', axis: 'x', tree: leafTree(1200, 1000), angleDeg }).assembly;
}

function closeVec(a: Vec2, b: Vec2, eps = 1e-6): void {
  assert.ok(Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps, `${JSON.stringify(a)} ≉ ${JSON.stringify(b)}`);
}

/** 夹角回归锁快照：随机 id 按出现次序别名化、label 单独断言，其余字段必须逐字节相同 */
function shopSnapshot(model: DesignModel) {
  const alias = new Map<string, string>();
  const key = (id: string): string => {
    let a = alias.get(id);
    if (!a) {
      a = `#${alias.size}`;
      alias.set(id, a);
    }
    return a;
  };
  return {
    ...model,
    id: '<random>',
    components: model.components.map((c) => ({
      ...c,
      label: undefined,
      id: key(c.id),
      parentId: c.parentId ? key(c.parentId) : undefined,
    })),
  };
}

/** BOM 指纹：剔除 name/key（转角料名称本就不同）与随机构件引用，保留一切量与价 */
function bomFingerprint(bom: BomResult) {
  return {
    items: bom.items.map((i) => ({
      category: i.category,
      materialId: i.materialId,
      code: i.code,
      spec: i.spec,
      unit: i.unit,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      amount: i.amount,
    })),
    totalAmount: bom.totalAmount,
    billedAreaM2: bom.billedAreaM2,
  };
}

test('M2-H1 全 180°：显示变换恒等且 displayBbox ≡ bbox（M1b 回归锁）', () => {
  for (const axis of ['x', 'y'] as const) {
    const a = assemblyFromWindowTree(tree(1200, 1000));
    const { assembly } = addLinearUnit(a, { anchorUnitId: 'u1', axis, tree: tree(1200, 1000) });
    const L = layoutAssembly(assembly, { installGap: GAP });
    assert.equal(L.placement.size, 2);
    assert.equal(L.combinerPlacement.size, 1);
    for (const p of [...L.placement.values(), ...L.combinerPlacement.values()]) {
      assert.deepEqual(p, { rotationDeg: 0, translate: { x: 0, y: 0 } }, '直线链每段必须恒等');
    }
    assert.deepEqual(L.displayBbox, L.bbox, '直线链显示外接 == 加工外接');
  }
});

test('M2-H2 转角 90°/135°：偏转角正确、铰点为不动点、两腿显示外接不相交', () => {
  for (const [deg, theta] of [
    [90, -90],
    [135, -45],
  ] as const) {
    const a = cornerAssembly(deg);
    const L = layoutAssembly(a, { installGap: GAP });
    const [id0, id1] = a.units.map((u) => u.id);
    const p0 = L.placement.get(id0)!;
    const p1 = L.placement.get(id1)!;
    const f0 = L.units.get(id0)!.frame;
    const f1 = L.units.get(id1)!.frame;

    assert.equal(p0.rotationDeg, 0, '锚腿永不旋转');
    assert.equal(p1.rotationDeg, theta, `${deg}° 夹角 ⇒ 偏转 ${theta}°`);

    const hinge = { x: f1.x, y: f1.y };
    closeVec(applyPlacement(p0, hinge), applyPlacement(p1, hinge), 1e-6);

    const b0 = transformBox(p0, f0);
    const b1 = transformBox(p1, f1);
    const ox = Math.min(b0.x + b0.w, b1.x + b1.w) - Math.max(b0.x, b1.x);
    const oy = Math.min(b0.y + b0.h, b1.y + b1.h) - Math.max(b0.y, b1.y);
    assert.ok(ox <= 1e-6 || oy <= 1e-6, `${deg}° 两腿 AABB 不应重叠`);

    const cid = a.combiners[0].id;
    assert.equal(L.combinerPlacement.get(cid)!.rotationDeg, 0, '转角料随上游腿');
    const comb = L.combiners.get(cid)!;
    assert.equal(comb.x + comb.w, f1.x, '加工空间：转角料右缘贴下游框左缘');

    assert.ok(L.displayBbox.x >= 0 && L.displayBbox.y >= 0, '显示外接已归一化到非负');
    const boxes = [
      ...a.units.map((u) => transformBox(L.placement.get(u.id)!, L.units.get(u.id)!.frame)),
      ...a.combiners.map((c) => transformBox(L.combinerPlacement.get(c.id)!, L.combiners.get(c.id)!)),
    ];
    let ux = Infinity;
    let uy = Infinity;
    let ur = -Infinity;
    let ub = -Infinity;
    for (const b of boxes) {
      ux = Math.min(ux, b.x);
      uy = Math.min(uy, b.y);
      ur = Math.max(ur, b.x + b.w);
      ub = Math.max(ub, b.y + b.h);
    }
    closeVec({ x: L.displayBbox.x, y: L.displayBbox.y }, { x: ux, y: uy });
    closeVec({ x: L.displayBbox.w, y: L.displayBbox.h }, { x: ur - ux, y: ub - uy }, 1e-4);
    for (const b of boxes) {
      assert.ok(
        b.x >= L.displayBbox.x - 1e-4 &&
          b.y >= L.displayBbox.y - 1e-4 &&
          b.x + b.w <= L.displayBbox.x + L.displayBbox.w + 1e-4 &&
          b.y + b.h <= L.displayBbox.y + L.displayBbox.h + 1e-4,
        '每个显示元素都落在 displayBbox 内（画布不会裁掉转角腿）',
      );
    }
  }
});

test('M2-H3 回归锁：夹角不改变加工空间几何、BOM 量价与洞口尺寸', () => {
  const assembly = cornerAssembly(180);
  const cid = assembly.combiners[0].id;
  const base = toDesignModelAssembly(assembly, CTX);
  const baseBom = computeBomFromDesignModel(base, series60, sampleLibrary);
  assert.equal(base.components.find((c) => c.kind === 'combiner')!.label, '拼樘料');

  for (const deg of [135, 90]) {
    const model = toDesignModelAssembly(setCombinerAngle(assembly, cid, deg), CTX);
    assert.deepEqual(shopSnapshot(model), shopSnapshot(base), `${deg}° 构件几何与 180° 完全一致`);
    assert.deepEqual(
      bomFingerprint(computeBomFromDesignModel(model, series60, sampleLibrary)),
      bomFingerprint(baseBom),
      `${deg}° BOM 量价与 180° 完全一致`,
    );
    assert.equal(model.components.find((c) => c.kind === 'combiner')!.label, '转角料', '仅名称随角度变化');
  }

  const cornerBom = computeBomFromDesignModel(
    toDesignModelAssembly(setCombinerAngle(assembly, cid, 90), CTX),
    series60,
    sampleLibrary,
  );
  const cornerItem = cornerBom.items.filter((i) => i.name.startsWith('转角料'));
  assert.equal(cornerItem.length, 1, '转角出「转角料」行');
  const f0 = layoutAssembly(assembly, { installGap: GAP }).units.get('u1')!.frame;
  assert.ok(cornerItem[0].spec.includes(`${Math.round(f0.h)}mm`), '转角料下料长=框高，与角度无关');
});

test('M2-H4 校验：三档角度均无 error 且 MULTI_FRAME 仍 info（显示坐标未泄入校验）', () => {
  for (const deg of [180, 135, 90]) {
    const issues = validateDesignModel(toDesignModelAssembly(cornerAssembly(deg), CTX), series60);
    assert.equal(issues.some((i) => i.level === 'error'), false, `${deg}° 不应有 error`);
    assert.ok(issues.some((i) => i.code === 'MULTI_FRAME' && i.level === 'info'), `${deg}° 仍识别为组合窗`);
  }
});

test('M2-H5 旧数据兼容：缺 angleDeg 归 180，非法轴/值一律回落', () => {
  const legacy = JSON.parse(JSON.stringify(cornerAssembly(90))) as { combiners: { angleDeg?: number }[] };
  for (const c of legacy.combiners) delete c.angleDeg;
  assert.equal(legacy.combiners[0].angleDeg, undefined, '构造出真实的旧数据形态');

  const fixed = withDefaultAngles(legacy as unknown as WindowAssembly);
  assert.equal(fixed.combiners[0].angleDeg, 180);
  const L = layoutAssembly(fixed, { installGap: GAP });
  assert.deepEqual(L.displayBbox, L.bbox, '旧数据 ⇒ 直线行为');

  assert.equal(normalizeAngleDeg({ axis: 'y', angleDeg: 90 }), 180, '纵向叠框不接受转角');
  assert.equal(normalizeAngleDeg({ axis: 'x', angleDeg: 47 }), 180, '非预设值回落');
  assert.equal(normalizeAngleDeg({ axis: 'x', angleDeg: 90 }), 90);
  assert.equal(combinerDisplayLabel({ axis: 'x', angleDeg: 135 }), '转角料');
  assert.equal(combinerDisplayLabel({ axis: 'x', angleDeg: 180 }), '拼樘料');
});

test('M2-H6 链重接保角度：addLinearUnit / removeUnit / setUnitTree 不丢既有 angleDeg', () => {
  const a90 = cornerAssembly(90);
  const { assembly: a3, newUnitId } = addLinearUnit(a90, {
    anchorUnitId: a90.units[1].id,
    axis: 'x',
    tree: tree(800, 800),
  });
  assert.equal(a3.combiners.length, 2);
  assert.equal(a3.combiners[0].angleDeg, 90, '上游转角保留');
  assert.equal(a3.combiners[1].angleDeg, 180, '新段默认直线');

  assert.equal(removeUnit(a3, newUnitId).combiners[0].angleDeg, 90, '删除下游单元后仍保留');
  const removed = removeUnit(a3, newUnitId);
  assert.equal(setUnitTree(removed, removed.units[0].id, tree(1300, 1000)).combiners[0].angleDeg, 90, '回写树后仍保留');
});

test('M2-H7 composePlacementChain 纯数学：全零恒等 / 绕铰平移 / 累计偏转', () => {
  const j = (x: number, y: number, deflectionDeg: number) => ({ pivotUnfolded: { x, y }, deflectionDeg });

  assert.deepEqual(composePlacementChain([]), []);
  assert.deepEqual(composePlacementChain([j(0, 0, 0)]), [{ rotationDeg: 0, translate: { x: 0, y: 0 } }]);
  assert.deepEqual(composePlacementChain([j(0, 0, 0), j(100, 0, 0), j(200, 0, 0)]), [
    { rotationDeg: 0, translate: { x: 0, y: 0 } },
    { rotationDeg: 0, translate: { x: 0, y: 0 } },
    { rotationDeg: 0, translate: { x: 0, y: 0 } },
  ]);

  const one = composePlacementChain([j(0, 0, 0), j(10, 0, -90)]);
  assert.equal(one[1].rotationDeg, -90);
  closeVec(one[1].translate, { x: 10, y: 10 });
  closeVec(applyPlacement(one[1], { x: 10, y: 0 }), { x: 10, y: 0 });

  const two = composePlacementChain([j(0, 0, 0), j(100, 0, -45), j(200, 0, -45)]);
  assert.deepEqual(two.map((p) => p.rotationDeg), [0, -45, -90]);
  for (let i = 1; i < two.length; i++) {
    closeVec(applyPlacement(two[i - 1], { x: 100 * i, y: 0 }), applyPlacement(two[i], { x: 100 * i, y: 0 }));
  }

  const back = composePlacementChain([j(0, 0, 0), j(100, 0, -90), j(200, 0, -90)]);
  assert.deepEqual(back.map((p) => p.rotationDeg), [0, -90, -180], '连续两个直角 ⇒ 第三腿反向 180°');
  closeVec(applyPlacement(back[1], { x: 200, y: 0 }), applyPlacement(back[2], { x: 200, y: 0 }));
});

test('M2-H8 setCombinerAngle 不可变且拒绝非法值/纵向', () => {
  const a = cornerAssembly(180);
  const id = a.combiners[0].id;
  const b = setCombinerAngle(a, id, 90);
  assert.equal(a.combiners[0].angleDeg, 180, '原装配体不变');
  assert.equal(b.combiners[0].angleDeg, 90);
  assert.notEqual(a.combiners[0], b.combiners[0]);

  assert.equal(setCombinerAngle(b, id, 47).combiners[0].angleDeg, 180, '非预设回落直线');
  assert.equal(setCombinerAngle(b, 'not-a-combiner', 135).combiners[0].angleDeg, 90, '未知 id 不改动');

  const single = assemblyFromWindowTree(tree(1200, 1000));
  const { assembly: ay, newCombinerId } = addLinearUnit(single, { anchorUnitId: 'u1', axis: 'y', tree: tree(1200, 1000) });
  assert.equal(newCombinerId, ay.combiners[0].id, 'addLinearUnit 回报新拼樘 id 供 UI 选中');
  assert.equal(setCombinerAngle(ay, newCombinerId, 90).combiners[0].angleDeg, 180, '纵向拼接不产生转角');
});

// ── M3 自由拖拽拼接（before 插入：左/上） ──────────────────

test('M3-H1 左拼接：before=true + axis=x → 新框在锚左侧、拼樘严丝合缝、自由尺寸保留', () => {
  const base = assemblyFromWindowTree(leafTree(1200, 1000)); // frame 1160x960
  const { assembly, newUnitId, newCombinerId } = addLinearUnit(base, {
    anchorUnitId: 'u1',
    axis: 'x',
    before: true,
    tree: leafTree(900, 700), // frame 860x660，尺寸完全自由
  });

  assert.equal(assembly.units[0].id, newUnitId, '新框插到链首（左）');
  assert.equal(assembly.units[1].id, 'u1', '锚被顶到右侧');
  assert.equal(assembly.units.length, 2);
  assert.equal(assembly.combiners.length, 1);
  const c = assembly.combiners[0];
  assert.equal(c.id, newCombinerId);
  assert.equal(c.axis, 'x');
  assert.equal(c.angleDeg, 180, '自由拼接恒为直线拼樘');
  assert.ok(c.between.includes(newUnitId) && c.between.includes('u1'));

  const L = layoutAssembly(assembly, { installGap: GAP });
  const fNew = L.units.get(newUnitId)!.frame;
  const fAnchor = L.units.get('u1')!.frame;
  const cb = L.combiners.get(newCombinerId)!;

  assert.equal(assembly.units[0].tree.openingW, 900, '自由宽');
  assert.equal(assembly.units[0].tree.openingH, 700, '自由高');
  assert.equal(fNew.y, fAnchor.y, '顶部对齐');
  assert.equal(fNew.x + fNew.w, cb.x, '拼樘左缘贴新框右缘');
  assert.equal(cb.x + cb.w, fAnchor.x, '拼樘右缘贴锚框左缘');
  assert.equal(cb.w, 40, '拼樘厚度');
  assert.equal(cb.h, Math.min(fNew.h, fAnchor.h), '拼樘高=公共跨段');
  assert.equal(L.bbox.x, fNew.x, 'bbox 最左 = 新框左缘');
  assert.deepEqual(L.displayBbox, L.bbox, '180° 显示≡加工');
});

test('M3-H1b 链中间插前：三单元链在中间锚的前方插入，重接不乱', () => {
  const a0 = assemblyFromWindowTree(leafTree(1000, 1000));
  const { assembly: a1, newUnitId: u2 } = addLinearUnit(a0, { anchorUnitId: 'u1', axis: 'x', tree: leafTree(1000, 1000) });
  const { assembly: a2, newUnitId: u3 } = addLinearUnit(a1, { anchorUnitId: u2, axis: 'x', tree: leafTree(1000, 1000) });
  assert.equal(a2.units.length, 3);
  assert.equal(a2.combiners.length, 2);

  const u1 = a2.units[0].id;
  const { assembly: a3 } = addLinearUnit(a2, { anchorUnitId: u2, axis: 'x', before: true, tree: leafTree(1100, 900) });
  assert.equal(a3.units.length, 4, '插前新增一单元');
  const newId = a3.units[1].id;
  assert.deepEqual(a3.units.map((u) => u.id), [u1, newId, u2, u3], '新框插在 u1 与 u2 之间');
  assert.equal(a3.combiners.length, 3, '三段拼樘');
  const L = layoutAssembly(a3, { installGap: GAP });
  const prev = L.units.get(u1)!.frame;
  const cur = L.units.get(newId)!.frame;
  const next = L.units.get(u2)!.frame;
  assert.ok(cur.x >= prev.x + prev.w, '与上游无重叠');
  assert.ok(next.x >= cur.x + cur.w, '与下游无重叠');
  assert.deepEqual(L.displayBbox, L.bbox);
});

test('M3-H2 上拼接：before=true + axis=y → 新框在锚上方、横拼樘贴合', () => {
  const base = assemblyFromWindowTree(leafTree(1200, 1000));
  const { assembly, newUnitId, newCombinerId } = addLinearUnit(base, {
    anchorUnitId: 'u1',
    axis: 'y',
    before: true,
    tree: leafTree(1000, 800),
  });
  const L = layoutAssembly(assembly, { installGap: GAP });
  const fNew = L.units.get(newUnitId)!.frame;
  const fAnchor = L.units.get('u1')!.frame;
  const cb = L.combiners.get(newCombinerId)!;

  assert.equal(assembly.units[0].id, newUnitId);
  assert.equal(L.bbox.y, fNew.y, '新框在最上');
  assert.equal(fNew.x, fAnchor.x, '左侧对齐');
  assert.equal(fNew.y + fNew.h, cb.y, '拼樘顶缘贴新框底缘');
  assert.equal(cb.y + cb.h, fAnchor.y, '拼樘底缘贴锚框顶缘');
  assert.equal(cb.h, 40, '横拼樘厚度');
  assert.equal(cb.w, Math.min(fNew.w, fAnchor.w), '拼樘宽=公共跨段');
});

test('M3-H3 回归锁：before=false 与旧调用（不传 before）布局逐字节一致', () => {
  const mk = (withBefore: boolean) =>
    addLinearUnit(assemblyFromWindowTree(tree(1200, 1000)), {
      anchorUnitId: 'u1',
      axis: 'x',
      tree: tree(1200, 1000),
      ...(withBefore ? { before: false } : {}),
    }).assembly;
  const L1 = layoutAssembly(mk(false), { installGap: GAP });
  const L2 = layoutAssembly(mk(true), { installGap: GAP });
  assert.deepEqual(L1.bbox, L2.bbox);
  const flat = (L: typeof L1) => [...L.units.values()].map((v) => v.frame);
  assert.deepEqual(flat(L1), flat(L2), 'frame 几何逐字节一致（id 系随机，忽略）');
  assert.deepEqual(L1.combiners.size, 1);
});

test('M3-H4 尺寸自由：不等高左右拼接合法，拼樘料=BOM 公共段长度', () => {
  const { assembly } = addLinearUnit(assemblyFromWindowTree(leafTree(1200, 1000)), {
    anchorUnitId: 'u1',
    axis: 'x',
    tree: leafTree(800, 600), // 高 600 < 锚 1000，frame 660 < 960
  });
  const L = layoutAssembly(assembly, { installGap: GAP });
  const [, fNew] = [...L.units.entries()][1];
  const cb = [...L.combiners.values()][0];
  assert.equal(fNew.frame.h, 600 - 2 * GAP, '新框保持拖拽高度');
  assert.equal(cb.h, fNew.frame.h, '拼樘仅覆盖公共高段（较短框全高）');
  assert.ok(L.bbox.h >= fNew.frame.h && L.bbox.h === 1000 - 2 * GAP, 'bbox 尺寸不被矮框压缩');

  const model = toDesignModelAssembly(assembly, CTX);
  const comb = model.components.find((c) => c.kind === 'combiner')!;
  assert.equal(comb.h, 600 - 2 * GAP);
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  const row = bom.items.find((i) => i.name.startsWith('拼樘料'));
  assert.ok(row, '出现拼樘料行');
  assert.ok(row!.spec.includes(`${600 - 2 * GAP}mm`), '拼樘料长=公共段，与角度无关');
});
