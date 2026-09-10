import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWindowTree, splitArea, layoutContours, type WindowTree } from '../src/window-tree.js';
import { describeWindowTree } from '../src/window-tree-describe.js';
import { sampleOutline, clipByAxis, polygonLen, pointInPoly, polygonArea, insetPolygon, splitByChain, arcChain, clipByArcBand, clipByDiagonalBand, arcFromChord, regionAnchor, FRAME_SHAPE_IDS, FRAME_SHAPE_GROUPS, FRAME_SHAPE_LABEL, TRAPEZOID_SHAPES, type FrameShape, type Pt } from '../src/outline.js';
import { DesignComponentSchema } from '@wdd/schema';

const GAP = 20;
const FW = 60;

function makeTree(shape: FrameShape): WindowTree {
  return createWindowTree({
    openingW: 1500,
    openingH: 1100,
    seriesId: 'series-60',
    glassId: 'g-5-12a-5',
    frameWidthMm: FW,
    name: `异形-${shape}`,
    frameShape: shape,
  });
}

test('sampleOutline：梯形顶边按 topRatio 缩窄', () => {
  const pts = sampleOutline('trapezoid', { x: 0, y: 0, w: 1000, h: 800 }, { inset: 0, topRatio: 0.6 });
  assert.equal(pts.length, 4);
  const topYs = pts.filter((p) => p.y === 0);
  const topWidth = Math.max(...topYs.map((p) => p.x)) - Math.min(...topYs.map((p) => p.x));
  assert.equal(topWidth, 600); // 顶宽 = 0.6 * 1000
  assert.equal(polygonLen(pts) > 1000, true);
});

test('sampleOutline：尖拱为贝塞尔采样多边形（>8 点）', () => {
  const pts = sampleOutline('gothic', { x: 0, y: 0, w: 1000, h: 800 }, { inset: 0 });
  assert.equal(pts.length > 8, true);
});

test('sampleOutline：拱形严格填满外框（拱顶=框顶、底边=框底，不溢出）', () => {
  const cases: { x: number; y: number; w: number; h: number }[] = [
    { x: 0, y: 0, w: 1000, h: 800 }, // h < w：曾溢出框顶
    { x: 0, y: 0, w: 800, h: 1200 }, // h > w：曾够不到框顶
    { x: 100, y: 50, w: 900, h: 900 }, // 带偏移 + h=w
  ];
  for (const b of cases) {
    const pts = sampleOutline('arch', b, { inset: 0 });
    const ys = pts.map((p) => p.y);
    const xs = pts.map((p) => p.x);
    assert.ok(Math.min(...ys) >= b.y - 1e-6, `拱顶不得高于框顶 (${b.w}x${b.h})`);
    assert.ok(Math.max(...ys) <= b.y + b.h + 1e-6, `底边不得超出框底 (${b.w}x${b.h})`);
    assert.ok(Math.min(...xs) >= b.x - 1e-6, `不得超出左边 (${b.w}x${b.h})`);
    assert.ok(Math.max(...xs) <= b.x + b.w + 1e-6, `不得超出右边 (${b.w}x${b.h})`);
    assert.ok(Math.abs(Math.min(...ys) - b.y) < 1e-6, `拱顶应落在框顶 (${b.w}x${b.h})`);
    assert.ok(Math.abs(Math.max(...ys) - (b.y + b.h)) < 1e-6, `底边应落在框底 (${b.w}x${b.h})`);
  }
});

test('sampleOutline：内缩后周长严格小于外轮廓', () => {
  for (const shape of ['trapezoid', 'arch', 'gothic'] as FrameShape[]) {
    const outer = sampleOutline(shape, { x: 0, y: 0, w: 1000, h: 800 }, { inset: 0 });
    const inner = sampleOutline(shape, { x: 0, y: 0, w: 1000, h: 800 }, { inset: 60 });
    assert.equal(polygonLen(inner) < polygonLen(outer), true, `${shape} 内缩周长应更小`);
  }
});

test('clipByAxis：梯形竖切 → 左子区/中梃带/右子区，面积守恒', () => {
  const poly = sampleOutline('trapezoid', { x: 0, y: 0, w: 1000, h: 800 }, { inset: 0, topRatio: 0.6 });
  const r = clipByAxis(poly, 'vertical', 0.5, 40);
  assert.ok(r, '裁剪应成功');
  const area = (pts: Pt[]): number => {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
  };
  const total = area(poly);
  const parts = area(r.a) + area(r.muntin) + area(r.b);
  assert.ok(Math.abs(total - parts) < 1, `面积守恒: ${total} ≈ ${parts}`);
  // 中梃为带形
  assert.equal(r.muntin.length >= 4, true);
});

