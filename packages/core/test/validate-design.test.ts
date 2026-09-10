import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sampleLibrary,
  sampleWindowTemplates,
  series60,
  series108,
  type DesignComponent,
  type DesignModel,
} from '@wdd/schema';
import { validateDesignModel } from '../src/validate-design.js';
import { createDesignModelFromTemplate } from '../src/window-template.js';

let seq = 0;
function comp(partial: Partial<DesignComponent> & Pick<DesignComponent, 'kind'>): DesignComponent {
  return { id: `c-${++seq}`, x: 0, y: 0, w: 100, h: 100, ...partial };
}

function frame(w = 1000, h = 800): DesignComponent {
  return comp({ kind: 'outerFrame', x: 0, y: 0, w, h });
}

function model(components: DesignComponent[], overrides: Partial<DesignModel> = {}): DesignModel {
  return {
    id: 'm-test',
    name: '校验测试',
    openingW: 1200,
    openingH: 1000,
    seriesId: series60.id,
    glassId: 'g-5-12a-5',
    components,
    ...overrides,
  };
}

function codes(issues: ReturnType<typeof validateDesignModel>, level?: 'error' | 'warning' | 'info'): string[] {
  return issues.filter((i) => !level || i.level === level).map((i) => i.code);
}

test('空模型返回 EMPTY_MODEL', () => {
  const issues = validateDesignModel(null, series60);
  assert.ok(issues.some((i) => i.code === 'EMPTY_MODEL' && i.level === 'error'));
});

test('模板生成的「一固定一平开」无 error 且含 info 统计', () => {
  const tpl = sampleWindowTemplates.find((t) => t.id === 'tpl-fixed-casement-right')!;
  const m = createDesignModelFromTemplate(tpl, {
    openingW: 1500,
    openingH: 1500,
    series: series60,
    seriesId: series60.id,
    glassId: 'g-5-12a-5',
    name: 't',
  });
  const issues = validateDesignModel(m, series60, tpl, sampleLibrary);
  assert.ok(issues.some((i) => i.code === 'MODEL_INFO' && i.level === 'info'));
  assert.equal(issues.some((i) => i.level === 'error'), false);
});

test('缺少外框报 NO_FRAME', () => {
  const issues = validateDesignModel(model([comp({ kind: 'fixedGlass', w: 500, h: 400 })]), series60);
  assert.ok(codes(issues, 'error').includes('NO_FRAME'));
});

test('无玻璃无扇报 NO_PANEL', () => {
  const f = frame();
  const issues = validateDesignModel(model([f]), series60);
  assert.ok(codes(issues, 'error').includes('NO_PANEL'));
});

test('模板与系列不兼容报 TPL_SERIES', () => {
  const tpl = sampleWindowTemplates.find((t) => t.id === 'tpl-fixed-casement-right')!;
  const issues = validateDesignModel(model([frame()]), series108, tpl);
  assert.ok(codes(issues, 'error').includes('TPL_SERIES'));
});

test('构件超出外框报 OUT_OF_FRAME 且定位到构件', () => {
  const f = frame();
  const g = comp({ kind: 'fixedGlass', x: 900, y: 0, w: 200, h: 400, parentId: f.id });
  const issues = validateDesignModel(model([f, g]), series60);
  assert.ok(issues.some((i) => i.code === 'OUT_OF_FRAME' && i.level === 'error' && i.componentId === g.id));
});

test('玻璃超出所属扇报 CONTAINER_ESCAPE', () => {
  const f = frame();
  const sash = comp({ kind: 'casementSash', x: 0, y: 0, w: 500, h: 800, parentId: f.id, hingeSide: 'left' });
  const g = comp({ kind: 'fixedGlass', x: 100, y: 100, w: 600, h: 100, parentId: sash.id });
  const issues = validateDesignModel(model([f, sash, g]), series60);
  assert.ok(codes(issues, 'error').includes('CONTAINER_ESCAPE'));
});

