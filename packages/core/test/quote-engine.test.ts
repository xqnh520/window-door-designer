import { test } from 'node:test';
import assert from 'node:assert/strict';
import { series60, sampleLibrary, type DesignModel } from '@wdd/schema';
import { createDesign } from '../src/design.js';
import { computeBom, type BomResult } from '../src/bom.js';
import { defaultQuoteRuleSet, quoteFromBom, quoteFromDesignModel, type QuoteRuleSet } from '../src/quote-engine.js';

function baseQuote(rules: Partial<QuoteRuleSet> = {}, windowCount = 1, discountRate = 0, extra?: Parameters<typeof quoteFromBom>[7]) {
  const design = createDesign('casement', { openingW: 1500, openingH: 1500, seriesId: 'series-60', name: '报价引擎' }, series60);
  const bom = computeBom(design, series60, sampleLibrary);
  return quoteFromBom(design, series60, sampleLibrary, bom.items, { ...defaultQuoteRuleSet, ...rules }, windowCount, discountRate, extra);
}

test('成本模式默认规则：材料/辅料/加工/损耗齐全且无加价项', () => {
  const q = baseQuote();
  assert.equal(q.mode, 'cost');
  assert.ok(q.lines.some((l) => l.key === 'material'));
  assert.ok(q.lines.some((l) => l.key === 'accessory'));
  assert.ok(q.lines.some((l) => l.key === 'labor'));
  assert.ok(q.lines.some((l) => l.key === 'waste'));
  assert.ok(!q.lines.some((l) => l.key === 'sash-upcharge'));
  assert.ok(!q.lines.some((l) => l.key === 'color'));
  assert.ok(q.total > 0);
});

test('开启扇加价按扇数计入', () => {
  const q = baseQuote({ sashUpcharge: 200 });
  const line = q.lines.find((l) => l.key === 'sash-upcharge');
  assert.ok(line);
  assert.equal(line!.quantity, 1); // casement 1 扇
  assert.equal(line!.amount, 200);
});

test('颜色加价按计价面积命中', () => {
  const q = baseQuote({ colorUpcharges: { 咖啡色: 50 } }, 1, 0, { color: '咖啡色' });
  const line = q.lines.find((l) => l.key === 'color');
  assert.ok(line, '应命中颜色加价');
  assert.equal(line!.unitPrice, 50);
  assert.ok(line!.amount > 0);
  assert.equal(line!.quantity, q.billedAreaM2);
});

test('未命中的颜色不加价', () => {
  const q = baseQuote({ colorUpcharges: { 咖啡色: 50 } }, 1, 0, { color: '香槟' });
  assert.ok(!q.lines.some((l) => l.key === 'color'));
});

test('异形窗加价按樘计入', () => {
  const q = baseQuote({ specialShapeUpcharge: 300 }, 1, 0, { specialShape: true });
  const line = q.lines.find((l) => l.key === 'special-shape');
  assert.ok(line);
  assert.equal(line!.amount, 300);
  const plain = baseQuote({ specialShapeUpcharge: 300 });
  assert.ok(!plain.lines.some((l) => l.key === 'special-shape'), '非异形不加价');
});

test('玻璃与五金加价可配置命中', () => {
  const q = baseQuote({ glassUpchargePerM2: 40, hardwareUpcharges: { 进口五金: 500 } }, 1, 0, {
    glassId: 'g-5-9a-5low-e',
    hardware: '进口五金',
  });
  const glass = q.lines.find((l) => l.key === 'glass');
  assert.ok(glass);
  assert.equal(glass!.unitPrice, 40);
  const hw = q.lines.find((l) => l.key === 'hardware');
  assert.ok(hw);
  assert.equal(hw!.amount, 500);
});

test('包装与运输费按规则计入', () => {
  const q = baseQuote({ packagingPerUnit: 120, transportPerM2: 8 });
  const packaging = q.lines.find((l) => l.key === 'packaging');
  assert.ok(packaging);
  assert.equal(packaging!.amount, 120);
  const transport = q.lines.find((l) => l.key === 'transport');
  assert.ok(transport);
  assert.ok(transport!.amount > 0);
  assert.equal(transport!.quantity, q.billedAreaM2);
});

test('扩展加价项随樘数与折扣一起放大', () => {
  const q = baseQuote({ sashUpcharge: 200, packagingPerUnit: 100 }, 3, 0.1);
  const inclSash = q.lines.some((l) => l.key === 'sash-upcharge');
  assert.ok(inclSash);
  assert.equal(q.discount, Math.round(q.subtotal * 0.1 * 100) / 100);
  assert.equal(q.total, Math.round((q.subtotal - q.discount) * 100) / 100);
  assert.ok(q.total < q.subtotal);
});

test('面积报价模式与 BOM 解耦：按洞口面积×单价计', () => {
  const q = baseQuote({ areaPricePerM2: 680 }, 2, 0.1);
  assert.equal(q.mode, 'area');
  assert.ok(q.lines.some((l) => l.key === 'area'));
  assert.ok(!q.lines.some((l) => l.key === 'material'), '面积模式不含材料行');
  // 洞口面积 1500×1500 = 2.25㎡；2 樘；10% 折扣
  assert.equal(q.total, Math.round((2.25 * 680 * 2 * (1 - 0.1)) * 100) / 100);
});

test('同一设计可按不同报价策略计算（成本 vs 面积）', () => {
  const cost = baseQuote();
  const area = baseQuote({ areaPricePerM2: 680 });
  assert.notEqual(cost.mode, area.mode);
  assert.ok(cost.total > 0 && area.total > 0);
  assert.notEqual(cost.total, area.total);
  // 明细可解释：每条都有名称与来源说明
  for (const l of cost.lines) {
    assert.ok(l.name.length > 0);
    assert.ok(l.detail.length > 0);
  }
});

test('DesignModel 报价与同次 BOM 共用面积口径，不回退旧 panels', () => {
  const model: DesignModel = {
    id: 'model-quote',
    name: '组合窗报价',
    openingW: 2345,
    openingH: 1678,
    seriesId: series60.id,
    glassId: 'g-5-12a-5',
    components: [
      { id: 'frame-a', kind: 'outerFrame', x: 0, y: 0, w: 1100, h: 1638 },
      { id: 'frame-b', kind: 'outerFrame', x: 1120, y: 0, w: 1185, h: 1638 },
      { id: 'sash-a', kind: 'casementSash', x: 60, y: 60, w: 980, h: 1518, parentId: 'frame-a' },
      { id: 'sash-b', kind: 'topHungSash', x: 1180, y: 60, w: 1065, h: 1518, parentId: 'frame-b' },
    ],
  };
  const bom: BomResult = {
    billedAreaM2: 7.25,
    totalAmount: 120,
    items: [
      {
        key: 'profile-test',
        category: 'profile',
        materialId: 'p-test',
        code: 'P-TEST',
        name: '测试型材',
        spec: '1000mm',
        unit: '支',
        quantity: 1,
        unitPrice: 120,
        amount: 120,
      },
    ],
  };

  const quote = quoteFromDesignModel(
    model,
    bom,
    { ...defaultQuoteRuleSet, sashUpcharge: 80, transportPerM2: 10 },
    1,
    0,
  );

  assert.equal(quote.openingAreaM2, 3.93);
  assert.equal(quote.billedAreaM2, 7.25);
  assert.equal(quote.lines.find((line) => line.key === 'sash-upcharge')?.quantity, 2);
  assert.equal(quote.lines.find((line) => line.key === 'transport')?.quantity, 7.25);
});
