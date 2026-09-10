import { test } from 'node:test';
import assert from 'node:assert/strict';
import { series60, sampleLibrary } from '@wdd/schema';
import {
  createWindowTree,
  setSash,
  toDesignModel,
  panelLeafLayout,
  panelHeightOf,
  sashInfillOf,
  DEFAULT_PANEL_HEIGHT_MM,
  type WindowTree,
  type WindowSashSpec,
} from '../src/window-tree.js';
import { describeWindowTree } from '../src/window-tree-describe.js';
import { computeBomFromDesignModel } from '../src/bom-design-model.js';
import { validateDesignModel } from '../src/validate-design.js';

const GAP = 20;

function treeWith(sash: WindowSashSpec, panelHeightMm?: number, size: [number, number] = [1500, 2400]): WindowTree {
  const t = createWindowTree({
    openingW: size[0], openingH: size[1], seriesId: 'series-60', glassId: 'g-5-12a-5',
    frameWidthMm: 60, sashWidthMm: 45, name: '肯德基门',
  });
  if (panelHeightMm != null) t.panelHeightMm = panelHeightMm;
  assert.equal(setSash(t, t.root!.id, sash), true);
  return t;
}

const modelOf = (t: WindowTree) =>
  toDesignModel(t, { installGap: GAP, name: '肯德基门', seriesId: 'series-60', glassId: 'g-5-12a-5' });
const bomOf = (t: WindowTree) => computeBomFromDesignModel(modelOf(t), series60, sampleLibrary);
const rowOf = (bom: ReturnType<typeof bomOf>, name: string) => bom.items.find((i) => i.name === name);
const glassSpec = (bom: ReturnType<typeof bomOf>) => String(bom.items.find((i) => i.category === 'glass')?.spec ?? '');

const KFC: WindowSashSpec = { windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1', infill: 'panel' };

test('上玻下板几何：玻璃 + 一根扇料宽的中横档 + 下板，缺省下板 200', () => {
  assert.equal(DEFAULT_PANEL_HEIGHT_MM, 200);
  assert.equal(panelHeightOf({}), 200);
  assert.equal(panelHeightOf({ panelHeightMm: 320 }), 320);

  const lay = panelLeafLayout(1000, 2200, 45, 200);
  assert.ok(lay, '足够高的叶应能分出上玻下板');
  assert.equal(lay!.panel.h, 200);
  assert.equal(lay!.panel.y + lay!.panel.h, 2200 - 45, '下板贴扇口底边');
  assert.equal(lay!.glass.y, 45, '玻璃从扇口顶边开始');
  assert.equal(lay!.glass.h, lay!.panel.y - 45 - 45, '玻璃底边在板顶横档之上（让出一根扇料宽）');
  assert.ok(Math.abs(lay!.railY - (lay!.panel.y - 22.5)) < 1e-6, '中横档中心在玻璃与下板之间');

  assert.equal(panelLeafLayout(1000, 2200, 45, 2400), null, '下板吃掉整个叶高时不产出负尺寸');
  assert.equal(panelLeafLayout(1000, 120, 45, 200), null, '叶太矮时按普通扇画');
});

test('肯德基门出料：玻璃只剩上半、多一根中横档与一块下板，压线与五金照旧', () => {
  const plain = bomOf(treeWith({ windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1' }));
  const kfc = bomOf(treeWith(KFC));

  const plainH = Number(glassSpec(plain).split('x')[1]);
  const kfcH = Number(glassSpec(kfc).split('x')[1]);
  assert.ok(kfcH > 0 && kfcH < plainH, `玻璃高度应被下板压缩：${plainH} → ${kfcH}`);
  assert.equal(plainH - kfcH, 200 + series60.sashWidth, '差额 = 下板高 + 一根中横档');

  const rail = rowOf(kfc, '中横档(下板顶)');
  assert.ok(rail, '应出中横档行');
  assert.equal(rail!.quantity, 1);
  const panel = rowOf(kfc, '板材(下板)');
  assert.ok(panel, '应出下板行');
  assert.equal(panel!.quantity, 1);
  assert.ok(panel!.unitPrice > 0 && panel!.amount > 0, '下板要进报价');
  assert.ok(rowOf(kfc, '压线'), '上半玻璃仍需压线');
  assert.ok(rowOf(kfc, '扇料(横)') && rowOf(kfc, '平开合页'), '扇料与开启五金照旧');
});

test('对开肯德基门 = 上玻下板 + 两片扇：中横档与下板各两根，另有中缝对开料', () => {
  const bom = bomOf(treeWith({ ...KFC, leaves: 2 }));
  assert.equal(rowOf(bom, '中横档(下板顶)')!.quantity, 2);
  assert.equal(rowOf(bom, '板材(下板)')!.quantity, 2);
  assert.equal(rowOf(bom, '对开料(中缝)')!.quantity, 2);
  assert.equal(bom.items.find((i) => i.category === 'glass')!.quantity, 2, '两片扇各一块上半玻璃');
  assert.equal(rowOf(bom, '扇料(横)')!.quantity, 4);
});

test('肯德基门：填充与下板高传到渲染层与构件，缺省扇面零回归', () => {
  const plain = modelOf(treeWith({ windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1' })).components.find((c) => c.kind === 'casementSash')!;
  assert.equal(plain.infill, undefined, '旧数据不带填充字段');
  assert.equal(plain.panelHeightMm, undefined);
  assert.ok(glassSpec(bomOf(treeWith({ windowType: 'casement', hingeSide: 'left', openDirection: 'out', label: 'A1' }))), '普通扇仍出玻璃');

  const t = treeWith(KFC, 320, [1000, 2000]);
  const el = describeWindowTree(t, GAP).find((e) => e.kind === 'area')!;
  assert.equal(el.panelHeightMm, 320, '下板高要传到渲染层');
  const comp = modelOf(t).components.find((c) => c.kind === 'casementSash')!;
  assert.equal(comp.infill, 'panel');
  assert.equal(comp.panelHeightMm, 320);
  const plainSash: WindowSashSpec = { windowType: 'casement', label: 'A1' };
  assert.equal(sashInfillOf(plainSash), 'glass');
  const issues = validateDesignModel(modelOf(t), series60);
  assert.ok(!issues.some((i) => i.level === 'error'), `肯德基门不该报 error：${issues.map((i) => i.message).join(' / ')}`);
});