test('悬空中梃报 MULLION_DISCONNECTED', () => {
  const f = frame();
  const m = comp({ kind: 'mullion', x: 100, y: 300, w: 400, h: 10, parentId: f.id });
  const issues = validateDesignModel(model([f, m]), series60);
  assert.ok(codes(issues).includes('MULLION_DISCONNECTED'));
});

test('两端连接外框的中梃不告警', () => {
  const f = frame();
  const m = comp({ kind: 'mullion', x: 0, y: 300, w: 1000, h: 10, parentId: f.id });
  const issues = validateDesignModel(model([f, m]), series60);
  assert.equal(codes(issues).includes('MULLION_DISCONNECTED'), false);
});

test('同级面板重叠报 OVERLAP', () => {
  const f = frame();
  const a = comp({ kind: 'fixedGlass', x: 0, y: 0, w: 500, h: 400, parentId: f.id });
  const b = comp({ kind: 'fixedGlass', x: 300, y: 200, w: 500, h: 400, parentId: f.id });
  const issues = validateDesignModel(model([f, a, b]), series60);
  assert.ok(issues.some((i) => i.code === 'OVERLAP' && i.level === 'warning' && i.componentId === b.id));
});

test('构件过小报 TOO_SMALL', () => {
  const f = frame();
  const g = comp({ kind: 'fixedGlass', x: 10, y: 10, w: 30, h: 30, parentId: f.id });
  const issues = validateDesignModel(model([f, g]), series60);
  assert.ok(codes(issues).includes('TOO_SMALL'));
});

test('开启扇超过系列上限报 SASH_SIZE(error)', () => {
  const f = frame();
  const sash = comp({ kind: 'casementSash', x: 0, y: 0, w: 1000, h: 800, parentId: f.id, hingeSide: 'left', windowType: 'casement' });
  const issues = validateDesignModel(model([f, sash]), series60);
  assert.ok(issues.some((i) => i.code === 'SASH_SIZE' && i.level === 'error' && i.componentId === sash.id));
});

test('玻璃面积超过系列上限报 GLASS_SIZE(error)', () => {
  const f = frame(3000, 1400);
  const g = comp({ kind: 'fixedGlass', x: 0, y: 0, w: 3000, h: 1400, parentId: f.id });
  const issues = validateDesignModel(model([f, g]), series60);
  assert.ok(issues.some((i) => i.code === 'GLASS_SIZE' && i.level === 'error'));
});

test('未配置约束的系列回退到校验器默认值', () => {
  const plainSeries = { ...series60, constraints: undefined };
  const f = frame(2000, 800);
  const sash = comp({ kind: 'casementSash', x: 0, y: 0, w: 1700, h: 800, parentId: f.id, hingeSide: 'left' });
  const issues = validateDesignModel(model([f, sash]), plainSeries);
  assert.ok(issues.some((i) => i.code === 'SASH_SIZE' && i.level === 'error'));
});

test('推拉系列含平开扇报 FAMILY_MISMATCH(error)', () => {
  const f = frame();
  const sash = comp({ kind: 'casementSash', x: 0, y: 0, w: 500, h: 800, parentId: f.id, hingeSide: 'left', windowType: 'casement' });
  const issues = validateDesignModel(model([f, sash]), series108);
  assert.ok(issues.some((i) => i.code === 'FAMILY_MISMATCH' && i.level === 'error' && i.componentId === sash.id));
});

test('开启方式与构件类型冲突报 WINDOW_TYPE_MISMATCH', () => {
  const f = frame();
  const sash = comp({ kind: 'casementSash', x: 0, y: 0, w: 500, h: 800, parentId: f.id, windowType: 'sliding', hingeSide: 'left' });
  const issues = validateDesignModel(model([f, sash]), series60);
  assert.ok(codes(issues).includes('WINDOW_TYPE_MISMATCH'));
});

