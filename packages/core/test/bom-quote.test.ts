import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesign } from '../src/design.js';
import { computeBom } from '../src/bom.js';
import { computeQuote, defaultQuoteOptions } from '../src/quote.js';
import { computeCuttingList } from '../src/cutting.js';
import { optimizeCuttingPacks } from '../src/cutting-optimizer.js';
import { evaluateFormula } from '../src/formula.js';
import { series60, series108, sampleLibrary, type Profile, type SeriesSpec } from '@wdd/schema';

test('平开窗 BOM 完整计算', () => {
  const design = createDesign('casement', {
    openingW: 1500,
    openingH: 1500,
    seriesId: 'series-60',
    name: '平开窗BOM',
  }, series60);

  const bom = computeBom(design, series60, sampleLibrary);

  const frameRows = bom.items.filter((i) => i.name === '横框' || i.name === '竖框');
  assert.equal(frameRows.length, 2);
  assert.equal(frameRows.reduce((s, i) => s + i.quantity, 0), 4);

  const mullionRows = bom.items.filter((i) => i.name.startsWith('中梃'));
  assert.equal(mullionRows.length, 1);

  const sashRows = bom.items.filter((i) => i.name.startsWith('扇料'));
  assert.equal(sashRows.length, 2);

  const glassRows = bom.items.filter((i) => i.category === 'glass');
  assert.equal(glassRows.length, 2);

  const hardwareRows = bom.items.filter((i) => i.category === 'hardware');
  assert.equal(hardwareRows.length, 4);

  const beadRows = bom.items.filter((i) => i.name.includes('压线'));
  assert.equal(beadRows.length, 2);

  const sashHw = hardwareRows.find((h) => h.name === '传动器');
  assert.equal(sashHw?.quantity, 4);

  assert.ok(bom.totalAmount > 0);
});

test('推拉窗 BOM 使用上滑/下滑', () => {
  const design = createDesign('sliding', {
    openingW: 2000,
    openingH: 1500,
    seriesId: 'series-108',
    name: '推拉窗BOM',
  }, series108);

  const bom = computeBom(design, series108, sampleLibrary);
  assert.ok(bom.items.some((i) => i.name === '上滑'));
  assert.ok(bom.items.some((i) => i.name === '下滑'));
  assert.ok(bom.items.some((i) => i.name === '推拉滑轮'));
  assert.ok(bom.items.some((i) => i.name === '推拉锁'));
});

test('120 推拉系列使用 120 专属型材', () => {
  const series120: SeriesSpec = {
    id: 'series-120',
    name: '120系系统推拉',
    windowFamily: 'sliding',
    installGap: 20,
    frameWidth: 120,
    sashWidth: 68,
    overlap: 14,
    glassGap: 6,
    beadWidth: 18,
    cornerType: '45',
    aluminumPrice: 42,
    profileRoles: {
      frame: 'p-frame-120',
      sash: 'p-sash-120',
      mullion: 'p-mullion-120',
      track: 'p-track-120',
      sill: 'p-sill-120',
      bead: 'p-bead-120',
    },
    formulaBank: {},
    showSetting: {},
    cuts: [],
  };
  const design = createDesign('sliding', {
    openingW: 2200,
    openingH: 1600,
    seriesId: 'series-120',
    name: '120推拉窗',
  }, series120);

  const library120 = {
    ...sampleLibrary,
    series: [...sampleLibrary.series, series120],
    profiles: [
      ...sampleLibrary.profiles,
      profile120('p-frame-120', 'series-120', 'LK120-01', '框料120', 'frame', 120, 66),
      profile120('p-sash-120', 'series-120', 'LK120-02', '扇料120', 'sash', 68, 52),
      profile120('p-mullion-120', 'series-120', 'LK120-03', '中梃120', 'mullion', 90, 52),
      profile120('p-track-120', 'series-120', 'LK120-04', '上滑120', 'track', 100, 62),
      profile120('p-sill-120', 'series-120', 'LK120-05', '下滑120', 'sill', 110, 66),
      profile120('p-bead-120', 'series-120', 'LK120-06', '压线120', 'bead', 18, 11),
    ],
  };

  const bom = computeBom(design, series120, library120);
  const frameCodes = bom.items.filter((i) => i.category === 'profile').map((i) => i.code);
  assert.ok(frameCodes.some((code) => code === 'LK120-01'));
  assert.ok(frameCodes.some((code) => code === 'LK120-04'));
  assert.ok(frameCodes.some((code) => code === 'LK120-05'));
});