test('clipByAxis：横切梯形 → 上/下子区', () => {
  const poly = sampleOutline('trapezoid', { x: 0, y: 0, w: 1000, h: 800 }, { inset: 0, topRatio: 0.6 });
  const r = clipByAxis(poly, 'horizontal', 0.5, 40);
  assert.ok(r);
  assert.ok(pointInPoly({ x: 500, y: 100 }, r.a), '上方子区应含顶部中点');
  assert.ok(pointInPoly({ x: 500, y: 740 }, r.b), '下方子区应含底部中点');
});

test('layoutContours：异形树分割后子区/中梃均有裁剪轮廓', () => {
  const tree = makeTree('trapezoid');
  splitArea(tree, tree.root!.id, 'vertical', 0.5, 40);
  const map = layoutContours(tree, { installGap: GAP });
  assert.equal(map.size, 4); // root + muntin + 两个子区
  assert.ok(map.has(tree.root!.id));
  const [a1, m, a2] = tree.root!.children!;
  assert.ok(map.has(a1.id));
  assert.ok(map.has(m.id));
  assert.ok(map.has(a2.id));
  for (const pts of map.values()) assert.ok(pts.length >= 3);
});

test('describeWindowTree：异形 frame 携带 shape 与轮廓点，矩形不携带', () => {
  const irr = describeWindowTree(makeTree('arch'), GAP);
  const frame = irr.find((e) => e.kind === 'frame')!;
  assert.equal(frame.shape, 'arch');
  assert.ok(frame.points && frame.points.length >= 8);

  const rectTree = createWindowTree({ openingW: 1500, openingH: 1100, seriesId: 'series-60', glassId: 'g-5-12a-5', frameWidthMm: FW, name: '矩形' });
  const rect = describeWindowTree(rectTree, GAP).find((e) => e.kind === 'frame')!;
  assert.equal(rect.shape, 'rect');
  assert.equal(rect.points, undefined);
});

const NEW_SHAPES = FRAME_SHAPE_IDS;
const BOX = { x: 100, y: 50, w: 1500, h: 1100 };

test('形状清单防漂移：FRAME_SHAPE_IDS 全覆盖且都过 schema 校验', () => {
  assert.ok(NEW_SHAPES.length >= 18, `形状清单至少应含 18 种，实得 ${NEW_SHAPES.length}`);
  assert.equal(new Set(NEW_SHAPES).size, NEW_SHAPES.length, '不得有重复 id');
  for (const shape of NEW_SHAPES) {
    const ok = DesignComponentSchema.safeParse({ id: 'c1', kind: 'outerFrame', x: 0, y: 0, w: 100, h: 100, shape }).success;
    assert.ok(ok, `${shape} 应被 DesignComponent.shape 接受`);
  }
  assert.ok(sampleOutline('roundedRect', BOX, { inset: 0 }).length > 4, '圆角矩形应被圆角采样');
  const bad = DesignComponentSchema.safeParse({ id: 'c1', kind: 'outerFrame', x: 0, y: 0, w: 100, h: 100, shape: 'quatrefoil' }).success;
  assert.equal(bad, false, '未收录的形状（非凸等）不应被接受');
});

