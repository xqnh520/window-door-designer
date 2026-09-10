import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sashWidthOf,
  sashHandlePlacement,
  toDesignModel,
  createWindowTree,
  SASH_WIDTH_BONUS_MM,
  HANDLE_H_MM,
  type WindowTree,
} from '../src/window-tree.js';

const CTX = { installGap: 20, name: '把手窗', seriesId: 'series-60', glassId: 'g-5-12a-5' };

function treeWithSash(windowType: string): WindowTree {
  const t = createWindowTree({
    openingW: 1200,
    openingH: 1500,
    seriesId: 'series-60',
    glassId: 'g-5-12a-5',
    frameWidthMm: 60,
    name: '把手窗',
  });
  t.root!.sash = { windowType: windowType as never, hingeSide: 'left', openDirection: 'in', label: 'S1' };
  return t;
}

test('扇料宽：显式参数优先，否则比外框料宽一个加成值', () => {
  assert.equal(sashWidthOf({ frameWidthMm: 60 }), 60 + SASH_WIDTH_BONUS_MM);
  assert.equal(sashWidthOf({ frameWidthMm: 60, sashWidthMm: 88 }), 88);
  assert.ok(sashWidthOf({ frameWidthMm: 60 }) > 60, '缺省必须略宽于框料');
});

test('把手摆放：未配置也自动存在，落在自由边竖料中心线与扇高中点', () => {
  const p = sashHandlePlacement(1000, 1500, 70, undefined, 'left');
  assert.ok(p, '有开启扇就应有把手');
  assert.equal(p.cx, 1000 - 70 / 2, '左合页 → 把手在右侧自由边竖料中心');
  assert.equal(p.cy, 1500 - 750);
  assert.equal(p.offsetMm, 0);
  assert.equal(p.fromBottomMm, 750);
});

test('把手水平偏移可正可负，并按料宽一半夹紧', () => {
  const right = sashHandlePlacement(1000, 1500, 70, { offsetMm: 20 }, 'left');
  const left = sashHandlePlacement(1000, 1500, 70, { offsetMm: -20 }, 'left');
  assert.ok(right && left);
  assert.equal(right.cx - (1000 - 35), 20);
  assert.equal(left.cx - (1000 - 35), -20);
  const over = sashHandlePlacement(1000, 1500, 70, { offsetMm: 999 }, 'left');
  assert.ok(over);
  assert.equal(over.offsetMm, 35, '水平移动范围 = 料宽一半');
});

test('把手垂直移动范围 = 扇料边框长度（本体中心可在整条竖料内）', () => {
  const low = sashHandlePlacement(1000, 1500, 70, { fromBottomMm: 0 }, 'left');
  assert.ok(low);
  assert.equal(low.fromBottomMm, Math.round(HANDLE_H_MM / 2), '下界为本体高一半（取整 mm）');
  const high = sashHandlePlacement(1000, 1500, 70, { fromBottomMm: 99999 }, 'left');
  assert.ok(high);
  assert.equal(high.fromBottomMm, Math.round(1500 - HANDLE_H_MM / 2), '上界为扇高减本体高一半');
});

test('上/下合页（悬窗）把手在横料上，偏移沿水平方向', () => {
  const top = sashHandlePlacement(1000, 1500, 70, { offsetMm: 120, fromBottomMm: 90 }, 'top');
  assert.ok(top);
  assert.equal(top.cx, 500 + 120);
  assert.equal(top.fromBottomMm, 90);
  const right = sashHandlePlacement(1000, 1500, 70, { fromBottomMm: 700 }, 'right');
  assert.ok(right);
  assert.equal(right.cx, 35, '右合页 → 把手在左侧自由边');
  assert.equal(right.cy, 1500 - 700);
});

test('仅显式 show=false 才隐藏把手；标注文案为实际生效值', () => {
  assert.equal(sashHandlePlacement(1000, 1500, 70, { show: false }, 'left'), null);
  const p = sashHandlePlacement(1000, 1500, 70, { offsetMm: -12, fromBottomMm: 700 }, 'left');
  assert.ok(p);
  assert.equal(p.label, '执手 -12 / 距底 700');
  const clamped = sashHandlePlacement(1000, 1500, 70, { offsetMm: 500, fromBottomMm: 700 }, 'left');
  assert.ok(clamped);
  assert.equal(clamped.label, '执手 +35 / 距底 700', '夹紧后标注显示生效值');
});

test('出料：开启扇自动带把手五金行，固定玻璃不带，推拉按两叶 2 件', () => {
  const casement = toDesignModel(treeWithSash('casement'), CTX);
  assert.equal(casement.fittings?.filter((f) => f.type === 'handleHardware').length, 1);
  assert.equal(casement.fittings?.find((f) => f.type === 'handleHardware')?.count, 1);

  const fixed = toDesignModel(treeWithSash('fixed'), CTX);
  assert.ok(!fixed.fittings?.some((f) => f.type === 'handleHardware'), '固定玻璃不应出把手');

  const sliding = toDesignModel(treeWithSash('sliding'), CTX);
  assert.equal(sliding.fittings?.find((f) => f.type === 'handleHardware')?.count, 2);

  const off = treeWithSash('casement');
  off.root!.sash!.handle = { show: false };
  const hidden = toDesignModel(off, CTX);
  assert.ok(!hidden.fittings?.some((f) => f.type === 'handleHardware'), '显式关闭则不出把手');
});
