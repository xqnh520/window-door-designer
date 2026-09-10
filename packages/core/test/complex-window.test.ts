import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleLibrary, sampleWindowTemplates, series60, series108, series110, type DesignModel, type SeriesSpec } from '@wdd/schema';
import { createDesignModelFromTemplate } from '../src/window-template.js';
import { bomCalculators, computeBomFromDesignModel } from '../src/bom-design-model.js';
import { resolveBomCalculator, type BomCalculatorContext } from '../src/bom-calculator.js';
import { validateDesignModel } from '../src/validate-design.js';
import { createDesign } from '../src/design.js';

function modelFromTemplate(templateId: string, series: SeriesSpec, openingW = 1500, openingH = 1500): DesignModel {
  const tpl = sampleWindowTemplates.find((t) => t.id === templateId)!;
  return createDesignModelFromTemplate(tpl, { openingW, openingH, series, seriesId: series.id, glassId: 'g-5-12a-5', name: 't' });
}

function ctx(model: DesignModel, series: SeriesSpec): BomCalculatorContext {
  return {
    model,
    series,
    library: sampleLibrary,
    options: { minAreaPerPanel: 1.5 },
    context: {},
    frames: model.components.filter((c) => c.kind === 'outerFrame'),
  };
}

test('计算器分派：平开/推拉/上悬/观景各归各列', () => {
  const casementCtx = ctx(modelFromTemplate('tpl-fixed-casement-right', series60), series60);
  assert.equal(resolveBomCalculator(casementCtx, bomCalculators).id, 'casement');

  const slidingCtx = ctx(modelFromTemplate('tpl-sliding-two-sash', series108, 2000, 1500), series108);
  assert.equal(resolveBomCalculator(slidingCtx, bomCalculators).id, 'sliding');

  const topHungCtx = ctx(modelFromTemplate('tpl-top-hung-single', series60), series60);
  assert.equal(resolveBomCalculator(topHungCtx, bomCalculators).id, 'topHung');

  const viewCtx = ctx(modelFromTemplate('tpl-view-large', series110), series110);
  assert.equal(resolveBomCalculator(viewCtx, bomCalculators).id, 'view');
});

test('观景窗 BOM：110 系列输出四角加强角码，平开系列不输出', () => {
  const viewModel = modelFromTemplate('tpl-view-large', series110);
  const viewBom = computeBomFromDesignModel(viewModel, series110, sampleLibrary);
  const brackets = viewBom.items.filter((i) => i.name.includes('加强角码'));
  assert.equal(brackets.length, 1, '应输出加强角码行');
  assert.equal(brackets[0].quantity, 4, '四角各一个');
  assert.ok(viewBom.items.some((i) => i.category === 'glass'));

  const fixedModel = modelFromTemplate('tpl-fixed-single', series60);
  const fixedBom = computeBomFromDesignModel(fixedModel, series60, sampleLibrary);
  assert.ok(
    !fixedBom.items.some((i) => i.name.includes('加强角码')),
    '未配置 viewEnhance 系列的固定窗不输出加强件',
  );
});

test('观景窗校验通过：单框大玻璃无 error', () => {
  const viewModel = modelFromTemplate('tpl-view-large', series110);
  const issues = validateDesignModel(viewModel, series110);
  assert.equal(issues.some((i) => i.level === 'error'), false);
  assert.ok(issues.some((i) => i.code === 'MODEL_INFO'));
});

test('组合窗 BOM：多外框独立算料并汇总', () => {
  const comboModel = modelFromTemplate('tpl-combo-two-fixed', series60);
  assert.equal(comboModel.components.filter((c) => c.kind === 'outerFrame').length, 2);

  const bom = computeBomFromDesignModel(comboModel, series60, sampleLibrary);
  const frameW = bom.items.filter((i) => i.name === '横框');
  const frameH = bom.items.filter((i) => i.name === '竖框');
  assert.equal(frameW.length, 2, '两樘各有横料行');
  assert.equal(frameH.length, 2, '两樘各有竖料行');
  assert.equal(frameW.reduce((s, i) => s + i.quantity, 0), 4, '横料共 4 根');
  assert.equal(frameH.reduce((s, i) => s + i.quantity, 0), 4, '竖料共 4 根');
  assert.equal(bom.items.filter((i) => i.category === 'glass').length, 2, '两块玻璃');
  assert.ok(bom.totalAmount > 0);
});

test('组合窗校验：并排多框降为 info，无 error', () => {
  const comboModel = modelFromTemplate('tpl-combo-two-fixed', series60);
  const issues = validateDesignModel(comboModel, series60);
  assert.equal(issues.some((i) => i.level === 'error'), false, '组合窗不应有错误级问题');
  const info = issues.find((i) => i.code === 'MULTI_FRAME' && i.level === 'info');
  assert.ok(info, '并排多框应提示组合窗信息');
  assert.match(info!.message, /组合窗/);
});

test('重叠外框仍报 MULTI_FRAME 警告', () => {
  createDesign('fixed', { openingW: 1500, openingH: 1500, seriesId: 'series-60', name: 'x' }, series60);
  const model = {
    id: 'm',
    name: '重叠组合',
    openingW: 1500,
    openingH: 1500,
    seriesId: 'series-60',
    glassId: 'g-5-12a-5',
    components: [
      { id: 'f1', kind: 'outerFrame' as const, x: 0, y: 0, w: 900, h: 800 },
      { id: 'f2', kind: 'outerFrame' as const, x: 200, y: 100, w: 900, h: 800 },
      { id: 'g1', kind: 'fixedGlass' as const, x: 20, y: 20, w: 400, h: 300, parentId: 'f1' },
    ],
  };
  const issues = validateDesignModel(model, series60);
  const multi = issues.find((i) => i.code === 'MULTI_FRAME');
  assert.ok(multi, '重叠外框应给出 MULTI_FRAME');
  assert.equal(issues.some((i) => i.level === 'error'), false, '重叠外框不阻断（警告级）');
});