function profile120(
  id: string,
  seriesId: string,
  code: string,
  name: string,
  category: Profile['category'],
  sectionWidth: number,
  unitPrice: number,
): Profile {
  return { id, seriesId, code, name, category, sectionWidth, unitPrice, color: '香槟' };
}

test('报价计算：面积与费用', () => {
  const design = createDesign('casement', {
    openingW: 1500,
    openingH: 1500,
    seriesId: 'series-60',
    name: '报价窗',
  }, series60);

  const bom = computeBom(design, series60, sampleLibrary);
  const quote = computeQuote(design, series60, sampleLibrary, bom.items, defaultQuoteOptions);

  assert.equal(quote.openingAreaM2, 2.25);
  assert.ok(quote.billedAreaM2 >= quote.openingAreaM2);
  assert.ok(quote.lines.length >= 4);
  assert.equal(quote.discount, 0);
  assert.ok(quote.total > 0);
  assert.ok(quote.subtotal > quote.lines[0].amount * 0.9);
});

test('BOM 使用真实中梃剖面且包含辅料实体', () => {
  const design = createDesign('casement', {
    openingW: 1500,
    openingH: 1500,
    seriesId: 'series-60',
    name: '中梃辅料窗',
  }, series60);

  const bom = computeBom(design, series60, sampleLibrary);

  const mullionRow = bom.items.find((i) => i.name.startsWith('中梃'));
  assert.ok(mullionRow, '应有中梃行');
  assert.equal(mullionRow!.code, 'LK60-03', '中梃应使用真实中梃剖面而非回退为框料');

  const accessoryRows = bom.items.filter((i) => i.category === 'accessory');
  assert.ok(accessoryRows.length >= 4, '应包含密封胶条/毛条/垫块/螺丝等辅料');
  assert.ok(accessoryRows.some((i) => i.name.includes('密封胶条')));
  assert.ok(accessoryRows.every((i) => i.amount > 0));
  assert.ok(bom.billedAreaM2 > 0);
});

test('报价支持折扣', () => {
  const design = createDesign('casement', {
    openingW: 1500,
    openingH: 1500,
    seriesId: 'series-60',
    name: '折扣窗',
  }, series60);

  const bom = computeBom(design, series60, sampleLibrary);
  const full = computeQuote(design, series60, sampleLibrary, bom.items, defaultQuoteOptions);
  const discounted = computeQuote(design, series60, sampleLibrary, bom.items, {
    ...defaultQuoteOptions,
    discountRate: 0.1,
  });

  assert.equal(discounted.discount, Math.round(full.subtotal * 0.1 * 100) / 100);
  assert.equal(discounted.total, Math.round((full.subtotal - discounted.discount) * 100) / 100);
  assert.ok(discounted.total < full.subtotal);
  assert.ok(discounted.lines.some((l) => l.key === 'discount'));
});

test('生产下料单输出逐根型材并追溯构件', () => {
  const design = createDesign('casement', {
    openingW: 1500,
    openingH: 1500,
    seriesId: 'series-60',
    name: '生产下料窗',
  }, series60);

  const bom = computeBom(design, series60, sampleLibrary);
  const cutting = computeCuttingList(bom, series60, { defaultColor: '咖啡色', wasteRate: 0, stockLengthMm: 6000 });

  assert.ok(cutting.items.some((i) => i.name === '横框'));
  assert.ok(cutting.items.some((i) => i.name === '竖框'));
  assert.ok(cutting.items.some((i) => i.name.startsWith('中梃')));
  assert.ok(cutting.items.some((i) => i.name.startsWith('扇料')));
  // 压线按米计价（周长/1000），不进入逐根下料单
  assert.ok(bom.items.some((i) => i.name === '压线' && i.unit === '米'));
  assert.equal(cutting.items.some((i) => i.name.includes('压线')), false);
  assert.ok(cutting.items.every((i) => i.lengthMm > 0));
  assert.ok(cutting.items.every((i) => i.sourceComponentId));
  assert.ok(cutting.totalPieces > 0);
  assert.ok(cutting.totalLengthMm > 0);
  assert.ok(cutting.packs.length > 0);
  assert.ok(cutting.packs.every((p) => p.stockLengthMm === 6000));
});

