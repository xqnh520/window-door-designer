import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  glassBarGeometry,
  glassBarCutLengths,
  BAR_W_OUTER,
  BAR_W_STRAIGHT,
  BAR_W_ARC,
  BAR_W_DIAGONAL,
  GLASS_BAR_PATTERN_IDS,
  GLASS_BAR_LABEL,
  GLASS_BAR_GROUPS,
  type GlassBarSpec,
} from '../src/window-tree.js';

const W = 1000;
const H = 1400;

const inRange = (g: NonNullable<ReturnType<typeof glassBarGeometry>>) => {
  for (const l of g.lines) {
    assert.ok(l.x1 >= 0 && l.x1 <= W && l.x2 >= 0 && l.x2 <= W, `横坐标越界 ${l.x1}/${l.x2}`);
    assert.ok(l.y1 >= 0 && l.y1 <= H && l.y2 >= 0 && l.y2 <= H, `纵坐标越界 ${l.y1}/${l.y2}`);
  }
  for (const r of g.rings) assert.ok(r.insetMm >= 0 && r.widthMm > 0);
  for (const a of g.arcs) assert.ok(a.rMm > 0 && a.cx - a.rMm >= -1 && a.cx + a.rMm <= W + 1);
};

test('未配置或显式关闭则无格条', () => {
  assert.equal(glassBarGeometry(W, H, undefined), null);
  assert.equal(glassBarGeometry(W, H, { pattern: 'rect', show: false }), null);
});

test('均分格条(colonial)：无 40mm 外环，内部按 cols×rows 出 20mm 直条', () => {
  const g = glassBarGeometry(W, H, { pattern: 'colonial', cols: 3, rows: 2 })!;
  assert.equal(g.rings.length, 0, '实测 colonial 不带外环');
  assert.equal(g.lines.length, (3 - 1) + (2 - 1));
  assert.ok(g.lines.every((l) => l.widthMm === BAR_W_STRAIGHT));
  inRange(g);
});

test('其余图案先有一圈 40mm 外环', () => {
  for (const p of ['rect', 'diamond', 'wheel', 'chinese'] as GlassBarSpec['pattern'][]) {
    const g = glassBarGeometry(W, H, { pattern: p })!;
    assert.equal(g.rings[0].widthMm, BAR_W_OUTER, `${p} 应有 40mm 外环`);
    assert.equal(g.rings[0].insetMm, 0);
  }
});

test('矩形格条(rect)：外环 + 内嵌一圈 20mm 环，无直条', () => {
  const g = glassBarGeometry(W, H, { pattern: 'rect' })!;
  assert.equal(g.rings.length, 2);
  assert.equal(g.rings[1].widthMm, BAR_W_STRAIGHT);
  assert.ok(g.rings[1].insetMm > 0);
  assert.equal(g.lines.length, 0);
});

test('菱形格条(diamond)：两条对角斜条 28mm', () => {
  const g = glassBarGeometry(W, H, { pattern: 'diamond' })!;
  assert.equal(g.lines.length, 2);
  assert.ok(g.lines.every((l) => l.widthMm === BAR_W_DIAGONAL));
  assert.notEqual(g.lines[0].x1, g.lines[0].x2, '对角线应有水平分量');
});

test('圆环格条(wheel)：10mm 同心环带，半径不超内框一半', () => {
  const g = glassBarGeometry(W, H, { pattern: 'wheel' })!;
  assert.ok(g.arcs.length >= 1);
  assert.ok(g.arcs.every((a) => a.widthMm === BAR_W_ARC));
  const innerHalf = (Math.min(W, H) - 2 * BAR_W_OUTER) / 2;
  assert.ok(g.arcs[0].rMm <= innerHalf + 1);
  inRange(g);
});

test('中式格条(chinese)：等分直条 + 四角短条', () => {
  const g = glassBarGeometry(W, H, { pattern: 'chinese', cols: 2, rows: 2 })!;
  assert.equal(g.lines.length, 1 + 1 + 4, '1 竖 + 1 横 + 4 角花');
  inRange(g);
});

test('极小玻璃不崩溃且外环自动变薄', () => {
  const g = glassBarGeometry(30, 40, { pattern: 'diamond' })!;
  assert.equal(g.rings[0].widthMm, BAR_W_OUTER, '描述子仍记录标准 40，内框按实际可用厚度收敛');
  assert.ok(g.lines.length === 2);
  const tiny = glassBarGeometry(12, 12, { pattern: 'wheel' })!;
  assert.ok(tiny.rings.length === 1);
});

