import { test } from 'node:test';
import assert from 'node:assert/strict';
import { series60, series108, sampleLibrary } from '@wdd/schema';
import { createDesign } from '../src/design.js';
import { computeBom, type BomItem } from '../src/bom.js';
import { computeCuttingList, defaultCuttingOptions } from '../src/cutting.js';
import { optimizeCuttingPacks } from '../src/cutting-optimizer.js';

test('下料单切角：中梃直角直切，外框/扇料按系列组角 45°', () => {
  const design = createDesign('casement', { openingW: 1500, openingH: 1500, seriesId: 'series-60', name: '切角测试' }, series60);
  const bom = computeBom(design, series60, sampleLibrary);
  const cutting = computeCuttingList(bom, series60);

  const mullion = cutting.items.find((i) => i.name.startsWith('中梃'));
  assert.ok(mullion, '应有中梃下料行');
  assert.equal(mullion!.cutAngleLeft, '90°');
  assert.equal(mullion!.cutAngleRight, '90°');

  const frame = cutting.items.find((i) => i.name === '横框' || i.name === '竖框');
  assert.ok(frame, '应有外框下料行');
  assert.equal(frame!.cutAngleLeft, '45°');
  assert.equal(frame!.cutAngleRight, '45°');
});

test('推拉窗下料包含上滑/下滑且可追溯构件', () => {
  const design = createDesign('sliding', { openingW: 2000, openingH: 1500, seriesId: 'series-108', name: '推拉下料' }, series108);
  const bom = computeBom(design, series108, sampleLibrary);
  const cutting = computeCuttingList(bom, series108);
  assert.ok(cutting.items.some((i) => i.position.includes('上滑') || i.name.includes('上滑')));
  assert.ok(cutting.items.some((i) => i.position.includes('下滑') || i.name.includes('下滑')));
  assert.ok(cutting.items.every((i) => i.sourceComponentId));
});

test('余料清单汇总：总余料 = 各余料之和，可再利用按阈值分类', () => {
  const design = createDesign('casement', { openingW: 1500, openingH: 1500, seriesId: 'series-60', name: '余料测试' }, series60);
  const bom = computeBom(design, series60, sampleLibrary);
  const cutting = computeCuttingList(bom, series60);

  assert.ok(Array.isArray(cutting.remnants));
  assert.equal(cutting.totalWasteMm, cutting.remnants.reduce((s, r) => s + r.lengthMm, 0));
  assert.equal(cutting.reusableWasteMm, cutting.remnants.filter((r) => r.reusable).reduce((s, r) => s + r.lengthMm, 0));
  assert.ok(cutting.remnants.every((r) => r.sourcePackIndex >= 0 && r.sourcePackIndex < cutting.packs.length));
  assert.ok(cutting.remnants.every((r) => r.lengthMm > 0));
});

test('长余料标记为可再利用，短余料不可再利用', () => {
  const profileItem = (name: string, lengthMm: number, quantity: number, sourceComponentId = 'c-1'): BomItem => ({
    key: `k-${name}`,
    category: 'profile',
    materialId: 'p-frame-60',
    code: 'LK60-01',
    name,
    spec: `${lengthMm}mm`,
    unit: '支',
    quantity,
    unitPrice: 42,
    amount: (lengthMm / 1000) * 42 * quantity,
    sourceComponentId,
  });
  // 2400×4 = 9600 → 两根 6000，每根余料 1200mm（可再利用）
  const reusable = computeCuttingList({ items: [profileItem('外框横料', 2400, 4)] }, series60, {
    ...defaultCuttingOptions,
    stockLengthMm: 6000,
    wasteRate: 0,
  });
  assert.ok(reusable.remnants.length >= 1);
  assert.ok(reusable.remnants.every((r) => r.reusable));
  assert.equal(reusable.reusableWasteMm, reusable.totalWasteMm);

  // 5900mm 单根 → 余料 100mm（低于 300 阈值，不可再利用）
  const short = computeCuttingList({ items: [profileItem('外框横料', 5900, 1)] }, series60, {
    ...defaultCuttingOptions,
    stockLengthMm: 6000,
    wasteRate: 0,
    minReuseLengthMm: 300,
  });
  assert.ok(short.remnants.length >= 1);
  assert.equal(short.remnants.every((r) => !r.reusable), true);
});

test('排料优化：同型材同颜色合并，余料与利用率统计一致', () => {
  const packs = optimizeCuttingPacks(
    [
      { materialId: 'p-frame-60', code: 'LK60-01', name: '外框', color: '咖啡色', lengthMm: 2400, quantity: 2, sourceComponentId: 'f1', position: '外框' },
      { materialId: 'p-frame-60', code: 'LK60-01', name: '外框', color: '咖啡色', lengthMm: 1200, quantity: 1, sourceComponentId: 'f2', position: '外框' },
    ],
    { stockLengthMm: 6000, wasteRate: 0 },
  );
  assert.ok(packs.length >= 1);
  assert.ok(packs.every((p) => p.materialId === 'p-frame-60' && p.color === '咖啡色'));
  assert.ok(packs[0].cuts.length >= 2, '同料合并在同根原料');
  assert.ok(packs[0].usedLengthMm > 0);
  assert.ok(packs.every((p) => p.usedLengthMm + p.wasteLengthMm <= p.stockLengthMm));
});