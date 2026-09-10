import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWindowTree, setSash, toDesignModel } from '../src/window-tree.js';
import { computeBomFromDesignModel } from '../src/bom-design-model.js';
import { computeCuttingList } from '../src/cutting.js';
import { quoteFromBom, defaultQuoteRuleSet } from '../src/quote-engine.js';
import { createDesign } from '../src/design.js';
import { series60, sampleLibrary } from '@wdd/schema';
import { outlineFourSides, sampleOutline, polygonLen } from '../src/outline.js';

const GAP = 20;

test('outlineFourSides：矩形精确 = 2w+2h 分段', () => {
  const sides = outlineFourSides(sampleOutline('rect', { x: 0, y: 0, w: 1000, h: 400 }, { inset: 0 }));
  assert.equal(Math.round(sides.top), 1000);
  assert.equal(Math.round(sides.bottom), 1000);
  assert.equal(Math.round(sides.left), 400);
  assert.equal(Math.round(sides.right), 400);
});

test('outlineFourSides：梯形顶/底/左右斜边分离', () => {
  const sides = outlineFourSides(sampleOutline('trapezoid', { x: 0, y: 0, w: 1000, h: 800 }, { inset: 0, topRatio: 0.6 }));
  assert.equal(Math.round(sides.top), 600); // 顶宽 0.6*1000
  assert.equal(Math.round(sides.bottom), 1000); // 底宽全宽
  assert.ok(Math.abs(sides.left - sides.right) < 1); // 左右斜边等长
  const slant = Math.hypot(200, 800); // 斜边 = sqrt(dx^2 + dy^2)
  assert.ok(Math.abs(sides.left - slant) < 1);
});

test('outlineFourSides：拱形/尖拱底边=直边宽（不膨胀超窗宽），四边和=周长', () => {
  for (const shape of ['arch', 'gothic'] as const) {
    const box = { x: 0, y: 0, w: 1000, h: 1200 };
    const pts = sampleOutline(shape, box, { inset: 0 });
    const sides = outlineFourSides(pts);
    assert.ok(sides.bottom <= box.w + 1, `${shape} 底边 ${sides.bottom.toFixed(0)} 不应超过窗宽 ${box.w}`);
    const perim = polygonLen(pts);
    const sum = sides.top + sides.bottom + sides.left + sides.right;
    assert.ok(Math.abs(sum - perim) < 1, `${shape} 四边和 ${sum.toFixed(1)} 应等于周长 ${perim.toFixed(1)}`);
  }
});