test('平开扇未指定开向报 HINGE_SIDE_MISSING', () => {
  const f = frame();
  const sash = comp({ kind: 'casementSash', x: 0, y: 0, w: 500, h: 800, parentId: f.id });
  const issues = validateDesignModel(model([f, sash]), series60);
  assert.ok(codes(issues).includes('HINGE_SIDE_MISSING'));
});

test('上悬扇铰链侧非顶部报 HINGE_SIDE_MISMATCH', () => {
  const f = frame();
  const sash = comp({ kind: 'topHungSash', x: 0, y: 0, w: 1000, h: 300, parentId: f.id, hingeSide: 'left', windowType: 'topHinged' });
  const issues = validateDesignModel(model([f, sash]), series60);
  assert.ok(codes(issues).includes('HINGE_SIDE_MISMATCH'));
});

test('材料库缺少所选玻璃报 GLASS_MISSING(error)', () => {
  const f = frame();
  const g = comp({ kind: 'fixedGlass', x: 0, y: 0, w: 500, h: 400, parentId: f.id });
  const m = model([f, g], { glassId: 'g-unknown' });
  const issues = validateDesignModel(m, series60, null, sampleLibrary);
  assert.ok(codes(issues, 'error').includes('GLASS_MISSING'));
});

test('推拉扇但系列缺上滑/下滑角色报 ROLE_TRACK/SILL_MISSING', () => {
  const noTrackSeries = { ...series108, profileRoles: { frame: 'x', sash: 'y' } };
  const f = frame();
  const sash = comp({ kind: 'slidingSash', x: 0, y: 0, w: 500, h: 800, parentId: f.id, windowType: 'sliding' });
  const issues = validateDesignModel(model([f, sash]), noTrackSeries);
  assert.ok(codes(issues).includes('ROLE_TRACK_MISSING'));
  assert.ok(codes(issues).includes('ROLE_SILL_MISSING'));
});

test('平开系列缺少开启扇报 CASEMENT_SASH_MISSING', () => {
  const f = frame();
  const g = comp({ kind: 'fixedGlass', x: 0, y: 0, w: 800, h: 600, parentId: f.id });
  const issues = validateDesignModel(model([f, g]), series60);
  assert.ok(codes(issues).includes('CASEMENT_SASH_MISSING'));
});

// ── 格子封闭：中梃分格几何检测 ───────────────────────────────

test('十字中梃分成 4 格且各格有玻璃：无分格类问题', () => {
  const f = frame(1000, 800);
  const mv = comp({ kind: 'mullion', x: 498, y: 0, w: 4, h: 800, parentId: f.id });
  const mh = comp({ kind: 'mullion', x: 0, y: 398, w: 1000, h: 4, parentId: f.id });
  const parts = [
    comp({ kind: 'fixedGlass', x: 0, y: 0, w: 500, h: 400, parentId: f.id }),
    comp({ kind: 'fixedGlass', x: 500, y: 0, w: 500, h: 400, parentId: f.id }),
    comp({ kind: 'fixedGlass', x: 0, y: 400, w: 500, h: 400, parentId: f.id }),
    comp({ kind: 'fixedGlass', x: 500, y: 400, w: 500, h: 400, parentId: f.id }),
  ];
  const issues = validateDesignModel(model([f, mv, mh, ...parts]), series60);
  assert.ok(!codes(issues).includes('GRID_VIOLATION'));
  assert.ok(!codes(issues).includes('UNSEGMENTED'));
  assert.ok(!codes(issues).includes('CELL_UNCOVERED'));
});

test('中梃分隔但某格无面板报 CELL_UNCOVERED', () => {
  const f = frame(1000, 800);
  const m = comp({ kind: 'mullion', x: 498, y: 0, w: 4, h: 800, parentId: f.id });
  const g = comp({ kind: 'fixedGlass', x: 0, y: 0, w: 500, h: 800, parentId: f.id });
  const issues = validateDesignModel(model([f, m, g]), series60);
  assert.ok(codes(issues).includes('CELL_UNCOVERED'));
});

