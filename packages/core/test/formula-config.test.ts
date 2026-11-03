import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleLibrary, sampleWindowTemplates, series108, series60, type DesignModel, type SeriesSpec } from '@wdd/schema';
import { computeBomFromDesignModel } from '../src/bom-design-model.js';
import { computeCuttingList } from '../src/cutting.js';
import { evaluateFormula, extractFormulaVariables } from '../src/formula.js';
import {
  PROFILE_ROLE_LABEL,
  WINDOW_TYPE_ROLES,
  evaluateCutCondition,
  formulaContextFromDesignModel,
  formulaContextFromPanel,
  resolveCutFormulaRef,
  validateCutRows,
} from '../src/formula-context.js';
import { createDesign } from '../src/design.js';
import { createDesignModelFromTemplate } from '../src/window-template.js';
import { computeGeometry } from '../src/geometry.js';

function buildModel(series: SeriesSpec, templateId: string, openingW: number, openingH: number, name: string) {
  const template = sampleWindowTemplates.find((t) => t.id === templateId)!;
  return createDesignModelFromTemplate(template, {
    openingW,
    openingH,
    series,
    seriesId: series.id,
    glassId: 'g-5-12a-5',
    name,
  });
}

test('出料行：cc-N 引用与内联表达式作用于型材清单与下料单；缺省回退内置', () => {
  const customSeries: SeriesSpec = {
    ...series60,
    formulaBank: { '99': 'frameOuterW - 100' },
    cuts: [
      { id: 'frame-h', label: '边框(横)', role: 'frame', side: ['up', 'down'], length: 'cc-99', count: '1', scope: 'window' },
      { id: 'frame-v', label: '边框(竖)', role: 'frame', side: ['left', 'right'], length: 'frameOuterH', count: '1', scope: 'window' },
      { id: 'sash-h', label: '扇料(横)', role: 'sash', side: ['up', 'down'], length: 'sashW + 25', count: 'sashCount*3', scope: 'panel' },
      { id: 'sash-v', label: '扇料(竖)', role: 'sash', side: ['left', 'right'], length: 'sashH', count: 'sashCount*3', scope: 'panel' },
      { id: 'bead', label: '压线', role: 'bead', side: ['up', 'down', 'left', 'right'], length: 'glassW*2+glassH*2', count: '1', unit: '米', scope: 'panel' },
    ],
  };
  const model = buildModel(customSeries, 'tpl-fixed-casement-right', 1500, 1500, '模型公式窗');
  const bom = computeBomFromDesignModel(model, customSeries, sampleLibrary);

  // cc-99 → frameOuterW - 100；frameOuterW = 1500 - 2×20 = 1460 → 1360
  const frameRow = bom.items.find((i) => i.name === '边框(横)');
  assert.ok(frameRow, '应有边框(横)行');
  assert.equal(frameRow!.spec.includes('1360mm'), true);

  // 扇料：每节 sashW + 25 = 604；side 上下 2 边 × count（sashCount=1 → 3）= 6 根
  const sashRows = bom.items.filter((i) => i.name.startsWith('扇料'));
  assert.equal(sashRows.length, 2);
  assert.equal(sashRows[0]!.quantity, 6);
  assert.equal(sashRows[0]!.spec.includes('604mm'), true);

  // 下料单沿用出料行长度（零损耗）
  const cutting = computeCuttingList(bom, customSeries, { defaultColor: '香槟', wasteRate: 0, stockLengthMm: 6000 });
  assert.equal(cutting.items.find((i) => i.name === '边框(横)')?.lengthMm, 1360);
  assert.equal(cutting.items.find((i) => i.name === '扇料(横)')?.lengthMm, 604);

  // 缺省回退：无 cuts 系列仍按内置几何算料
  const plainModel = buildModel({ ...series60, cuts: [] }, 'tpl-fixed-casement-right', 1500, 1500, '无公式窗');
  const plainBom = computeBomFromDesignModel(plainModel, { ...series60, cuts: [] }, sampleLibrary);
  assert.equal(plainBom.items.find((i) => i.name === '外框横料')?.spec.includes('1460mm'), true);
  assert.equal(plainBom.items.find((i) => i.name === '扇料(横)')?.quantity, 2, '缺省扇料数量应为 2 支/扇');
});

