import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectSnapLines, hostSnapLines, snapTo } from '../src/snap.js';
import type { TreeRenderElement } from '../src/window-tree-describe.js';

const area = (id: string, x: number, y: number, w: number, h: number): TreeRenderElement => ({
  id,
  kind: 'area',
  type: 'empty',
  x,
  y,
  w,
  h,
});

test('snapTo：阈值内吸到最近线、阈值外返回 null、边界（d==阈值）命中', () => {
  assert.equal(snapTo(105, [0, 100, 200], 6), 100, 'd=5≤6 吸到 100');
  assert.equal(snapTo(110, [0, 100, 200], 6), null, 'd=10>6 不吸');
  assert.equal(snapTo(106, [100], 6), 100, 'd=6==阈值 命中（闭区间）');
  assert.equal(snapTo(140, [100, 200], 60), 100, '多线取最近');
  assert.equal(snapTo(50, [], 6), null, '空参考线不吸');
});

test('collectSnapLines：框边+框中线+各区域边/中线，去重升序', () => {
  const frame = { x: 0, y: 0, w: 1000, h: 800 };
  const els = [area('a1', 100, 100, 300, 200), { id: 'f', kind: 'frame', type: 'frame', x: 0, y: 0, w: 1000, h: 800 } as TreeRenderElement];
  const { v, h } = collectSnapLines(els, frame);
  // 竖向：框 0/500/1000 + a1 100/250/400（frame 元素 kind!=='area' 不重复计入）
  assert.deepEqual(v, [0, 100, 250, 400, 500, 1000]);
  // 横向：框 0/400/800 + a1 100/200/300
  assert.deepEqual(h, [0, 100, 200, 300, 400, 800]);
});

test('collectSnapLines：excludeIds 跳过指定区域（拖中梃排除宿主移动子树）', () => {
  const frame = { x: 0, y: 0, w: 1000, h: 800 };
  const els = [area('a1', 100, 100, 300, 200), area('a2', 600, 100, 300, 200)];
  const { v, h } = collectSnapLines(els, frame, new Set(['a1']));
  assert.deepEqual(v, [0, 500, 600, 750, 900, 1000], 'a1 的 100/250/400 被排除，a2 保留');
  assert.deepEqual(h, [0, 100, 200, 300, 400, 800], 'a2 与 a1 同 y 区间，横向线不变');
});

test('hostSnapLines：均分线(k=2..6) + 区间内全局线；排除端点与区间外', () => {
  const lines = hostSnapLines(0, 1000, [0, 250, 500, 1000, 1500]);
  // 端点 0/1000 与区间外 1500 不计入
  assert.ok(!lines.includes(0), '左端点排除');
  assert.ok(!lines.includes(1000), '右端点排除');
  assert.ok(!lines.includes(1500), '区间外排除');
  // 全局线 250/500 落在开区间内保留
  assert.ok(lines.includes(250) && lines.includes(500));
  // 均分线：k=2→500；k=3→1000/3,2000/3；k=4→250,500,750；k=6→…833.33
  assert.ok(lines.includes(1000 / 3) && lines.includes(2000 / 3), 'k=3 三等分线');
  assert.ok(lines.includes(750), 'k=4 线');
  assert.ok(lines.some((l) => Math.abs(l - 1000 * (5 / 6)) < 1e-9), 'k=6 线 833.33');
  // 去重 + 升序
  const sorted = [...lines].sort((a, b) => a - b);
  assert.deepEqual(lines, sorted, '升序');
  assert.equal(new Set(lines).size, lines.length, '无重复');
});

test('hostSnapLines：kMax 控制均分密度；偏移 origin 正确平移', () => {
  const k2 = hostSnapLines(0, 1000, [], 2);
  assert.deepEqual(k2, [500], 'kMax=2 只有中线');
  const k3 = hostSnapLines(0, 1000, [], 3);
  assert.deepEqual(k3, [1000 / 3, 500, 2000 / 3], 'kMax=3 加三等分线');
  // origin 偏移：宿主从 x=200 起、宽 600 → 中线 500
  const off = hostSnapLines(200, 600, [], 2);
  assert.deepEqual(off, [500], 'origin/span 平移正确');
});
