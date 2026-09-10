import { test } from 'node:test';
import assert from 'node:assert/strict';
import { series60, sampleLibrary } from '@wdd/schema';
import {
  createWindowTree,
  splitArea,
  equalDivide,
  walkAreas,
  removeSplit,
  setSash,
  removeSash,
  moveMuntin,
  findMuntin,
  layoutTree,
  layoutContours,
  toDesignComponents,
  toDesignModel,
  MIN_RATIO,
  type SashType,
  type WindowTree,
} from '../src/window-tree.js';
import { computeBomFromDesignModel } from '../src/bom-design-model.js';
import { computeCuttingList } from '../src/cutting.js';
import { polygonArea } from '../src/outline.js';
import { validateDesignModel } from '../src/validate-design.js';

const GAP = 20;
const FW = 60;

function makeTree(openingW = 1500, openingH = 1100): WindowTree {
  return createWindowTree({ openingW, openingH, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: FW, name: '树' });
}

test('创建：根为主内腔容器，比例 0,0,1,1', () => {
  const tree = makeTree();
  assert.ok(tree.root);
  assert.equal(tree.root!.kind, 'area');
  assert.deepEqual([tree.root!.xr, tree.root!.yr, tree.root!.wr, tree.root!.hr], [0, 0, 1, 1]);
  assert.equal(tree.frameWidthMm, FW);
});

test('分割：生成 [子区A, 中梃, 子区B]，比例与厚度正确', () => {
  const tree = makeTree();
  const rootId = tree.root!.id;
  assert.equal(splitArea(tree, rootId, 'vertical', 0.4), true);

  const root = tree.root!;
  const [a1, m, a2] = root.children!;
  assert.equal(a1.wr, 0.4);
  assert.equal(m.direction, 'vertical');
  assert.equal(m.ratio, 0.4);
  assert.equal(a2.xr, 0.4);
  assert.equal(a2.wr, 0.6);
  assert.ok(m.thicknessMm > 0);
});

test('分割约束：已分割/比例越界/区域不存在拒绝；已放扇的格子可分并派生两个独立扇', () => {
  const tree = makeTree();
  const rootId = tree.root!.id;

  assert.equal(splitArea(tree, rootId, 'vertical', 0.4), true);
  assert.equal(splitArea(tree, rootId, 'horizontal', 0.3), false, '已分割不可再分');

  // 实测 windoorcraft 语义：往已放扇的格子里加一根梃 = 拆成两个独立扇
  const leaf = tree.root!.children![0];
  assert.equal(setSash(tree, leaf.id, { windowType: 'casement', hingeSide: 'left', openDirection: 'in', label: 'S1' }), true);
  leaf.sash!.handle = { offsetMm: 8, fromBottomMm: 500 };
  assert.equal(splitArea(tree, leaf.id, 'vertical', 0.5), true, '已放扇可分割');
  const [c1, , c2] = leaf.children!;
  assert.equal(leaf.sash, undefined, '扇只活在叶子上，容器不再挂扇');
  assert.equal(c1.sash?.windowType, 'casement');
  assert.equal(c2.sash?.windowType, 'casement', '两侧都应是独立开启扇');
  assert.equal(c1.sash?.handle?.offsetMm, 8);
  assert.equal(c2.sash?.handle?.offsetMm, 8, '把手位置随扇继承');
  c1.sash!.handle!.offsetMm = 0;
  c1.sash!.windowType = 'fixed';
  assert.equal(c2.sash?.windowType, 'casement', '深拷贝：改一侧不影响另一侧');
  assert.equal(c2.sash?.handle?.offsetMm, 8, 'handle 也必须是副本');

  const fresh = makeTree();
  assert.equal(splitArea(fresh, fresh.root!.id, 'vertical', MIN_RATIO), false, '比例贴边拒绝');
  assert.equal(splitArea(fresh, fresh.root!.id, 'vertical', 1 - MIN_RATIO), false);
  assert.equal(splitArea(fresh, 'nope', 'vertical', 0.5), false);
});