test('异形外框 BOM：按四边链出 4 根异形料，长度=轮廓边', () => {
  const tree = createWindowTree({ openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: 60, name: '梯形', frameShape: 'trapezoid' });
  const model = toDesignModel(tree, { installGap: GAP, name: '梯形', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  const rows = bom.items.filter((i) => i.name.includes('异形'));
  assert.equal(rows.length, 4); // 顶/底/左/右 各 1
  const frame = model.components.find((c) => c.kind === 'outerFrame')!;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < (frame.contour || []).length; i += 2) pts.push({ x: frame.contour![i], y: frame.contour![i + 1] });
  const sides = outlineFourSides(pts);
  const topRow = rows.find((r) => r.name === '外框顶料(异形)')!;
  assert.equal(topRow.quantity, 1);
  assert.ok(topRow.spec.includes(`${Math.max(1, Math.round(sides.top))}mm`), `顶料 spec ${topRow.spec} 应含 ${Math.round(sides.top)}mm`);
});

test('异形外框：矩形 BOM 完全不变（无异形料行）', () => {
  const rectTree = createWindowTree({ openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: 60, name: '矩形' });
  const model = toDesignModel(rectTree, { installGap: GAP, name: '矩形', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  assert.equal(bom.items.filter((i) => i.name.includes('异形')).length, 0);
});

test('异形外框报价：specialShape 命中异形窗加价行', () => {
  const tree = createWindowTree({ openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: 60, name: '尖拱', frameShape: 'gothic' });
  setSash(tree, tree.root!.id, { windowType: 'fixed', label: 'F1' });
  const model = toDesignModel(tree, { installGap: GAP, name: '尖拱', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  const rules = { ...defaultQuoteRuleSet, specialShapeUpcharge: 300 };
  const irrDesign = createDesign('fixed', { openingW: 1500, openingH: 1100, seriesId: 'series-60', name: '尖拱' }, series60);
  const special = quoteFromBom(irrDesign, series60, sampleLibrary, bom.items, rules, 1, 1, {
    specialShape: true,
    sashCount: 0,
  });
  assert.ok(special.lines.some((l) => l.key === 'special-shape'));

  const rectDesign = createDesign('fixed', { openingW: 1500, openingH: 1100, seriesId: 'series-60', name: '矩形' }, series60);
  const plain = quoteFromBom(rectDesign, series60, sampleLibrary, bom.items, rules, 1, 1, { specialShape: false, sashCount: 0 });
  assert.ok(!plain.lines.some((l) => l.key === 'special-shape'));
});

test('异形外框下料：切割清单覆盖四根异形料', () => {
  const tree = createWindowTree({ openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: 60, name: '梯形', frameShape: 'trapezoid' });
  const model = toDesignModel(tree, { installGap: GAP, name: '梯形', seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  const cutting = computeCuttingList(bom, series60);
  assert.ok(cutting.items.length > 0);
});

function fixedLeafModel(shape: 'trapezoid' | undefined, name: string) {
  const tree = createWindowTree({
    openingW: 2000,
    openingH: 2000,
    seriesId: 'series-60',
    glassId: 'g-5-12a-5',
    frameWidthMm: 60,
    name,
    frameShape: shape,
    topRatio: 0.6,
  });
  setSash(tree, tree.root!.id, { windowType: 'fixed', label: 'F' });
  const model = toDesignModel(tree, { installGap: GAP, name, seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  const glass = bom.items.find((i) => i.category === 'glass')!;
  const leaf = model.components.find((c) => c.kind === 'fixedGlass')!;
  return { model, bom, glass, leaf };
}

test('异形叶玻璃：写 contour 且按裁剪轮廓缩放（面积/计价均小于 bbox）', () => {
  const irr = fixedLeafModel('trapezoid', '梯形');
  const rect = fixedLeafModel(undefined, '矩形');

  // 异形叶写入裁剪轮廓；矩形叶不写
  assert.ok(irr.leaf.contour && irr.leaf.contour.length >= 6, '异形叶应写 contour');
  assert.equal(rect.leaf.contour, undefined, '矩形叶不写 contour');

  // 玻璃 spec 标注异形，金额按轮廓缩小
  assert.ok(irr.glass.spec.includes('异形'), `异形玻璃 spec 应标注异形: ${irr.glass.spec}`);
  assert.ok(!rect.glass.spec.includes('异形'), `矩形玻璃 spec 不应标注异形: ${rect.glass.spec}`);
  assert.ok(irr.glass.amount < rect.glass.amount, `异形玻璃金额 ${irr.glass.amount} 应小于矩形 ${rect.glass.amount}`);

  // 计价面积同步缩小（2000×2000 超过 1.5㎡ 下限，比较有意义）
  assert.ok(irr.bom.billedAreaM2 < rect.bom.billedAreaM2, `异形计价面积 ${irr.bom.billedAreaM2} 应小于矩形 ${rect.bom.billedAreaM2}`);
});

test('矩形叶玻璃：clip=1，spec 与金额完全不变（零回归）', () => {
  const rect = fixedLeafModel(undefined, '矩形');
  assert.equal(rect.leaf.contour, undefined);
  assert.ok(/^\d+x\d+$/.test(rect.glass.spec), `矩形玻璃 spec 应为纯 WxH: ${rect.glass.spec}`);
  const glass = sampleLibrary.glass.find((g) => g.id === 'g-5-12a-5') ?? sampleLibrary.glass[0];
  const [gw, gh] = rect.glass.spec.split('x').map(Number);
  const expected = Math.round(((gw * gh) / 1e6) * glass.unitPrice * 100) / 100;
  assert.equal(rect.glass.amount, expected);
});

function sashLeafModel(shape: 'trapezoid' | undefined, name: string, windowType: 'casement' | 'fixed') {
  const tree = createWindowTree({
    openingW: 2000,
    openingH: 2000,
    seriesId: 'series-60',
    glassId: 'g-5-12a-5',
    frameWidthMm: 60,
    name,
    frameShape: shape,
    topRatio: 0.6,
  });
  setSash(tree, tree.root!.id, { windowType, label: 'S' });
  const model = toDesignModel(tree, { installGap: GAP, name, seriesId: 'series-60', glassId: 'g-5-12a-5' });
  const bom = computeBomFromDesignModel(model, series60, sampleLibrary);
  return { model, bom };
}

test('异形平开扇：扇料按轮廓四边出 4 根异形料，压线按轮廓周长', () => {
  const { bom } = sashLeafModel('trapezoid', '梯形', 'casement');
  const sashPieces = bom.items.filter((i) => i.name.startsWith('扇料') && i.name.includes('异形'));
  assert.equal(sashPieces.length, 4, `应有 4 根异形扇料，实际 ${sashPieces.length}: ${sashPieces.map((p) => p.name).join(',')}`);
  for (const side of ['顶', '底', '左', '右']) {
    assert.ok(sashPieces.some((p) => p.name === `扇料${side}(异形)`), `缺 扇料${side}(异形)`);
  }
  // 不再输出 bbox 的 横/竖 扇料
  assert.equal(bom.items.filter((i) => i.name === '扇料(横)' || i.name === '扇料(竖)').length, 0);
  // 梯形顶边 < 底边
  const top = sashPieces.find((p) => p.name === '扇料顶(异形)')!;
  const bottom = sashPieces.find((p) => p.name === '扇料底(异形)')!;
  const topLen = Number(top.spec.match(/(\d+)mm/)![1]);
  const botLen = Number(bottom.spec.match(/(\d+)mm/)![1]);
  assert.ok(topLen < botLen, `梯形顶料 ${topLen}mm 应短于底料 ${botLen}mm`);
  // 压线标注异形
  const bead = bom.items.find((i) => i.name === '压线')!;
  assert.ok(bead.spec.includes('异形'), `异形压线 spec 应标注异形: ${bead.spec}`);
});

test('矩形平开扇：扇料仍为 横/竖，无异形标注（零回归）', () => {
  const { bom } = sashLeafModel(undefined, '矩形', 'casement');
  assert.ok(bom.items.some((i) => i.name === '扇料(横)'), '矩形应有 扇料(横)');
  assert.ok(bom.items.some((i) => i.name === '扇料(竖)'), '矩形应有 扇料(竖)');
  assert.equal(bom.items.filter((i) => i.name.includes('异形')).length, 0, '矩形 BOM 不应出现异形料');
  const bead = bom.items.find((i) => i.name === '压线')!;
  assert.ok(!bead.spec.includes('异形'), `矩形压线 spec 不应标注异形: ${bead.spec}`);
});
const GAP2 = 20;
type Side = 'up' | 'down' | 'left' | 'right';
const bomCtx = { installGap: GAP2, name: '缺边', seriesId: 'series-60', glassId: 'g-5-12a-5' };

function rectFrameBom(openSides?: Side[]) {
  const t = createWindowTree({
    openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5',
    frameWidthMm: 60, name: '缺边开放框', frameOpenSides: openSides,
  });
  setSash(t, t.root!.id, { windowType: 'fixed', label: 'F1' });
  return computeBomFromDesignModel(toDesignModel(t, bomCtx), series60, sampleLibrary).items;
}

test('缺边开放框：缺下边少一根框料，玻璃尺寸不受影响', () => {
  const closed = rectFrameBom();
  const open = rectFrameBom(['down']);
  const qty = (items: typeof closed): number =>
    items.filter((i) => i.category === 'profile' && /横框|竖框|外框横料|外框竖料/.test(i.name)).reduce((s, i) => s + i.quantity, 0);
  assert.equal(qty(closed), 4, '默认四边共 4 根框料');
  assert.equal(qty(open), 3, '缺下边应只剩 3 根');
  const glass = (items: typeof closed): string => items.find((i) => i.category === 'glass')?.spec ?? '';
  assert.ok(glass(closed).length > 0, '应有玻璃行');
  assert.equal(glass(open), glass(closed), '玻璃尺寸不随缺边变化');
});

test('缺边开放框：四边全缺按不缺处理（避免零根框料的怪状态）', () => {
  const items = rectFrameBom(['up', 'down', 'left', 'right']);
  const qty = items.filter((i) => i.category === 'profile' && /横框|竖框|外框横料|外框竖料/.test(i.name)).reduce((s, i) => s + i.quantity, 0);
  assert.equal(qty, 4, '四边全缺归一为不缺边');
});

test('缺边开放框（异形）：八边形缺上边不再出顶料行，其余三边照常', () => {
  const t = createWindowTree({
    openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5',
    frameWidthMm: 60, name: '八边缺上', frameShape: 'octagon', frameOpenSides: ['up'],
  });
  setSash(t, t.root!.id, { windowType: 'fixed', label: 'F1' });
  const names = computeBomFromDesignModel(toDesignModel(t, bomCtx), series60, sampleLibrary).items
    .filter((i) => i.name.includes('(异形)'))
    .map((i) => i.name);
  assert.ok(!names.includes('外框顶料(异形)'), `不应出现顶料行：${names.join(',')}`);
  assert.equal(names.length, 3, `其余三边应出料，实得 ${names.join(',')}`);
});
