import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWindowTree, splitArea, setSash, layoutTree, type WindowTree } from '../src/window-tree.js';
import { resizeTreeEdge } from '../src/window-tree-resize.js';

const GAP = 20;
const FW = 60;

function makeTree(): WindowTree {
  return createWindowTree({ openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: FW, name: 't' });
}

test('外框右/下边拖拽：增大洞尺寸（对边不动）', () => {
  const tree = makeTree();
  const layout0 = layoutTree(tree, { installGap: GAP });
  assert.deepEqual([layout0.frame.x, layout0.frame.w], [20, 1460]);

  assert.equal(resizeTreeEdge(tree, 'frame', 'right', 2000, { installGap: GAP }), true);
  assert.equal(tree.openingW, 2020, '右拖到 2000（帧右边 = openingW-20）→ 洞宽 2020');

  assert.equal(resizeTreeEdge(tree, 'frame', 'bottom', 1300, { installGap: GAP }), true);
  assert.equal(tree.openingH, 1320);
});

test('外框左/上边拖拽：移动偏移并同步洞尺寸（对边不动）', () => {
  const tree = makeTree();
  assert.equal(resizeTreeEdge(tree, 'frame', 'left', 0, { installGap: GAP }), true);
  assert.equal(tree.offsetX, -20, '左边从 20 拖到 0 → 偏移 -20');
  assert.equal(tree.openingW, 1520, '洞宽同步增大');

  assert.equal(resizeTreeEdge(tree, 'frame', 'top', 0, { installGap: GAP }), true);
  assert.equal(tree.offsetY, -20);
  assert.equal(tree.openingH, 1120);
});

test('叶子格 a2 左边界（竖分割）：调整中梃比例', () => {
  const tree = makeTree();
  splitArea(tree, tree.root!.id, 'vertical', 0.45, 40);
  const [a1, m, a2] = tree.root!.children!;
  setSash(tree, a1.id, { windowType: 'fixed', label: 'F1' });
  setSash(tree, a2.id, { windowType: 'casement', label: 'A1' });

  // a2 左边界拖到 x=550 → 中梃比例 = (550-80)/1340 ≈ 0.35
  assert.equal(resizeTreeEdge(tree, a2.id, 'left', 550, { installGap: GAP }), true);
  assert.ok(Math.abs(m.ratio - (550 - 80) / 1340) < 0.01, `中梃比例 ${m.ratio}`);
  assert.ok(Math.abs(a1.wr - m.ratio) < 0.002, 'a1 宽度同步');
});

test('叶子格 a1 左边界：逐层递归到外框（offsetX）', () => {
  const tree = makeTree();
  splitArea(tree, tree.root!.id, 'vertical', 0.45, 40);
  const [a1] = tree.root!.children!;
  // a1 的左边界 = 内腔左 = frame.x+frameWidth = 80 → 拖到 10 = 窗口左移 70（外缘=内缘-60）
  assert.equal(resizeTreeEdge(tree, a1.id, 'left', 10, { installGap: GAP }), true);
  assert.equal(tree.offsetX, -70, `offsetX ${tree.offsetX}（外框左缘从 20 到 -50）`);
  assert.equal(tree.openingW, 1570, '洞宽同步增大 70');
});

test('多级嵌套：上层分割的宿主边界调整联动', () => {
  const tree = makeTree();
  splitArea(tree, tree.root!.id, 'vertical', 0.5, 40);
  const left = tree.root!.children![0];
  splitArea(tree, left.id, 'horizontal', 0.5, 40);
  const [tl, m2] = left.children!;
  setSash(tree, tl.id, { windowType: 'screen', label: 'WC' });

  // 拖 tl 的底边（a1.bottom → 横分割 m2 比例调整）
  assert.equal(resizeTreeEdge(tree, tl.id, 'bottom', 560, { installGap: GAP }), true);
  assert.ok(Math.abs(m2.ratio - (560 - 80) / 940) < 0.01, `横中梃比例 ${m2.ratio}`);
});

test('比例边界钳制：不产生极端分格', () => {
  const tree = makeTree();
  splitArea(tree, tree.root!.id, 'vertical', 0.45, 40);
  const [a1, m, a2] = tree.root!.children!;
  setSash(tree, a1.id, { windowType: 'fixed', label: 'F1' });
  // 拖 a2 左边界到内腔最右 → clamp 到 0.92
  resizeTreeEdge(tree, a2.id, 'left', 1500, { installGap: GAP });
  assert.ok(m.ratio <= 0.92, `比例 ${m.ratio}`);
  assert.ok(m.ratio >= 0.08);
});

test('单格（root 无分割）拖底边：外缘换算后洞高正确延长', () => {
  const tree = makeTree(); // opening 1500×1100，内腔底 y=1020（FW=60）
  setSash(tree, tree.root!.id, { windowType: 'fixed', label: 'F1' });
  const box = layoutTree(tree, { installGap: GAP }).boxes.get(tree.root!.id)!;
  assert.equal(box.y + box.h, 1020);

  // 底边向下拖 100（叶子底缘从 1020 → 1120）
  assert.equal(resizeTreeEdge(tree, tree.root!.id, 'bottom', box.y + box.h + 100, { installGap: GAP }), true);
  assert.equal(tree.openingH, 1200, '外框底缘 = 1120+60=1180 → 洞高 1180+40');
});