test('等分已放扇的格子：得到 n 个各自独立的扇（含把手自动出料）', () => {
  const tree = makeTree();
  const rootId = tree.root!.id;
  assert.equal(setSash(tree, rootId, { windowType: 'casement', hingeSide: 'left', openDirection: 'in', label: 'S1' }), true);
  assert.equal(equalDivide(tree, rootId, 'vertical', 3), true);
  let sashes = 0;
  walkAreas(tree, (a) => {
    if (!a.children && a.sash) sashes++;
  });
  assert.equal(sashes, 3, '三等分应生成三个独立扇');
  const model = toDesignModel(tree, { installGap: 20, name: '等分扇', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  assert.equal(model.fittings?.filter((f) => f.type === 'handleHardware').length, 3, '每个开启扇各出一把把手');
});

test('扇位标注自动去重：放置不撞名，分割/等分序号顺延，覆盖同格不改名', () => {
  const tree = makeTree();
  splitArea(tree, tree.root!.id, 'vertical', 0.5, 40);
  const [c1, , c2] = tree.root!.children!;
  assert.equal(setSash(tree, c1.id, { windowType: 'casement', hingeSide: 'left', openDirection: 'in', label: 'A1' }), true);
  assert.equal(setSash(tree, c2.id, { windowType: 'casement', hingeSide: 'left', openDirection: 'in', label: 'A1' }), true);
  assert.equal(c1.sash!.label, 'A1');
  assert.equal(c2.sash!.label, 'A2', '同名自动顺延');
  assert.equal(c2.label, 'A2', '区域标号随扇同步');
  assert.equal(setSash(tree, c1.id, { windowType: 'fixed', label: 'A1' }), true);
  assert.equal(c1.sash!.label, 'A1', '覆盖同格原构件不该改名');

  const t2 = makeTree();
  setSash(t2, t2.root!.id, { windowType: 'casement', hingeSide: 'left', openDirection: 'in', label: 'A1' });
  assert.equal(splitArea(t2, t2.root!.id, 'horizontal', 0.5, 40), true);
  const [u1, , u2] = t2.root!.children!;
  assert.equal(u1.sash?.label, 'A1');
  assert.equal(u2.sash?.label, 'A2', '分割派生的第二扇自动换号');
  assert.equal(t2.root!.label, undefined, '容器不再保留扇标号');

  const t3 = makeTree();
  setSash(t3, t3.root!.id, { windowType: 'casement', hingeSide: 'left', openDirection: 'in', label: 'A1' });
  assert.equal(equalDivide(t3, t3.root!.id, 'vertical', 3), true);
  const labels: string[] = [];
  walkAreas(t3, (a) => {
    if (!a.children && a.sash?.label) labels.push(a.sash.label);
  });
  assert.deepEqual(labels.sort(), ['A1', 'A2', 'A3'], '三等分的三扇标号互不相同');

  const t4 = makeTree();
  splitArea(t4, t4.root!.id, 'vertical', 0.5, 40);
  const [s1, , s2] = t4.root!.children!;
  setSash(t4, s1.id, { windowType: 'screen', label: 'WC' });
  setSash(t4, s2.id, { windowType: 'screen', label: 'WC' });
  assert.equal(s2.sash!.label, 'WC2', '无数字后缀的标号也能顺延');
});

test('布局几何：单区=内腔；竖分割中梃占位、左右子区精确', () => {
  const tree = makeTree(1500, 1100);
  const layout = layoutTree(tree, { installGap: GAP });

  // 外框与内腔
  assert.deepEqual(layout.frame, { x: 20, y: 20, w: 1460, h: 1060 });
  const rootBox = layout.boxes.get(tree.root!.id)!;
  assert.deepEqual(rootBox, { x: 80, y: 80, w: 1340, h: 940 });

  // 竖分割 0.4，厚 40
  splitArea(tree, tree.root!.id, 'vertical', 0.4, 40);
  const l2 = layoutTree(tree, { installGap: GAP });
  const [a1, m, a2] = tree.root!.children!;
  // 中梃中心线 x = 80 + 1340*0.4 = 616
  assert.deepEqual(l2.boxes.get(m.id), { x: 596, y: 80, w: 40, h: 940 });
  assert.deepEqual(l2.boxes.get(a1.id), { x: 80, y: 80, w: 516, h: 940 });
  assert.deepEqual(l2.boxes.get(a2.id), { x: 636, y: 80, w: 784, h: 940 });
});

test('布局几何：递归分割形成 2×2 分格', () => {
  const tree = makeTree(1500, 1100);
  const rootId = tree.root!.id;
  splitArea(tree, rootId, 'vertical', 0.5, 40);
  splitArea(tree, tree.root!.children![0].id, 'horizontal', 0.5, 40);

  const layout = layoutTree(tree, { installGap: GAP });
  const [left, , ] = tree.root!.children!;
  const [tl, m2, bl] = left.children!;

  assert.ok(layout.boxes.has(tl.id) && layout.boxes.has(bl.id));
  const tlBox = layout.boxes.get(tl.id)!;
  const blBox = layout.boxes.get(bl.id)!;
  assert.equal(Math.round(tlBox.y), 80);
  assert.equal(Math.round(tlBox.h), 450);
  assert.equal(Math.round(blBox.y), 570);
  assert.equal(Math.round(blBox.w), tlBox.w, '左右子树宽度一致');
  assert.equal(layout.boxes.get(m2.id)!.h, 40, '横中梃厚度');
});

test('放置构件 / 移除构件 / 删除分割合并', () => {
  const tree = makeTree();
  const rootId = tree.root!.id;
  splitArea(tree, rootId, 'vertical', 0.45, 40);

  const [a1, , ] = tree.root!.children!;
  assert.equal(setSash(tree, a1.id, { windowType: 'fixed', label: 'F1' }), true);
  assert.equal(tree.root!.children![0].sash?.windowType, 'fixed');

  assert.equal(setSash(tree, a1.id, { windowType: 'screen', label: 'S1' }), true, '可覆盖构件');
  assert.equal(tree.root!.children![0].sash?.windowType, 'screen');

  assert.equal(removeSash(tree, a1.id), true);
  assert.equal(tree.root!.children![0].sash, undefined);

  assert.equal(removeSplit(tree, rootId), true);
  assert.equal(tree.root!.children, undefined);
  assert.equal(removeSash(tree, rootId), false, '未放构件不可移除');
});

test('重定位中梃：比例更新并同步两侧子区', () => {
  const tree = makeTree();
  const rootId = tree.root!.id;
  splitArea(tree, rootId, 'vertical', 0.4, 40);
  const muntinId = tree.root!.children![1].id;

  assert.equal(moveMuntin(tree, muntinId, 0.6), true);
  const [a1, m, a2] = tree.root!.children!;
  assert.equal(m.ratio, 0.6);
  assert.equal(a1.wr, 0.6);
  assert.equal(a2.xr, 0.6);
  assert.equal(a2.wr, 0.4);

  assert.equal(moveMuntin(tree, muntinId, 0.02), false, '比例越界拒绝');
  assert.equal(moveMuntin(tree, 'nope', 0.5), false);
  assert.ok(findMuntin(tree, muntinId), '可按 id 找到中梃');
});

test('转换：一固定一平开树 → DesignModel（几何/父级/校验通过）', () => {
  const tree = makeTree(1500, 1100);
  const rootId = tree.root!.id;
  splitArea(tree, rootId, 'vertical', 0.45, 40);
  const [a1, , a2] = tree.root!.children!;
  setSash(tree, a1.id, { windowType: 'fixed', label: 'F1' });
  setSash(tree, a2.id, { windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1' });

  const components = toDesignComponents(tree, { installGap: GAP, name: 't', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const kinds = components.map((c) => c.kind);
  assert.deepEqual(kinds.sort(), ['casementSash', 'fixedGlass', 'mullion', 'outerFrame']);

  const frame = components.find((c) => c.kind === 'outerFrame')!;
  const mullion = components.find((c) => c.kind === 'mullion')!;
  const fixed = components.find((c) => c.kind === 'fixedGlass')!;
  const sash = components.find((c) => c.kind === 'casementSash')!;

  assert.equal(fixed.parentId, frame.id);
  assert.equal(sash.parentId, frame.id);
  assert.equal(sash.hingeSide, 'left');
  assert.equal(sash.openDirection, 'out');
  // 竖分割 0.45 厚 40：中心线 x=80+1340*0.45=683，中梃 663..703
  assert.equal(mullion.x, 663);
  assert.equal(mullion.y, 80);
  assert.equal(fixed.w, 583);
  assert.equal(sash.x, 703);

  const model = toDesignModel(tree, { installGap: GAP, name: 't', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const issues = validateDesignModel(model, series60);
  assert.equal(issues.some((i) => i.level === 'error'), false, '树转换模型不应有 error');
  assert.ok(!issues.some((i) => i.code === 'MULLION_DISCONNECTED'), '内缘连接的中梃不应告警');

  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  assert.ok(bom.items.some((i) => i.category === 'glass'), '应含玻璃');
  assert.ok(bom.items.some((i) => i.name.includes('中梃')), '应含中梃');
  assert.ok(bom.totalAmount > 0);
});

test('转换 + BOM：纱窗输出纱扇料与不锈钢纱网，无玻璃行', () => {
  const tree = makeTree(900, 900);
  setSash(tree, tree.root!.id, { windowType: 'screen', label: 'S1' });

  const model = toDesignModel(tree, { installGap: GAP, name: '纱窗', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const screenComp = model.components.find((c) => c.kind === 'screen');
  assert.ok(screenComp, '转换应产出 screen 构件');
  assert.equal(screenComp!.windowType, undefined);

  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  assert.ok(bom.items.some((i) => i.name.includes('纱扇料')), '应含纱扇料');
  assert.ok(bom.items.some((i) => i.name.includes('纱网')), '应含不锈钢纱网');
  assert.equal(bom.items.some((i) => i.category === 'glass'), false, '纱窗无玻璃');

  const issues = validateDesignModel(model, series60);
  assert.equal(issues.some((i) => i.level === 'error'), false, '纱窗不应有 error');

  // 纱窗空树（无任何构件）应触发 NO_PANEL
  const empty = toDesignModel(createWindowTree({ openingW: 900, openingH: 900, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: FW, name: '空' }), {
    installGap: GAP,
    name: '空',
    seriesId: 'series-60',
    glassId: 'g-5-12a-5',
  });
  // 空树只有外框 → 校验提示缺面板，这是预期（用户还没放构件）
  const emptyIssues = validateDesignModel(empty, series60);
  assert.ok(emptyIssues.some((i) => i.code === 'NO_PANEL' && i.level === 'error'));
});

test('SashType 覆盖完整（含内开内倒与纱窗）', () => {
  const all: SashType[] = ['fixed', 'casement', 'sliding', 'topHinged', 'casementUp', 'screen'];
  const tree = makeTree(3000, 2200);
  let current = tree.root!;
  for (let i = 0; i < all.length; i++) {
    splitArea(tree, current.id, i % 2 === 0 ? 'vertical' : 'horizontal', 0.4, 30);
    setSash(tree, current.children![0].id, { windowType: all[i], label: `T${i}` });
    current = current.children![2]; // 右/下子区继续分割
  }
  const components = toDesignComponents(tree, { installGap: GAP, name: 't', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const kinds = new Set(components.map((c) => c.kind));
  assert.ok(kinds.has('fixedGlass'));
  assert.ok(kinds.has('casementSash'));
  assert.ok(kinds.has('slidingSash'));
  assert.ok(kinds.has('topHungSash'));
  assert.ok(kinds.has('screen'));
});
test('弧梃贯通：树 → 轮廓 → 描述 → DesignModel 弧长 → BOM 弧中梃行', () => {
  const t = createWindowTree({
    openingW: 1200, openingH: 1040, seriesId: 'series-60', glassId: 'g-5-12a-5',
    frameWidthMm: 60, muntinWidthMm: 40, muntinSagittaMm: 200, name: '弧梃窗',
  });
  assert.equal(splitArea(t, t.root!.id, 'vertical', 0.5), true, '应按整窗默认弧高建弧梃');
  const [a1, m, a2] = t.root!.children!;
  assert.equal(m.curve?.sagittaMm, 200);
  const contours = layoutContours(t, { installGap: 20 });
  assert.ok(contours.get(m.id)!.length > 8, '弧带轮廓应带弧采样点');
  assert.ok(contours.get(a1.id)!.length > 4 && contours.get(a2.id)!.length > 4, '两侧子区都应是被弧切出的多边形');

  const model = toDesignModel(t, { installGap: 20, name: '弧梃窗', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const mc = model.components.find((c) => c.id === m.id)!;
  assert.ok(mc.arcLenMm && mc.arcLenMm > mc.h, `弧长应大于弦高 ${mc.h}，实得 ${mc.arcLenMm}`);

  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  const row = bom.items.find((i) => i.name === '弧中梃(竖)');
  assert.ok(row, 'BOM 应出现弧中梃行');
  assert.equal(row!.quantity, 1);
  assert.ok(row!.spec.includes(String(mc.arcLenMm)), `行内长度应为弧长，spec=${row!.spec}`);
});

test('弧高为 0 时完全等同现状（直梃名、长度与轮廓开关均不变）', () => {
  const t = createWindowTree({
    openingW: 1200, openingH: 1040, seriesId: 'series-60', glassId: 'g-5-12a-5',
    frameWidthMm: 60, muntinWidthMm: 40, name: '直梃窗',
  });
  splitArea(t, t.root!.id, 'vertical', 0.5);
  const model = toDesignModel(t, { installGap: 20, name: '直梃窗', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const munt = model.components.find((c) => c.kind === 'mullion')!;
  assert.equal(munt.arcLenMm, undefined, '直梃不该有弧长');
  assert.equal(munt.contour, undefined, '矩形框 + 直梃不该带轮廓（与既有一致）');
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  assert.ok(bom.items.some((i) => i.name === '中梃(竖)'), '仍是普通中梃行');
});

test('斜梃贯通：树 → 轮廓/包围盒 → DesignModel 斜长 → BOM 斜中梃行 + 45° 切角，且不误触轴对齐校验', () => {
  const t = createWindowTree({
    openingW: 1200, openingH: 1040, seriesId: 'series-60', glassId: 'g-5-12a-5',
    frameWidthMm: FW, muntinWidthMm: 40, name: '斜梃窗',
  });
  const cavity = { w: 1200 - 2 * GAP - 2 * FW, h: 1040 - 2 * GAP - 2 * FW };
  assert.equal(splitArea(t, t.root!.id, 'diagonal', 0.5, 40, 0, cavity), true, '角到角斜梃应能切开出');
  const [a1, m, a2] = t.root!.children!;
  assert.equal(m.direction, 'diagonal');
  assert.equal(m.curve, undefined, '斜梃不该带弧高');
  setSash(t, a1.id, { windowType: 'fixed', label: 'F1' });
  setSash(t, a2.id, { windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1' });

  const contours = layoutContours(t, { installGap: GAP });
  const band = contours.get(m.id)!;
  const c1 = contours.get(a1.id)!;
  const c2 = contours.get(a2.id)!;
  assert.equal(c1.length, 3, '角到角斜梃把矩形切成两个三角形');
  assert.equal(c2.length, 3);
  const inner = cavity.w * cavity.h;
  const sum = Math.abs(polygonArea(c1)) + Math.abs(polygonArea(band)) + Math.abs(polygonArea(c2));
  assert.ok(Math.abs(sum - inner) / inner < 1e-3, `三块面积应守恒：${sum} vs ${inner}`);
  assert.ok(Math.abs(Math.abs(polygonArea(c1)) - Math.abs(polygonArea(c2))) < inner * 0.03, 'ratio 0.5 两侧应近似等积');

  const model = toDesignModel(t, { installGap: GAP, name: '斜梃窗', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const mc = model.components.find((c) => c.id === m.id)!;
  assert.equal(mc.slope, 'diagonal');
  const diag = Math.hypot(cavity.w, cavity.h);
  assert.ok(mc.arcLenMm && mc.arcLenMm <= diag && mc.arcLenMm > diag - 80, `斜料长应≈对角线 ${diag.toFixed(0)}，实得 ${mc.arcLenMm}`);
  assert.ok(mc.arcLenMm! > mc.w && mc.arcLenMm! > mc.h, '斜料长必须大于 bbox 任一边，按边算会少 √2');

  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  const row = bom.items.find((i) => i.name === '斜中梃(↘)');
  assert.ok(row, `BOM 应出现斜中梃行：${bom.items.map((i) => i.name).join(' / ')}`);
  assert.ok(row!.spec.includes(String(mc.arcLenMm)), `行内长度应是斜料中心线长，spec=${row!.spec}`);
  const cutting = computeCuttingList(bom, series60);
  const cut = cutting.items.find((i) => i.name === '斜中梃(↘)')!;
  assert.equal(cut.cutAngleLeft, '45°');
  assert.equal(cut.cutAngleRight, '45°');

  const issues = validateDesignModel(model, series60);
  const codes = issues.map((i) => i.code);
  assert.ok(!codes.includes('OVERLAP'), `斜梃相邻两格 bbox 重叠，但按轮廓不该报 OVERLAP：${codes.join(' / ')}`);
  assert.ok(
    !codes.some((c) => ['UNSEGMENTED', 'CELL_UNCOVERED', 'GRID_VIOLATION', 'MULLION_DISCONNECTED'].includes(c)),
    `斜梃不该触发轴对齐格检/连接类误报：${codes.join(' / ')}`,
  );
  assert.ok(
    issues.filter((i) => i.level === 'error').every((i) => i.code === 'SASH_SIZE'),
    `error 只允许按 bbox 计的开启扇尺寸上限：${JSON.stringify(issues)}`,
  );
});

test('斜梃约束：等分只做二分、宿主切不出带就拒绝、拖拽按对角偏移移动', () => {
  const t = createWindowTree({
    openingW: 1200, openingH: 1040, seriesId: 'series-60', glassId: 'g-5-12a-5',
    frameWidthMm: FW, muntinWidthMm: 40, name: '斜梃约束',
  });
  const cavity = { w: 1200 - 2 * GAP - 2 * FW, h: 1040 - 2 * GAP - 2 * FW };
  assert.equal(equalDivide(t, t.root!.id, 'diagonal', 3, GAP), false, '斜梃不支持三等分');
  assert.equal(equalDivide(t, t.root!.id, 'diagonal', 2, GAP), true);
  assert.equal(t.root!.children!.length, 3);
  const [, m] = t.root!.children!;
  assert.equal(m.direction, 'diagonal');

  const tiny = createWindowTree({ openingW: 200, openingH: 160, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: FW, name: '小窗' });
  assert.equal(
    splitArea(tiny, tiny.root!.id, 'diagonal', 0.5, 40, 0, { w: 200 - 2 * GAP - 2 * FW, h: 160 - 2 * GAP - 2 * FW }),
    false,
    '内腔太小时斜梃应被拒绝而不是留下重叠子区',
  );

  const before = m.ratio;
  assert.equal(moveMuntin(t, m.id, 0.75, cavity), true);
  assert.ok(Math.abs(m.ratio - 0.75) < 1e-9, `斜梃应能按对角偏移移动：${before} → ${m.ratio}`);
  const [a1, , a2] = t.root!.children!;
  assert.deepEqual([a1.xr, a1.yr, a1.wr, a1.hr], [0, 0, 1, 1], '斜子区的矩形分数是占位，真实包围盒由 layoutTree 给');
  const lay = layoutTree(t, { installGap: GAP });
  const b1 = lay.boxes.get(a1.id)!;
  const b2 = lay.boxes.get(a2.id)!;
  assert.ok(Math.min(b1.h, b2.h) < cavity.h - 1 && Math.min(b1.w, b2.w) < cavity.w - 1, '偏离角到角后小那一侧的包围盒应小于宿主区');
  assert.ok(Math.abs(b1.w * b1.h - b2.w * b2.h) > 1, 'ratio 0.75 时两侧包围盒不该仍相等');
});

test('弧梃退化：小格子配大弧高时回退成直梃行（不算弧长、不叫弧中梃）', () => {
  const t = createWindowTree({
    openingW: 400, openingH: 400, seriesId: 'series-60', glassId: 'g-5-12a-5',
    frameWidthMm: 60, muntinWidthMm: 40, muntinSagittaMm: 180, name: '退化',
  });
  assert.equal(splitArea(t, t.root!.id, 'vertical', 0.5), true);
  const model = toDesignModel(t, { installGap: 20, name: '退化', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const munt = model.components.find((c) => c.kind === 'mullion')!;
  assert.ok(munt, '应有中梃构件');
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  const names = bom.items.filter((i) => i.name.includes('中梃')).map((i) => `${i.name} ${i.spec}`);
  assert.ok(!names.some((n) => n.startsWith('弧中梃')), `退化后不该按弧出行：${names.join(' / ')}`);
  assert.ok(names.some((n) => n.startsWith('中梃(竖)') || n.startsWith('中梃(横)')), `应仍是普通中梃行：${names.join(' / ')}`);
});