test('模型路径：推拉窗上滑/下滑使用出料行（cc 引用）', () => {
  const slidingSeries: SeriesSpec = {
    ...series108,
    cuts: [
      { id: 'track', label: '上滑', role: 'track', side: ['up'], length: 'frameOuterW - 20', count: '1', scope: 'window' },
      { id: 'sill', label: '下滑', role: 'sill', side: ['down'], length: 'frameOuterW - 20', count: '1', scope: 'window' },
      { id: 'frame-v', label: '边框(竖)', role: 'frame', side: ['left', 'right'], length: 'frameOuterH', count: '1', scope: 'window' },
    ],
  };
  const model = buildModel(slidingSeries, 'tpl-sliding-two-sash', 2000, 1500, '推拉公式窗');
  const bom = computeBomFromDesignModel(model, slidingSeries, sampleLibrary);

  // frameOuterW = 2000 - 2×20 = 1960 → 1940
  assert.equal(bom.items.find((i) => i.name === '上滑')?.spec.includes('1940mm'), true);
  assert.equal(bom.items.find((i) => i.name === '下滑')?.spec.includes('1940mm'), true);
});

test('模型路径：出料行公式非法时回退内置算法（不丢料）', () => {
  const badSeries: SeriesSpec = {
    ...series60,
    cuts: [
      { id: 'frame-h', label: '边框(横)', role: 'frame', side: ['up', 'down'], length: 'frameOuterW +', count: '1', scope: 'window' },
      { id: 'frame-v', label: '边框(竖)', role: 'frame', side: ['left', 'right'], length: 'frameOuterH', count: '1', scope: 'window' },
    ],
  };
  const model = buildModel(badSeries, 'tpl-fixed-casement-right', 1500, 1500, '非法公式窗');
  const bom = computeBomFromDesignModel(model, badSeries, sampleLibrary);
  // 非法 length 按边位回退内置：横=frameOuterW、竖=frameOuterH = 1460
  assert.equal(bom.items.find((i) => i.name === '边框(横)')?.spec.includes('1460mm'), true);
  assert.equal(bom.items.find((i) => i.name === '边框(竖)')?.spec.includes('1460mm'), true);
});

test('extractFormulaVariables 提取变量并去重，且不接受函数注入', () => {
  assert.deepEqual(extractFormulaVariables('frameOuterW + frameOuterW - sashW * 2'), ['frameOuterW', 'sashW']);
  assert.deepEqual(extractFormulaVariables('1 + 2 * (3 - 4)'), []);
  assert.deepEqual(extractFormulaVariables(''), []);
  // 非法字符不会进入求值（安全：不使用 eval）
  assert.equal(evaluateFormula('process.exit(1)', { outerW: 1 }).ok, false);
});

test('公式库引用：cc-N 映射、缺失原样回退为内联表达式', () => {
  assert.equal(resolveCutFormulaRef('cc-99', { '99': 'frameOuterW - 100' }), 'frameOuterW - 100');
  assert.equal(resolveCutFormulaRef(' cc-7 ', { '7': 'frameOuterH' }), 'frameOuterH');
  assert.equal(resolveCutFormulaRef('cc-404', {}), '', '公式库缺失时引用置空（由调用方回退内置）');
  assert.equal(resolveCutFormulaRef('frameOuterW - 6', {}), 'frameOuterW - 6', '非 cc-N 原样返回');
});

test('有效条件：变量="枚举值"，&& 全真才生效', () => {
  assert.equal(evaluateCutCondition('windowType="casement"', { windowType: 'casement' }), true);
  assert.equal(evaluateCutCondition('windowType="casement"', { windowType: 'fixed' }), false);
  assert.equal(
    evaluateCutCondition('开向="外开" && windowType="casement"', { 开向: '外开', windowType: 'casement' }),
    true,
  );
  assert.equal(evaluateCutCondition('开向="外开" && windowType="casement"', { 开向: '内开' }), false);
  assert.equal(evaluateCutCondition('illegal || syntax', {}), false, '无法解析的条件按不生效处理');
  assert.equal(evaluateCutCondition('', {}), true, '空条件 = 永真');
});