/** 简单多边形（无自交）判定：忽略相邻边与共享端点 */
function isSimple(pts: Pt[]): boolean {
  const seg = (a: Pt, b: Pt, c: Pt, d: Pt): boolean => {
    const cross = (p: Pt, q: Pt, r: Pt): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = cross(c, d, a);
    const d2 = cross(c, d, b);
    const d3 = cross(a, b, c);
    const d4 = cross(a, b, d);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      if (seg(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}

test('全形状不变式：不越界、简单多边形、内缩更小、横竖都能分割且面积守恒', () => {
  for (const shape of NEW_SHAPES) {
    const pts = sampleOutline(shape, BOX, { inset: 0, topRatio: 0.6 });
    assert.ok(pts.length >= 3, `${shape} 点数`);
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    assert.ok(Math.min(...xs) >= BOX.x - 1e-3 && Math.max(...xs) <= BOX.x + BOX.w + 1e-3, `${shape} x 越界`);
    assert.ok(Math.min(...ys) >= BOX.y - 1e-3 && Math.max(...ys) <= BOX.y + BOX.h + 1e-3, `${shape} y 越界`);
    // 带角部圆角的形状本就不会顶到包围盒角点（三角形最左点即被切掉的底角），故只约束「不越界 + 跨度」
    assert.ok(Math.max(...xs) - Math.min(...xs) >= BOX.w * 0.78, `${shape} 宽度过小`);
    assert.ok(Math.max(...ys) - Math.min(...ys) >= BOX.h * 0.78, `${shape} 高度过小`);
    assert.ok(polygonArea(pts) > 0.3 * BOX.w * BOX.h, `${shape} 面积过小`);
    assert.ok(isSimple(pts), `${shape} 外轮廓自交`);
    const inner = sampleOutline(shape, BOX, { inset: FW, topRatio: 0.6 });
    assert.ok(polygonLen(inner) < polygonLen(pts), `${shape} 内缩后周长应更小`);
    assert.ok(isSimple(inner), `${shape} 内缩轮廓自交`);
    const total = polygonArea(pts);
    for (const axis of ['vertical', 'horizontal'] as const) {
      const cut = clipByAxis(pts, axis, 0.5, 40);
      assert.ok(cut && cut.a.length >= 3 && cut.b.length >= 3 && cut.muntin.length >= 3, `${shape} ${axis} 分割失败`);
      assert.ok(isSimple(cut.a) && isSimple(cut.muntin) && isSimple(cut.b), `${shape} ${axis} 分割结果自交（桥接多边形）`);
      const parts = polygonArea(cut.a) + polygonArea(cut.muntin) + polygonArea(cut.b);
      assert.ok(Math.abs(total - parts) < total * 1e-6 + 1, `${shape} ${axis} 分割面积不守恒：${total} vs ${parts}`);
    }
  }
});

test('凹形：确实是凹的、面积比按实测、穿过耳/缺口的分割不自交', () => {
  const B = { x: 0, y: 0, w: 1000, h: 800 };
  const ratio = (s: FrameShape): number => polygonArea(sampleOutline(s, B, { inset: 0 })) / (B.w * B.h);
  assert.ok(Math.abs(ratio('lShape') - 0.888) < 0.01, `倒L ${ratio('lShape')}`);
  assert.ok(Math.abs(ratio('notchTop') - 0.894) < 0.01, `顶凹口 ${ratio('notchTop')}`);
  assert.ok(Math.abs(ratio('earsTop') - 0.657) < 0.01, `双耳T ${ratio('earsTop')}`);

  // 确实是凹形：顶部凹口里、以及倒L 缺角里的点都在包围盒内却在轮廓外
  const notch = sampleOutline('notchTop', B, { inset: 0 });
  assert.ok(!pointInPoly({ x: 500, y: 100 }, notch) && pointInPoly({ x: 100, y: 100 }, notch), '凹口内应无面积');
  const ear = sampleOutline('lShape', B, { inset: 0 });
  assert.ok(!pointInPoly({ x: 900, y: 700 }, ear), '倒L 右下缺角处应在轮廓外');

  // 旧 Sutherland–Hodgman 会在凹形上产出桥接自交结果；链配对必须给出干净的多边形
  const cut = clipByAxis(ear, 'vertical', 0.8, 40);
  assert.ok(cut, '穿过耳部应能分割');
  assert.ok(isSimple(cut!.a) && isSimple(cut!.muntin) && isSimple(cut!.b), '凹形分割结果不得自交');
  const parts = polygonArea(cut!.a) + polygonArea(cut!.muntin) + polygonArea(cut!.b);
  assert.ok(Math.abs(parts - polygonArea(ear)) < 1, `面积守恒 ${polygonArea(ear)} vs ${parts}`);
});

test('圆类面积比：整圆 / 半圆 / 四分之一圆都填满包围盒，面积比≈π/4（折线逼近略小）', () => {
  const ratio = (s: FrameShape): number => polygonArea(sampleOutline(s, { x: 0, y: 0, w: 1200, h: 1200 }, { inset: 0 })) / (1200 * 1200);
  assert.ok(Math.abs(ratio('circle') - Math.PI / 4) < 0.03, `圆 ${ratio('circle')}`);
  assert.ok(Math.abs(ratio('halfCircle') - Math.PI / 4) < 0.03, `半圆 ${ratio('halfCircle')}`);
  assert.ok(Math.abs(ratio('quarterCircle') - Math.PI / 4) < 0.03, `四分之一圆 ${ratio('quarterCircle')}`);
});

test('方向变体是旋转/镜像而非重绘：交换宽高后面积不变，镜像面积不变但直角换边', () => {
  const up = polygonArea(sampleOutline('trapezoid', { x: 0, y: 0, w: 1500, h: 1100 }, { inset: 0, topRatio: 0.6 }));
  const right = polygonArea(sampleOutline('trapezoidRight', { x: 0, y: 0, w: 1100, h: 1500 }, { inset: 0, topRatio: 0.6 }));
  assert.ok(Math.abs(up - right) / up < 0.01, `梯形旋转后面积应不变：${up} vs ${right}`);

  const q = sampleOutline('quarterCircle', { x: 0, y: 0, w: 1000, h: 1000 }, { inset: 0 });
  const ql = sampleOutline('quarterCircleLeft', { x: 0, y: 0, w: 1000, h: 1000 }, { inset: 0 });
  assert.ok(Math.abs(polygonArea(q) - polygonArea(ql)) < 1, '镜像面积应相同');
  const cornerAt = (pts: Pt[], cx: number, cy: number): boolean => pts.some((p) => Math.abs(p.x - cx) < 1 && Math.abs(p.y - cy) < 1);
  // 竖直直边在左侧 → 有左上顶点；镜像后直边换到右侧
  assert.ok(cornerAt(q, 0, 0), '原方向应有左上顶点（竖直直边在左）');
  assert.ok(!cornerAt(ql, 0, 0) && cornerAt(ql, 1000, 0), '镜像后左上无顶点、右上有');
});

test('实测新形状：直角三角形、斜角五边形、顶部圆角矩形、r0.2 圆角矩形', () => {
  const B = { x: 0, y: 0, w: 1000, h: 800 };
  const near = (a: number, b: number, tol: number, msg: string) => assert.ok(Math.abs(a - b) < tol, `${msg}：${a}`);

  const rt = sampleOutline('rightTriangle', B, { inset: 0 });
  near(polygonArea(rt) / (1000 * 800), 0.5, 0.02, '直角三角形面积应为包围盒一半');
  const has = (pts: Pt[], x: number, y: number) => pts.some((p) => Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1);
  assert.ok(has(rt, 0, 0) && has(rt, 1000, 800), '左上/右下应保持尖角（实测只圆直角处）');
  assert.ok(!has(rt, 0, 800), '左下角是直角，应被 r0.1 圆角');

  const rtl = sampleOutline('rightTriangleLeft', B, { inset: 0 });
  near(polygonArea(rtl), polygonArea(rt), 1, '镜像面积应相同');
  assert.ok(has(rtl, 1000, 0) && has(rtl, 0, 800), '镜像后右上/左下为尖角');
  assert.ok(!has(rtl, 1000, 800), '镜像后直角在右下，应被圆角');

  const ap = sampleOutline('angledPentagon', B, { inset: 0 });
  near(polygonArea(ap) / (1000 * 800), 1 - 0.5 * 0.535 * 0.308, 0.01, '斜角五边形应只切掉左上角');
  assert.equal(ap.length, 5, '该形状实测无圆角，应保持 5 个尖角');

  const ht = sampleOutline('hexagonTop', B, { inset: 0 });
  assert.ok(has(ht, 0, 800) && has(ht, 1000, 800), '顶部圆角矩形底部两角应仍是尖角');
  assert.ok(!has(ht, 0, 0), '左上角应被圆角切掉');
  assert.ok(ht.length > 4, '顶部两角被圆角采样');

  const rr = sampleOutline('roundedRect', B, { inset: 0 });
  assert.ok(rr.length >= 16, `圆角矩形应四角各采样，实得 ${rr.length}`);
  assert.ok(polygonArea(rr) / (1000 * 800) > 0.5 && polygonArea(rr) < 800000, '大圆角应削掉可观面积但不失控');
});

test('实测角部圆角：多边形顶点数远多于尖角数，面积略小于尖角版', () => {
  const sharp = { triangle: 3, diamond: 4, hexagon: 6, octagon: 8 } as Record<string, number>;
  for (const shape of ['triangle', 'diamond', 'hexagon', 'octagon'] as FrameShape[]) {
    const pts = sampleOutline(shape, { x: 0, y: 0, w: 1400, h: 1000 }, { inset: 0 });
    assert.ok(pts.length > sharp[shape] * 3, `${shape} 应被圆角采样成 ${pts.length} 点`);
    assert.ok(polygonArea(pts) < 1400 * 1000, `${shape} 圆角后面积应小于包围盒`);
  }
  // 圆角切掉的是角，不是边：整圈周长不应大幅缩水
  const oct = sampleOutline('octagon', { x: 0, y: 0, w: 1400, h: 1000 }, { inset: 0 });
  assert.ok(polygonLen(oct) > 2 * (1400 + 1000) * 0.8, `八边形周长 ${polygonLen(oct)}`);
});

/** 点到线段的最短距离 */
const segDist = (p: Pt, a: Pt, b: Pt): number => {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return Math.hypot(p.x - (a.x + (b.x - a.x) * t), p.y - (a.y + (b.y - a.y) * t));
};

/** 点到闭合折线边界的最短距离 */
const boundaryDist = (p: Pt, poly: Pt[]): number => {
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) min = Math.min(min, segDist(p, poly[i], poly[(i + 1) % poly.length]));
  return min;
};

/** 等距内缩的工程判据：料厚处处不欠、且每个顶点仍在原轮廓内 */
function assertNoUndercut(outer: Pt[], d: number, label: string): void {
  const inner = insetPolygon(outer, d);
  assert.ok(inner.length >= 3, `${label}：内缩轮廓退化`);
  for (const p of inner) {
    assert.ok(boundaryDist(p, outer) >= d - 0.02, `${label}：存在内缩不足 ${d} 的点（实测 ${boundaryDist(p, outer).toFixed(2)}）`);
    assert.ok(pointInPoly(p, outer), `${label}：内缩点跑到原轮廓外`);
  }
}

test('等距内缩：矩形精确到四边各 60，面积 (w−2d)(h−2d)', () => {
  const rect: Pt[] = [{ x: 0, y: 0 }, { x: 1500, y: 0 }, { x: 1500, y: 1100 }, { x: 0, y: 1100 }];
  const inner = insetPolygon(rect, 60);
  assert.equal(inner.length, 4);
  assert.equal(Math.min(...inner.map((p) => p.x)), 60);
  assert.equal(Math.max(...inner.map((p) => p.x)), 1440);
  assert.equal(Math.min(...inner.map((p) => p.y)), 60);
  assert.equal(Math.max(...inner.map((p) => p.y)), 1040);
  assert.ok(Math.abs(polygonArea(inner) - 1380 * 980) < 1, `面积 ${polygonArea(inner)}`);
  // 旧「向质心缩放」把内腔算大了：按对角线比例缩放，1500×1100 会得 1402×1028（偏大 6.6%）
  const legacy = rect.map((p) => {
    const r = Math.hypot(p.x - 750, p.y - 550);
    const f = 1 - 60 / r;
    return { x: 750 + (p.x - 750) * f, y: 550 + (p.y - 550) * f };
  });
  assert.ok(polygonArea(legacy) / polygonArea(inner) - 1 > 0.06, `旧算法应明显偏大，实得 ${(polygonArea(legacy) / polygonArea(inner)).toFixed(3)}`);
});

test('等距内缩：全部形状料厚处处不欠（旧质心缩放在角部会欠）', () => {
  for (const shape of FRAME_SHAPE_IDS) {
    const outer = sampleOutline(shape, { x: 0, y: 0, w: 1500, h: 1100 }, { inset: 0, topRatio: 0.6 });
    assertNoUndercut(outer, 60, shape);
  }
});

test('等距内缩：凹形周长不增大；缺口比 2d 窄时退回兜底仍是有效轮廓', () => {
  for (const shape of ['lShape', 'notchTop', 'earsTop'] as FrameShape[]) {
    const outer = sampleOutline(shape, { x: 0, y: 0, w: 1200, h: 900 }, { inset: 0 });
    const inner = insetPolygon(outer, 60);
    assert.ok(polygonArea(inner) > 0, `${shape} 内缩后面积应为正`);
    assert.ok(polygonLen(inner) <= polygonLen(outer) + 1, `${shape} 内缩周长不应变大`);
    assert.ok(inner.every((p) => pointInPoly(p, outer)), `${shape} 内缩点应仍在原轮廓内`);
  }
  const huge = insetPolygon(sampleOutline('notchTop', { x: 0, y: 0, w: 400, h: 300 }, { inset: 0 }), 140);
  assert.ok(huge.length >= 3 && polygonArea(huge) > 0, '超大内缩应走兜底而不是产出自交轮廓');
});

test('等距内缩：已验收的凹形内腔数字不变（新 join 规则只在旧结果无效时才启用）', () => {
  const accepted: Record<string, [number, number]> = {
    lShape: [1168872, 4685],
    notchTop: [1127640, 5530],
    earsTop: [790875, 4650],
  };
  for (const [shape, [area, len]] of Object.entries(accepted)) {
    const outer = sampleOutline(shape as FrameShape, { x: 0, y: 0, w: 1500, h: 1100 }, { inset: 0, topRatio: 0.6 });
    const inner = insetPolygon(outer, 60);
    assert.equal(Math.round(Math.abs(polygonArea(inner))), area, `${shape} 内腔面积`);
    assert.equal(Math.round(polygonLen(inner)), len, `${shape} 内腔周长`);
  }
});

test('等距内缩：弧梃切出的凹形叶内缩后仍在原轮廓内（旧 join 在弧链与直边的锐角处把点甩到外面）', () => {
  const rect: Pt[] = [{ x: 0, y: 0 }, { x: 1080, y: 0 }, { x: 1080, y: 1380 }, { x: 0, y: 1380 }];
  const cut = clipByArcBand(rect, 'horizontal', 0.5, 40, 200);
  assert.ok(cut, '弧带应能切出三块');
  for (const [label, leaf] of [['上叶', cut.a], ['下叶', cut.b]] as [string, Pt[]][]) {
    for (const d of [2, 45, 60]) {
      const inner = insetPolygon(leaf, d);
      assert.ok(inner.length >= 3 && polygonArea(inner) > 0, `${label} ${d}：内缩轮廓退化`);
      assert.ok(inner.every((p) => pointInPoly(p, leaf)), `${label} ${d}：内缩点跑到原轮廓外`);
      assert.ok(Math.abs(polygonArea(inner)) < Math.abs(polygonArea(leaf)), `${label} ${d}：内缩后面积应变小`);
    }
  }
});
// ── P17 弧梃几何底座：splitByChain / arcChain ──────────────────

const RECT: Pt[] = [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 800 }, { x: 0, y: 800 }];
const ARC_C = { x: 600, y: 1200 };

test('splitByChain：直线链切矩形 = 两块矩形，面积精确守恒', () => {
  const r = splitByChain(RECT, [{ x: 500, y: -10 }, { x: 500, y: 810 }]);
  assert.ok(r);
  assert.equal(Math.round(polygonArea(r.a)), 500 * 800);
  assert.equal(Math.round(polygonArea(r.b)), 700 * 800);
  assert.equal(r.a.length, 4);
  assert.equal(r.b.length, 4);
});

test('splitByChain：弧链把矩形切出弧形分格（靠近圆心的一侧为弧边块）', () => {
  const chain = arcChain(ARC_C, 900, -150, -30);
  const r = splitByChain(RECT, chain);
  assert.ok(r, '应切成两块');
  const dist = (p: Pt) => Math.hypot(p.x - ARC_C.x, p.y - ARC_C.y);
  assert.ok(Math.max(...r.a.map(dist)) <= 900 + 1e-6, '弧边块所有顶点都应在圆内/圆上');
  // 圆外块的边界是弧的**内接折线**，会比圆近一点（32 段采样时矢高≈0.5mm）
  assert.ok(Math.min(...r.b.map(dist)) >= 900 - 1, '另一块只含圆外的矩形部分');
  assert.equal(Math.min(...r.a.map((p) => p.y)), 300, '弧顶应在 y=300（c.y − r）');
  assert.equal(Math.min(...r.b.map((p) => p.y)), 0, '圆外块保留矩形顶边');
  assert.ok(Math.abs(polygonArea(r.a) + polygonArea(r.b) - 1200 * 800) < 1);
  assert.ok(r.a.length > 8, '弧边块应带弧采样点');
});

test('splitByChain：两次切割叠出等宽弧梃带（内叶 + 带 + 外叶，三者面积守恒）', () => {
  const outer = splitByChain(RECT, arcChain(ARC_C, 900, -150, -30));
  assert.ok(outer);
  const inner = splitByChain(outer.a, arcChain(ARC_C, 850, -150, -30));
  assert.ok(inner, '内弧应能再切一刀');
  const [leafIn, band, leafOut] = [inner.a, inner.b, outer.b];
  for (const piece of [leafIn, band, leafOut]) {
    assert.ok(polygonArea(piece) > 1, '每块面积应为正');
  }
  assert.ok(Math.abs(polygonArea(leafIn) + polygonArea(band) + polygonArea(leafOut) - 1200 * 800) < 1, '三块应拼回原矩形');
  const dist = (p: Pt) => Math.hypot(p.x - ARC_C.x, p.y - ARC_C.y);
  const bandR = band.map(dist);
  assert.ok(Math.abs(Math.max(...bandR) - 900) < 1 && Math.abs(Math.min(...bandR) - 850) < 1, '带厚应恒为 50mm（等距弧带）');
});

test('splitByChain：不相交 / 穿越多次一律拒绝，任意起伏曲线可正常切', () => {
  assert.equal(splitByChain(RECT, [{ x: -50, y: -50 }, { x: -20, y: -10 }]), null, '不相交应拒绝');
  // 上下起伏但只在左右各穿一次 → 合法单次切割（任意曲线分隔可用）
  const wavy: Pt[] = [];
  for (let i = 0; i <= 40; i++) wavy.push({ x: -10 + (i * 1220) / 40, y: 400 + 300 * Math.sin((i / 40) * Math.PI * 3) });
  const ok = splitByChain(RECT, wavy);
  assert.ok(ok, '起伏曲线应能切成两块');
  assert.ok(Math.abs(polygonArea(ok.a) + polygonArea(ok.b) - 1200 * 800) < 1, '面积守恒');
  // 穿进再穿出（4 个交点）→ 拒绝，不产出歧义轮廓
  const fourTimes: Pt[] = [{ x: -10, y: 100 }, { x: 300, y: 700 }, { x: 600, y: 900 }, { x: 900, y: 700 }, { x: 1210, y: 100 }];
  assert.equal(splitByChain(RECT, fourTimes), null, '穿越 4 次应拒绝');
  const notch = sampleOutline('notchTop', { x: 0, y: 0, w: 1200, h: 900 }, { inset: 0 });
  const r = splitByChain(notch, [{ x: -10, y: 200 }, { x: 1210, y: 200 }]);
  assert.ok(r === null || Math.abs(polygonArea(r.a) + polygonArea(r.b) - polygonArea(notch)) < 1, '凹形要么拒绝、要么严格守恒');
});

const BAND_RECT: Pt[] = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }];