test('排料优化会按同型材同颜色合并 6 米料', () => {
  const packs = optimizeCuttingPacks([
    {
      materialId: 'p-frame-60',
      code: 'LK60-01',
      name: '外框',
      color: '咖啡色',
      lengthMm: 2400,
      quantity: 2,
      sourceComponentId: 'frame-1',
      position: '外框',
    },
    {
      materialId: 'p-frame-60',
      code: 'LK60-01',
      name: '外框',
      color: '咖啡色',
      lengthMm: 1200,
      quantity: 1,
      sourceComponentId: 'frame-2',
      position: '外框',
    },
  ], { stockLengthMm: 6000, wasteRate: 0 });

  assert.ok(packs.length >= 1);
  assert.equal(packs[0].materialId, 'p-frame-60');
  assert.equal(packs[0].color, '咖啡色');
  assert.ok(packs[0].usedLengthMm > 0);
  assert.ok(packs[0].cuts.length >= 1);
});

test('公式计算支持白名单变量和基础运算', () => {
  const ok = evaluateFormula('outerW - 2 * gap + sashCount * 2', { outerW: 2200, gap: 20, sashCount: 2 });
  assert.equal(ok.ok, true);
  assert.equal(ok.value, 2164);

  const unknown = evaluateFormula('unknown + 1', { outerW: 2200 });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error ?? '', /未知变量/);

  const invalid = evaluateFormula('outerW; process.exit()', { outerW: 2200 });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error ?? '', /非法字符/);
});

test('型材公式优先走配置（出料行），缺省时回退到几何值', () => {
  const customSeries: SeriesSpec = {
    id: 'series-formula',
    name: '公式系列',
    windowFamily: 'casement',
    installGap: 20,
    frameWidth: 60,
    sashWidth: 45,
    overlap: 8,
    glassGap: 5,
    beadWidth: 15,
    cornerType: '45',
    aluminumPrice: 26.5,
    profileRoles: {
      frame: 'p-frame-60',
      sash: 'p-sash-60',
      mullion: 'p-mullion-60',
      bead: 'p-bead-60',
    },
    formulaBank: {},
    showSetting: {},
    cuts: [
      { id: 'frame-h', label: '边框(横)', role: 'frame', side: ['up', 'down'], length: 'frameOuterW - 100', count: '1', scope: 'window' },
      { id: 'frame-v', label: '边框(竖)', role: 'frame', side: ['left', 'right'], length: 'frameOuterH', count: '1', scope: 'window' },
      { id: 'sash-h', label: '扇料(横)', role: 'sash', side: ['up', 'down'], length: 'sashW + 25', count: 'sashCount*3', scope: 'panel' },
      { id: 'sash-v', label: '扇料(竖)', role: 'sash', side: ['left', 'right'], length: 'sashH', count: 'sashCount*3', scope: 'panel' },
      { id: 'bead', label: '压线', role: 'bead', side: ['up', 'down', 'left', 'right'], length: 'glassW*2+glassH*2', count: '1', unit: '米', scope: 'panel' },
    ],
  };

  const customLibrary = {
    ...sampleLibrary,
    series: [...sampleLibrary.series, customSeries],
    profiles: [
      ...sampleLibrary.profiles,
      profile120('p-frame-60', 'series-formula', 'LK60-01', '框料60', 'frame', 60, 42),
      profile120('p-sash-60', 'series-formula', 'LK60-02', '扇料60', 'sash', 45, 36),
      profile120('p-mullion-60', 'series-formula', 'LK60-03', '中梃60', 'mullion', 40, 30),
      profile120('p-bead-60', 'series-formula', 'LK60-04', '压线60', 'bead', 15, 9),
    ],
  };

  const design = createDesign('casement', {
    openingW: 1500,
    openingH: 1500,
    seriesId: 'series-formula',
    name: '公式窗',
  }, customSeries);

  const bom = computeBom(design, customSeries, customLibrary);
  const frameRow = bom.items.find((i) => i.name === '边框(横)');
  const sashRow = bom.items.find((i) => i.name === '扇料(横)');

  // frameOuterW = 1500 - 2×20 = 1460 → 1360；side 上下 2 边 × count 1 = 2 根
  assert.equal(frameRow?.spec.includes('1360mm'), true);
  assert.equal(frameRow?.quantity, 2);
  // sashW + 25 = 598；side 上下 2 边 × count（sashCount=1 → 3）= 6 根
  assert.equal(sashRow?.quantity, 6);
  assert.equal(sashRow?.spec.includes('598mm'), true);
});