const inArcRange = (a: { cx: number; cy: number; rMm: number; startDeg?: number; sweepDeg?: number }) => {
  const start = a.startDeg ?? 0;
  const sweep = a.startDeg === undefined ? 360 : (a.sweepDeg ?? 0);
  for (let i = 0; i <= 24; i++) {
    const rad = ((start + (sweep * i) / 24) * Math.PI) / 180;
    const x = a.cx + a.rMm * Math.cos(rad);
    const y = a.cy + a.rMm * Math.sin(rad);
    assert.ok(x >= -1 && x <= W + 1 && y >= -1 && y <= H + 1, `弧段越界 (${x.toFixed(1)},${y.toFixed(1)})`);
  }
};

test('全部图案的描述子都落在玻璃内', () => {
  for (const pattern of GLASS_BAR_PATTERN_IDS) {
    const g = glassBarGeometry(W, H, { pattern })!;
    assert.ok(g, pattern);
    for (const l of g.lines) {
      assert.ok(l.x1 >= 0 && l.x1 <= W && l.x2 >= 0 && l.x2 <= W, `${pattern} 横坐标越界`);
      assert.ok(l.y1 >= 0 && l.y1 <= H && l.y2 >= 0 && l.y2 <= H, `${pattern} 纵坐标越界`);
    }
    for (const a of g.arcs) inArcRange(a);
  }
});

test('实测条数/料厚：prairie 8×20、rightAngle 4×20、spoke 3×20', () => {
  const prairie = glassBarGeometry(W, H, { pattern: 'prairie' })!;
  assert.equal(prairie.lines.length, 8);
  assert.ok(prairie.lines.every((l) => l.widthMm === BAR_W_STRAIGHT));
  const angle = glassBarGeometry(W, H, { pattern: 'rightAngle' })!;
  assert.equal(angle.lines.length, 4);
  const spoke = glassBarGeometry(W, H, { pattern: 'spoke' })!;
  assert.equal(spoke.lines.length, 3);
  assert.ok(spoke.lines.some((l) => l.y1 === l.y2), '含一根水平过心条');
});

test('弧形式：弧带 10mm 且带 startDeg/sweepDeg（除 wheel 整圆外）', () => {
  const inner = glassBarGeometry(W, H, { pattern: 'innerArc' })!;
  assert.equal(inner.arcs.length, 2);
  assert.equal(inner.lines.length, 3);
  const semi = glassBarGeometry(W, H, { pattern: 'semiArc' })!;
  assert.equal(semi.lines.length, 7, '实测 10×7');
  const quarter = glassBarGeometry(W, H, { pattern: 'quarterArc' })!;
  assert.equal(quarter.lines.length, 4, '实测 10×4');
  assert.ok(quarter.arcs.every((a) => a.startDeg !== undefined && a.sweepDeg !== undefined && a.sweepDeg < 360));
  assert.ok(glassBarGeometry(W, H, { pattern: 'doubleArc' })!.lines.length === 5);
  assert.ok(glassBarGeometry(W, H, { pattern: 'extendableArc' })!.lines.length === 13, '实测 10×13');
  assert.equal(glassBarGeometry(W, H, { pattern: 'wheel' })!.arcs[0].startDeg, undefined, 'wheel 为整圆');
  const crab = glassBarGeometry(W, H, { pattern: 'crabapple' })!;
  assert.equal(crab.arcs.length, 0, '海棠角实测是旋转方环 + 直条，不用弧带');
});

test('海棠角(crabapple) 按实测：旋转方环 4 条 + 6 根贴边短条，全部 20mm', () => {
  const g = glassBarGeometry(W, H, { pattern: 'crabapple' })!;
  assert.equal(g.lines.length, 10, '4 条环带边 + 4 横短条 + 2 竖短条');
  assert.ok(g.lines.every((l) => l.widthMm === BAR_W_STRAIGHT));
  const slanted = g.lines.filter((l) => Math.abs(l.x2 - l.x1) > 1 && Math.abs(l.y2 - l.y1) > 1);
  assert.equal(slanted.length, 4, '方环四边都应是斜的（绕心旋转 ~29°）');
  assert.ok(slanted.every((l) => Math.abs(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) - Math.hypot(slanted[0].x2 - slanted[0].x1, slanted[0].y2 - slanted[0].y1)) < 2), '四边等长');
  const touching = g.lines.filter((l) => Math.abs(l.x2 - l.x1) < 1 || Math.abs(l.y2 - l.y1) < 1);
  assert.equal(touching.length, 6, '6 根直上直下的连接短条');
  // 短条顶到 40mm 外环的内缘（非 colonial 图案都先有外环）
  const t = BAR_W_OUTER;
  const onEdge = touching.filter((l) => {
    const vertical = Math.abs(l.x2 - l.x1) < 1;
    return vertical ? l.y1 === t || l.y1 === H - t : l.x1 === t || l.x1 === W - t;
  });
  assert.equal(onEdge.length, 6, '短条必须顶到外环内缘');
  inRange(g);
});