test('clipByArcBand：弧带分割三块拼合、带宽恒等、a/b 与 clipByAxis 同向', () => {
  const t = 40;
  const r = clipByArcBand(BAND_RECT, 'vertical', 0.5, t, 200);
  assert.ok(r, '应切出三块');
  const whole = polygonArea(BAND_RECT);
  assert.ok(Math.abs(polygonArea(r.a) + polygonArea(r.muntin) + polygonArea(r.b) - whole) < 2, '面积守恒');
  // 弧向左凸出（sagitta>0 → 法向 -x），左子区应更小
  assert.ok(polygonArea(r.a) < polygonArea(r.b), `左子区应更小：${Math.round(polygonArea(r.a))} vs ${Math.round(polygonArea(r.b))}`);
  // 带厚 = 沿径向的最大-最小距离差 ≈ 料厚（圆心由弦+弧高推出，勿手算）
  const arc = arcFromChord({ x: 500, y: 0 }, { x: 500, y: 1000 }, 200);
  assert.ok(arc);
  assert.ok(Math.abs(arc.rMm - 725) < 1, `半径应≈725，实得 ${arc.rMm.toFixed(1)}`);
  const d = (p: Pt) => Math.hypot(p.x - arc.center.x, p.y - arc.center.y);
  const rad = r.muntin.map(d);
  assert.ok(Math.abs(Math.max(...rad) - Math.min(...rad) - t) < 1, `带厚应≈${t}，实得 ${(Math.max(...rad) - Math.min(...rad)).toFixed(2)}`);
  // 弧长 × 料厚 ≈ 带面积（弦 1000、弧高 200 → r=725、包角≈87.2° → 弧长≈1103）
  assert.ok(Math.abs(polygonArea(r.muntin) - 1103 * t) / (1103 * t) < 0.03, `带面积应≈弧长×料厚，实得 ${Math.round(polygonArea(r.muntin))}`);
});

