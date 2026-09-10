import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleWindowTemplates, series60, type DesignModel } from '@wdd/schema';
import { createDesignModelFromTemplate } from '../src/window-template.js';
import { treeFromDesignModel } from '../src/window-tree-builder.js';
import { toDesignModel, walkAreas } from '../src/window-tree.js';
import { validateDesignModel } from '../src/validate-design.js';

const GAP = 20;
const FW = 60;

test('反推：一固定一平开模板 → 树含竖中梃 + 固定 + 平开', () => {
  const tpl = sampleWindowTemplates.find((t) => t.id === 'tpl-fixed-casement-right')!;
  const model = createDesignModelFromTemplate(tpl, { openingW: 1500, openingH: 1500, series: series60, seriesId: series60.id, glassId: 'g-5-12a-5', name: 't' });
  const tree = treeFromDesignModel(model, { installGap: GAP, name: 't', seriesId: series60.id, glassId: 'g-5-12a-5', frameWidthMm: FW });
  assert.ok(tree?.root, '应生成树');
  assert.ok(tree!.root!.children, '应有分割');
  const muntins: string[] = [];
  const sashes: string[] = [];
  walkAreas(tree!, (a) => {
    if (a.children) muntins.push(a.children[1].id);
    if (a.sash) sashes.push(a.sash.windowType);
  });
  assert.equal(muntins.length, 1, '一根竖中梃');
  assert.deepEqual(sashes.sort(), ['casement', 'fixed']);

  // 往返：树 → DesignModel → 校验通过且几何一致
  const back = toDesignModel(tree!, { installGap: GAP, name: 't', seriesId: series60.id, glassId: 'g-5-12a-5' });
  const issues = validateDesignModel(back, series60);
  assert.equal(issues.some((i) => i.level === 'error'), false, '反推树不应有 error');
  const m = back.components.find((c) => c.kind === 'mullion')!;
  const fixed = back.components.find((c) => c.kind === 'fixedGlass')!;
  // 模板：竖中梃位于内腔 0.45 处（inner.x=80，inner 宽 1340 → 中心 ≈ 683，厚约 14）
  assert.ok(Math.abs(m.x - 677) < 20, `中梃几何接近模板（${m.x}）`);
  assert.ok(fixed.w > 500 && fixed.w < 700);
});

test('反推：十字分格（1 竖 1 横 4 面板）→ 4 叶', () => {
  const model: DesignModel = {
    id: 'm',
    name: '十字',
    openingW: 1500,
    openingH: 1100,
    seriesId: series60.id,
    glassId: 'g-5-12a-5',
    components: [
      { id: 'f', kind: 'outerFrame', x: 20, y: 20, w: 1460, h: 1060 },
      { id: 'mv', kind: 'mullion', x: 663, y: 80, w: 40, h: 940, parentId: 'f' },
      { id: 'mh', kind: 'mullion', x: 80, y: 560, w: 1340, h: 40, parentId: 'f' },
      { id: 'tl', kind: 'fixedGlass', x: 80, y: 80, w: 583, h: 440, parentId: 'f' },
      { id: 'tr', kind: 'fixedGlass', x: 703, y: 80, w: 737, h: 440, parentId: 'f' },
      { id: 'bl', kind: 'fixedGlass', x: 80, y: 600, w: 583, h: 400, parentId: 'f' },
      { id: 'br', kind: 'fixedGlass', x: 703, y: 600, w: 737, h: 400, parentId: 'f' },
    ],
  };
  const tree = treeFromDesignModel(model, { installGap: GAP, name: '十字', seriesId: series60.id, glassId: 'g-5-12a-5', frameWidthMm: FW });
  assert.ok(tree?.root);
  let muntins = 0;
  let leaves: { w: number; h: number }[] = [];
  walkAreas(tree!, (a) => {
    if (a.children) muntins += 1;
    if (a.sash) leaves.push({ w: 0, h: 0 });
  });
  void leaves;

  const back = toDesignModel(tree!, { installGap: GAP, name: '十字', seriesId: series60.id, glassId: 'g-5-12a-5' });
  // 竖中梃整根 1 + 横中梃在竖中梃两侧各一段（拼接语义，工艺正确）
  assert.ok(back.components.filter((c) => c.kind === 'mullion').length >= 2, '至少两根中梃（含拼接段）');
  assert.equal(back.components.filter((c) => c.kind === 'fixedGlass').length, 4, '四块玻璃');
  assert.ok(muntins >= 2);
  const issues = validateDesignModel(back, series60);
  assert.equal(issues.some((i) => i.level === 'error'), false);
});

test('反推：纱窗面板 → 树叶为 screen', () => {
  const model: DesignModel = {
    id: 'm',
    name: '纱窗',
    openingW: 900,
    openingH: 900,
    seriesId: series60.id,
    glassId: 'g-5-12a-5',
    components: [
      { id: 'f', kind: 'outerFrame', x: 20, y: 20, w: 860, h: 860 },
      { id: 's', kind: 'screen', x: 80, y: 80, w: 740, h: 740, parentId: 'f', label: 'WC' },
    ],
  };
  const tree = treeFromDesignModel(model, { installGap: GAP, name: '纱窗', seriesId: series60.id, glassId: 'g-5-12a-5', frameWidthMm: FW });
  assert.ok(tree?.root);
  assert.equal(tree!.root!.sash?.windowType, 'screen');
  assert.equal(tree!.root!.label, 'WC');

  const back = toDesignModel(tree!, { installGap: GAP, name: '纱窗', seriesId: series60.id, glassId: 'g-5-12a-5' });
  assert.equal(back.components.some((c) => c.kind === 'screen'), true);
});

test('反推：空模型/无边无 p揪标签安全返回 null', () => {
  const noFrame: DesignModel = {
    id: 'm',
    name: 'x',
    openingW: 900,
    openingH: 900,
    seriesId: series60.id,
    glassId: 'g-5-12a-5',
    components: [{ id: 'g', kind: 'fixedGlass', x: 0, y: 0, w: 800, h: 800 }],
  };
  assert.equal(treeFromDesignModel(noFrame, { installGap: GAP, name: 'x', seriesId: series60.id, glassId: 'g-5-12a-5', frameWidthMm: FW }), null);
});