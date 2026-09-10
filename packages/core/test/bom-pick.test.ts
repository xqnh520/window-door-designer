import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IInventory, IMaterial, MaterialCategory, MaterialUnit } from '@wdd/schema';
import { sampleLibrary, series60 } from '@wdd/schema';
import type { BomItem } from '../src/bom.js';
import { computeBom } from '../src/bom.js';
import { createDesign } from '../src/design.js';
import {
  applyManualMaterial,
  buildPickLines,
  matchMaterial,
  pickQuantity,
  pickStockLine,
  validatePickLines,
  type PickLine,
} from '../src/bom-pick.js';

function mat(p: Partial<IMaterial> & { id: string; name: string }): IMaterial {
  return {
    code: p.code ?? `CODE-${p.id}`,
    category: (p.category ?? 'profile') as MaterialCategory,
    specModel: p.specModel ?? '',
    color: p.color ?? '',
    unit: (p.unit ?? '米') as MaterialUnit,
    brand: p.brand ?? '',
    status: p.status ?? 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isDeleted: false,
    ...p,
  } as IMaterial;
}

function inv(p: Partial<IInventory> & { materialId: string }): IInventory {
  return {
    warehouseId: 'WH01',
    locationCode: 'A-01-01',
    currentQty: 0,
    lockedQty: 0,
    availableQty: 0,
    safetyStock: 0,
    ...p,
  } as IInventory;
}

function bomItem(p: Partial<BomItem> & { key: string; name: string }): BomItem {
  return {
    category: 'profile',
    materialId: `lib-${p.key}`,
    code: '',
    spec: '',
    unit: '米',
    quantity: 2,
    unitPrice: 10,
    amount: 20,
    ...p,
  } as BomItem;
}

test('matchMaterial：编码精确命中优先于名称', () => {
  const materials = [
    mat({ id: 'm1', code: 'LK60-01', name: '框料60', category: 'profile', specModel: '60' }),
    mat({ id: 'm2', code: 'AL-OTHER-01', name: '框料60', category: 'profile' }),
  ];
  const hit = matchMaterial(bomItem({ key: 'k', name: '框料60', code: 'LK60-01' }), materials);
  assert.equal(hit?.material.id, 'm1');
  assert.equal(hit?.by, 'code');
});

test('matchMaterial：编码大小写与空格不敏感', () => {
  const materials = [mat({ id: 'm1', code: 'HW-HG01', name: '平开合页', category: 'hardware', unit: '只' })];
  assert.equal(matchMaterial(bomItem({ key: 'k', name: 'x', code: ' hw-hg01 ' }), materials)?.material.id, 'm1');
});

test('matchMaterial：玻璃行 code 等于名称时靠名称命中', () => {
  const materials = [
    mat({ id: 'g1', code: 'GL-5-12A-5-01', name: '5+12A+5 中空玻璃', category: 'glass', unit: '平方米' }),
  ];
  const hit = matchMaterial(bomItem({ key: 'k', name: '5+12A+5 中空玻璃', code: '5+12A+5 中空玻璃', category: 'glass', unit: '块' }), materials);
  assert.equal(hit?.material.id, 'g1');
  assert.equal(hit?.by, 'name');
});

test('matchMaterial：名称互含可命中，取更长的档案名', () => {
  const materials = [
    mat({ id: 'g-short', code: 'GL-A', name: '中空玻璃', category: 'glass' }),
    mat({ id: 'g-long', code: 'GL-B', name: '5+12A+5 中空玻璃', category: 'glass' }),
  ];
  const hit = matchMaterial(bomItem({ key: 'k', name: '5+12A+5 中空玻璃', category: 'glass' }), materials);
  assert.equal(hit?.material.id, 'g-long');
});

test('matchMaterial：同分类且规格互含时降级命中', () => {
  const materials = [mat({ id: 'm1', code: 'AL-X', name: '完全不同的名字', category: 'profile', specModel: '60*40*1.5' })];
  const hit = matchMaterial(bomItem({ key: 'k', name: '某型材', spec: '60*40*1.5', category: 'profile' }), materials);
  assert.equal(hit?.material.id, 'm1');
  assert.equal(hit?.by, 'spec');
});

test('matchMaterial：跨分类不按规格匹配，停用与已删档案不参与', () => {
  const glassSpec = mat({ id: 'g1', code: 'GL-X', name: '别的', category: 'glass', specModel: '60*40' });
  const inactive = mat({ id: 'm2', code: 'AL-X', name: '别的', category: 'profile', specModel: '60*40', status: 'inactive' });
  const deleted = mat({ id: 'm3', code: 'AL-X', name: '别的', category: 'profile', specModel: '60*40', isDeleted: true });
  const item = bomItem({ key: 'k', name: '某型材', spec: '60*40', category: 'profile' });
  assert.equal(matchMaterial(item, [glassSpec, inactive, deleted]), null);
});

test('pickStockLine：优先指定仓库，否则取可用量最大行', () => {
  const rows = [
    inv({ materialId: 'm1', warehouseId: 'WH01', locationCode: 'A-01-01', availableQty: 5 }),
    inv({ materialId: 'm1', warehouseId: 'WH02', locationCode: 'C-01-01', availableQty: 80 }),
    inv({ materialId: 'm2', warehouseId: 'WH02', locationCode: 'C-01-01', availableQty: 9 }),
  ];
  assert.equal(pickStockLine('m1', rows, 'WH01')?.warehouseId, 'WH01');
  assert.equal(pickStockLine('m1', rows, 'WH03')?.warehouseId, 'WH02');
  assert.equal(pickStockLine('m1', rows)?.locationCode, 'C-01-01');
  assert.equal(pickStockLine('m9', rows), null);
});