test('同一分格内多块玻璃缺少中梃分隔报 UNSEGMENTED', () => {
  const f = frame();
  const a = comp({ kind: 'fixedGlass', x: 0, y: 0, w: 450, h: 700, parentId: f.id });
  const b = comp({ kind: 'fixedGlass', x: 550, y: 0, w: 450, h: 700, parentId: f.id });
  const issues = validateDesignModel(model([f, a, b]), series60);
  assert.ok(codes(issues).includes('UNSEGMENTED'));
});

test('通宽横向中梃同样是分格线：上下两扇不误报 UNSEGMENTED', () => {
  const f = frame(1000, 800);
  const m = comp({ kind: 'mullion', x: 0, y: 380, w: 1000, h: 40, parentId: f.id });
  const top = comp({ kind: 'casementSash', x: 0, y: 0, w: 1000, h: 380, parentId: f.id, windowType: 'casement' });
  const bottom = comp({ kind: 'casementSash', x: 0, y: 420, w: 1000, h: 380, parentId: f.id, windowType: 'casement' });
  const issues = validateDesignModel(model([f, m, top, bottom]), series60);
  assert.ok(!codes(issues).includes('UNSEGMENTED'), '横向中梃曾被当粗构件丢弃');
  assert.ok(!codes(issues).includes('CELL_UNCOVERED'));
});

test('中梃与面板只覆盖内腔（四周让位框料）时不误报分格类问题', () => {
  const f = frame(1000, 800);
  const m = comp({ kind: 'mullion', x: 490, y: 60, w: 20, h: 680, parentId: f.id });
  const left = comp({ kind: 'casementSash', x: 60, y: 60, w: 430, h: 680, parentId: f.id, windowType: 'casement' });
  const right = comp({ kind: 'casementSash', x: 510, y: 60, w: 430, h: 680, parentId: f.id, windowType: 'casement' });
  const got = codes(validateDesignModel(model([f, m, left, right]), series60));
  assert.ok(!got.includes('UNSEGMENTED'), '分隔线覆盖判定曾被外框外缘卡死');
  assert.ok(!got.includes('CELL_UNCOVERED'));
  assert.ok(!got.includes('GRID_VIOLATION'));
});

test('玻璃跨过分隔线报 GRID_VIOLATION(error)', () => {
  const f = frame(1000, 800);
  const m = comp({ kind: 'mullion', x: 498, y: 0, w: 4, h: 800, parentId: f.id });
  const g = comp({ kind: 'fixedGlass', x: 200, y: 0, w: 600, h: 400, parentId: f.id });
  const issues = validateDesignModel(model([f, m, g]), series60);
  assert.ok(issues.some((i) => i.code === 'GRID_VIOLATION' && i.level === 'error'));
});

test('推拉两扇共享轨道区域不报 UNSEGMENTED', () => {
  const f = frame();
  const a = comp({ kind: 'slidingSash', x: 0, y: 0, w: 500, h: 800, parentId: f.id, windowType: 'sliding' });
  const b = comp({ kind: 'slidingSash', x: 500, y: 0, w: 500, h: 800, parentId: f.id, windowType: 'sliding' });
  const issues = validateDesignModel(model([f, a, b]), series108);
  assert.ok(!codes(issues).includes('UNSEGMENTED'));
});

test('单块固定玻璃铺满外框：无分格类问题', () => {
  const f = frame();
  const g = comp({ kind: 'fixedGlass', x: 0, y: 0, w: 1000, h: 800, parentId: f.id });
  const issues = validateDesignModel(model([f, g]), series60);
  assert.ok(!codes(issues).includes('GRID_VIOLATION'));
  assert.ok(!codes(issues).includes('UNSEGMENTED'));
  assert.ok(!codes(issues).includes('CELL_UNCOVERED'));
});