test('clipByArcBand：反向弧高交换左右，弧高 0 退化为直线分割', () => {
  const neg = clipByArcBand(BAND_RECT, 'vertical', 0.5, 40, -200);
  assert.ok(neg);
  assert.ok(polygonArea(neg.a) > polygonArea(neg.b), '反向凸出时左子区应更大');
  const straight = clipByArcBand(BAND_RECT, 'vertical', 0.5, 40, 0);
  const ref = clipByAxis(BAND_RECT, 'vertical', 0.5, 40);
  assert.ok(straight && ref);
  assert.equal(Math.round(polygonArea(straight.a)), Math.round(polygonArea(ref.a)), '弧高 0 应与 clipByAxis 完全一致');
});

test('clipByDiagonalBand：斜带三块拼合、带面积=对角线×料厚、a/b 按对角偏移定向、退化一律拒绝', () => {
  const rect: Pt[] = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }];
  const t = 40;
  const diag = Math.hypot(1000, 800);
  const meanX = (pts: Pt[]): number => pts.reduce((s, p) => s + p.x, 0) / pts.length;
  for (const slope of ['diagonal', 'antiDiagonal'] as const) {
    const r = clipByDiagonalBand(rect, slope, 0.5, t);
    assert.ok(r, `${slope} 角到角应切得出`);
    const whole = polygonArea(rect);
    assert.ok(
      Math.abs(polygonArea(r.a) + polygonArea(r.muntin) + polygonArea(r.b) - whole) < 2,
      `${slope} 三块面积应守恒`,
    );
    assert.equal(r.a.length, 3, `${slope} 角到角两侧都应是三角形`);
    assert.equal(r.b.length, 3);
    assert.ok(
      Math.abs(polygonArea(r.muntin) - diag * t) / (diag * t) < 0.05,
      `${slope} 带面积应≈对角线×料厚，实得 ${Math.round(polygonArea(r.muntin))}`,
    );
    // a = 小 f 侧：↘ 时含右上角，↗ 时含左上角
    assert.ok(
      slope === 'diagonal' ? meanX(r.a) > meanX(r.b) : meanX(r.a) < meanX(r.b),
      `${slope} 的 a 侧方向不对（meanX a=${meanX(r.a).toFixed(0)} b=${meanX(r.b).toFixed(0)}）`,
    );
  }
  const off = clipByDiagonalBand(rect, 'diagonal', 0.3, t);
  assert.ok(off);
  assert.deepEqual([off.a.length, off.b.length].sort((x, y) => x - y), [3, 5], '偏离中心应是一侧三角形、一侧五边形');
  assert.equal(clipByDiagonalBand(rect, 'diagonal', 0.0005, t), null, '带被推到角外必须拒绝');
  assert.equal(clipByDiagonalBand(rect, 'diagonal', 0.5, 5000), null, '料厚大于宿主必须拒绝');

  const notch = sampleOutline('notchTop', { x: 0, y: 0, w: 1200, h: 900 }, { inset: 0 });
  const cut = clipByDiagonalBand(notch, 'diagonal', 0.5, 40);
  if (cut) {
    const whole = polygonArea(notch);
    assert.ok(
      Math.abs(polygonArea(cut.a) + polygonArea(cut.muntin) + polygonArea(cut.b) - whole) < 2,
      '凹形宿主上即便切得出也必须面积守恒',
    );
  }
});