test('buildPickLines：未匹配 / 无库存行 / 单位不一致三种状态', () => {
  const materials = [
    mat({ id: 'm1', code: 'LK60-01', name: '框料60', category: 'profile', unit: '米' }),
    mat({ id: 'g1', code: 'GL-1', name: '5mm 单片玻璃', category: 'glass', unit: '平方米' }),
  ];
  const inventory = [inv({ materialId: 'm1', availableQty: 12, currentQty: 12 })];
  const lines = buildPickLines(
    [
      bomItem({ key: 'f', name: '框料60', code: 'LK60-01', materialId: 'p-frame-60', quantity: 4 }),
      bomItem({ key: 'g', name: '5mm 单片玻璃', code: '5mm 单片玻璃', category: 'glass', unit: '块', materialId: 'g-5mm' }),
      bomItem({ key: 'h', name: '执手', code: 'HW-HD01', category: 'hardware', unit: '支' }),
    ],
    { materials, inventory },
  );

  assert.equal(lines[0].status, 'matched');
  assert.equal(lines[0].materialId, 'm1');
  assert.equal(lines[0].availableQty, 12);
  assert.equal(lines[0].warning, null);
  // 样例库 id 不能当成服务端 id 提交
  assert.equal(lines[0].bomMaterialId, 'p-frame-60');

  assert.equal(lines[1].status, 'no-stock', '档案有、库存行没有 → 需先入库');
  assert.equal(lines[1].materialId, 'g1');
  assert.match(lines[1].warning ?? '', /单位不一致/);

  assert.equal(lines[2].status, 'unmatched');
  assert.equal(lines[2].materialId, null);
});

test('applyManualMaterial：手工指定后重挑库存行，清空则回到 unmatched', () => {
  const materials = [mat({ id: 'm1', code: 'HW-HD01', name: '执手', category: 'hardware', unit: '支' })];
  const ctx = { materials, inventory: [inv({ materialId: 'm1', availableQty: 7 })] };
  const line = buildPickLines([bomItem({ key: 'h', name: '神秘五金件', category: 'hardware', unit: '支' })], ctx)[0];
  assert.equal(line.status, 'unmatched');

  const manual = applyManualMaterial(line, materials[0], ctx);
  assert.equal(manual.status, 'matched');
  assert.equal(manual.matchBy, 'manual');
  assert.equal(manual.availableQty, 7);

  const cleared = applyManualMaterial(manual, null, ctx);
  assert.equal(cleared.status, 'unmatched');
  assert.equal(cleared.materialId, null);
});

test('pickQuantity 与 validatePickLines：樘数相乘、逐条给出阻断原因', () => {
  const line = { quantityPerSet: 2.5 } as PickLine;
  assert.equal(pickQuantity(line, 2), 5);
  assert.equal(pickQuantity(line, 0), 2.5, '樘数非法时按 1 樘');
  assert.equal(pickQuantity({ quantityPerSet: 1.005 } as PickLine, 2), 2.01);

  const problems = validatePickLines(
    [
      { name: '未匹配项', materialId: null, warehouseId: null, locationCode: null, quantityPerSet: 1 } as PickLine,
      { name: '无库存行', materialId: 'm1', warehouseId: null, locationCode: null, quantityPerSet: 1 } as PickLine,
      { name: '正常项', materialId: 'm2', warehouseId: 'WH01', locationCode: 'A-01-01', quantityPerSet: 0 } as PickLine,
    ],
    1,
  );
  assert.equal(problems.length, 3);
  assert.match(problems[0], /未匹配到物料档案/);
  assert.match(problems[1], /没有库存行/);
  assert.match(problems[2], /数量必须大于 0/);
});

test('真实 BOM：按样例库建档后应全部命中', () => {
  const design = createDesign('casement', { openingW: 1500, openingH: 1500, seriesId: 'series-60', name: '领料测试' }, series60);
  const bom = computeBom(design, series60, sampleLibrary);
  assert.ok(bom.items.length > 0);

  // 用样例库自身的 code / name / unit 建一份档案（玻璃无 code，用名称当 code 反而不符合实际，这里留空靠名称匹配）
  const materials: IMaterial[] = [
    ...sampleLibrary.profiles.map((p) => mat({ id: p.id, code: p.code, name: p.name, category: 'profile', unit: '米' })),
    ...sampleLibrary.glass.map((g) => mat({ id: g.id, code: '', name: g.name, category: 'glass', unit: '块' })),
    ...sampleLibrary.hardware.map((h) => mat({ id: h.id, code: h.code, name: h.name, category: 'hardware', unit: h.unit })),
    ...sampleLibrary.accessory.map((a) => mat({ id: a.id, code: a.code, name: a.name, category: 'accessory', unit: a.unit })),
  ];
  const inventory = materials.map((m) => inv({ materialId: m.id, currentQty: 500, availableQty: 500 }));

  const lines = buildPickLines(bom.items, { materials, inventory });
  const unmatched = lines.filter((l) => l.status === 'unmatched');
  assert.deepEqual(
    unmatched.map((l) => `${l.category}/${l.name}/${l.bomCode}`),
    [],
    '样例库建档后不应有未匹配行',
  );
  assert.ok(lines.every((l) => l.warehouseId === 'WH01' && l.locationCode === 'A-01-01'));
  assert.ok(lines.some((l) => l.matchBy === 'code'), '型材/五金/辅料应走编码匹配');
  assert.ok(lines.some((l) => l.matchBy === 'name'), '玻璃应走名称匹配');
});