test('出料行校验：cc-N 缺引、未知变量、非法表达式给出错误（不阻断合法行）', () => {
  const errors = validateCutRows(
    [
      { id: 'a', label: '边框(横)', role: 'frame', side: ['up', 'down'], length: 'cc-404', count: '1', scope: 'window' },
      { id: 'b', label: '扇料(横)', role: 'sash', side: ['up', 'down'], length: 'unknown + 1', count: 'sashCount', scope: 'panel' },
      { id: 'c', label: '压线', role: 'bead', side: ['up', 'down', 'left', 'right'], length: 'glassW*2+glassH*2', count: '1', unit: '米', scope: 'panel' },
    ],
    { '99': 'frameOuterW' },
    { frameOuterW: 1460, glassW: 500, glassH: 500, sashCount: 1 },
  );
  assert.equal(Object.keys(errors).length, 2);
  assert.match(errors['a.length'] ?? '', /公式库缺少引用/);
  assert.match(errors['b.length'] ?? '', /未知变量/);
});

test('公式上下文：showSetting 料宽字典注入变量，显式字段优先', () => {
  const design = createDesign('casement', { openingW: 1500, openingH: 1500, seriesId: 'series-60', name: '字典窗' }, series60);
  const geometry = computeGeometry(design, series60);
  const customSeries: SeriesSpec = {
    ...series60,
    showSetting: { frame: 40, sash: 60, bead: 22, glassGap: 6 },
    cuts: [{ id: 'a', label: '边框(横)', role: 'frame', side: ['up', 'down'], length: 'frame + sash', count: '1', scope: 'window' }],
  };
  const panel = geometry.sizes.panels[0];
  const base = formulaContextFromPanel(geometry, customSeries, design, panel);
  const ctx = { ...customSeries.showSetting, ...base };
  // frame 从 showSetting 取 40；frameWidth 仍为显式字段（geometry 口径）
  const result = evaluateFormula('frame + frameWidth - 40', ctx);
  assert.equal(result.ok, true);
  assert.equal(result.value, customSeries.frameWidth);
});

test('窗型角色元数据覆盖各窗型参与算料的型材角色', () => {
  assert.ok(WINDOW_TYPE_ROLES.sliding.includes('track'));
  assert.ok(WINDOW_TYPE_ROLES.sliding.includes('sill'));
  assert.ok(WINDOW_TYPE_ROLES.casement.includes('sash'));
  assert.ok(WINDOW_TYPE_ROLES.fixed.includes('bead'));
  assert.ok(PROFILE_ROLE_LABEL.frame);
  assert.ok(PROFILE_ROLE_LABEL.bead);
});

test('组合窗公式按所属外框取 frameOuterW，不使用装配体总宽', () => {
  const customSeries: SeriesSpec = {
    ...series60,
    cuts: [
      { id: 'frame-h', label: '组合框横料', role: 'frame', side: ['up', 'down'], length: 'frameOuterW', count: '1', scope: 'window' },
      { id: 'frame-v', label: '组合框竖料', role: 'frame', side: ['left', 'right'], length: 'frameOuterH', count: '1', scope: 'window' },
    ],
  };
  const model: DesignModel = {
    id: 'combined-formula',
    name: '不同宽度组合窗',
    openingW: 2140,
    openingH: 1040,
    seriesId: customSeries.id,
    glassId: 'g-5-12a-5',
    components: [
      { id: 'frame-a', kind: 'outerFrame', x: 20, y: 20, w: 900, h: 1000 },
      { id: 'glass-a', kind: 'fixedGlass', x: 80, y: 80, w: 780, h: 880, parentId: 'frame-a' },
      { id: 'frame-b', kind: 'outerFrame', x: 920, y: 20, w: 1200, h: 1000 },
      { id: 'glass-b', kind: 'fixedGlass', x: 980, y: 80, w: 1080, h: 880, parentId: 'frame-b' },
    ],
  };

  const firstContext = formulaContextFromDesignModel(model, customSeries, model.components[1]);
  const secondContext = formulaContextFromDesignModel(model, customSeries, model.components[3]);
  assert.equal(firstContext.frameOuterW, 900);
  assert.equal(secondContext.frameOuterW, 1200);

  const bom = computeBomFromDesignModel(model, customSeries, sampleLibrary);
  const horizontalSpecs = bom.items.filter((item) => item.name === '组合框横料').map((item) => item.spec);
  assert.equal(horizontalSpecs.some((spec) => spec.includes('900mm')), true);
  assert.equal(horizontalSpecs.some((spec) => spec.includes('1200mm')), true);
});