test('regionAnchor：全部形状与弧带/弧切子区的标注锚点都落在自身区域内', () => {
  const box = { x: 0, y: 0, w: 1500, h: 1100 };
  for (const shape of FRAME_SHAPE_IDS) {
    const pts = sampleOutline(shape, box, { inset: 60, topRatio: 0.6 });
    assert.ok(pointInPoly(regionAnchor(pts), pts), `${shape}：质心锚点应在区域内`);
  }
  // 弧带（月牙形）：包围盒中心在带外，质心锚点必须仍在带内
  const bandRect: Pt[] = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }];
  const two = clipByArcBand(bandRect, 'vertical', 0.5, 40, 250);
  assert.ok(two);
  const bb = { x: 500, y: 400 };
  assert.ok(!pointInPoly(bb, two.muntin), '月牙带的包围盒中心应在带外（锚点才需要兜底）');
  assert.ok(pointInPoly(regionAnchor(two.muntin), two.muntin), '弧带的质心锚点应在带内');
  assert.ok(regionAnchor(two.a).x < 500 + 1 && regionAnchor(two.b).x > 500 - 1, '左右子区的锚点应各在自己的半边');
});

test('形状分组/标签与 FRAME_SHAPE_IDS 同源不漂移（左栏飞出面板直接消费）', () => {
  const flat = FRAME_SHAPE_GROUPS.flatMap((g) => g.value);
  assert.deepEqual(flat, [...FRAME_SHAPE_IDS], '分组摊平后应与 FRAME_SHAPE_IDS 逐项一致（含顺序）');
  for (const g of FRAME_SHAPE_GROUPS) assert.ok(g.label && g.value.length > 0, '分组不得空标签或空项');
  for (const s of FRAME_SHAPE_IDS) assert.ok(FRAME_SHAPE_LABEL[s], `${s} 缺中文名`);
  for (const s of TRAPEZOID_SHAPES) assert.ok(FRAME_SHAPE_IDS.includes(s), `梯形族 ${s} 不在形状清单内`);
});