test('topBar 叠加：任一图案多一根 20mm 顶部横档', () => {
  for (const pattern of ['rect', 'semiArc', 'colonial'] as GlassBarSpec['pattern'][]) {
    const base = glassBarGeometry(W, H, { pattern })!;
    const withTop = glassBarGeometry(W, H, { pattern, topBar: true })!;
    assert.equal(withTop.lines.length, base.lines.length + 1);
    const bar = withTop.lines[withTop.lines.length - 1];
    assert.equal(bar.y1, bar.y2);
    assert.equal(bar.widthMm, BAR_W_STRAIGHT);
    assert.ok(bar.y1 < H / 2, '横档应在玻璃上半部');
  }
});

test('下料长度：未配置或关闭不出料', () => {
  assert.deepEqual(glassBarCutLengths(W, H, undefined), []);
  assert.deepEqual(glassBarCutLengths(W, H, { pattern: 'rect', show: false }), []);
});

test('下料长度：均分格条按直条实际跨距（1400×2 + 1000×1）', () => {
  assert.deepEqual(glassBarCutLengths(W, H, { pattern: 'colonial', cols: 3, rows: 2 }), [1400, 1400, 1000]);
});

test('下料长度：矩形格条 8 根（外环 45° 拼角 + 内环），无直条', () => {
  const lens = glassBarCutLengths(W, H, { pattern: 'rect' });
  assert.equal(lens.length, 8);
  assert.ok(lens.includes(1000) && lens.includes(1360), `外环中心线长应为 1000/1360，实得 ${lens.join(',')}`);
  assert.ok(lens.includes(760) && lens.includes(1140), `内环中心线长应为 760/1140，实得 ${lens.join(',')}`);
});

test('下料长度：弧带按中心线弧长（整圆 2πr、半圆 πr）', () => {
  const wheel = glassBarCutLengths(W, H, { pattern: 'wheel' });
  assert.equal(wheel.length, 5, '外环 4 根 + 1 根整圆环带');
  const circle = wheel[wheel.length - 1];
  assert.ok(Math.abs(circle - Math.PI * 2 * 460) < 3, `整圆周应≈${Math.round(Math.PI * 2 * 460)}，实得 ${circle}`);

  const semi = glassBarGeometry(W, H, { pattern: 'semiArc' })!;
  const semiLens = glassBarCutLengths(W, H, { pattern: 'semiArc' });
  const arcLen = semiLens[semiLens.length - 1];
  assert.ok(Math.abs(arcLen - Math.PI * semi.arcs[0].rMm) < 3, `半弧应≈πr=${Math.round(Math.PI * semi.arcs[0].rMm)}，实得 ${arcLen}`);
  assert.ok(arcLen < Math.PI * 2 * semi.arcs[0].rMm - 100, '半弧不得按整圆周计料');
});

test('格条分组/标签与 GLASS_BAR_PATTERN_IDS 同源不漂移（左栏飞出面板直接消费）', () => {
  const flat = GLASS_BAR_GROUPS.flatMap((g) => g.value);
  assert.equal(flat.length, new Set(flat).size, '分组内不得有重复图案');
  assert.deepEqual([...flat].sort(), [...GLASS_BAR_PATTERN_IDS].sort(), '分组摊平后应覆盖全部图案');
  for (const g of GLASS_BAR_GROUPS) assert.ok(g.label && g.value.length > 0, '分组不得空标签或空项');
  for (const p of GLASS_BAR_PATTERN_IDS) {
    assert.ok(GLASS_BAR_LABEL[p], `${p} 缺中文名`);
    assert.ok(glassBarGeometry(W, H, { pattern: p }), `${p} 应有几何`);
  }
});
