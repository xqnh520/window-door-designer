import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDesign } from '../src/design.js';
import { computeGeometry } from '../src/geometry.js';
import { series60 } from '@wdd/schema';

test('casement design 尺寸链计算', () => {
  const design = createDesign('casement', {
    openingW: 1500,
    openingH: 1500,
    seriesId: 'series-60',
    name: '测试平开窗',
  }, series60);

  const geometry = computeGeometry(design, series60);
  const sizes = geometry.sizes;

  assert.equal(sizes.frameOuterW, 1460);
  assert.equal(sizes.frameOuterH, 1460);
  assert.equal(sizes.frameInnerW, 1340);
  assert.equal(sizes.frameInnerH, 1340);

  const casement = sizes.panels.find((p) => p.windowType === 'casement');
  const fixed = sizes.panels.find((p) => p.windowType === 'fixed');

  assert.ok(casement, '应有平开扇面板');
  assert.equal(casement.panelOpenW, 677);
  assert.equal(casement.panelOpenH, 1340);
  assert.equal(casement.sashW, 573);
  assert.equal(casement.sashH, 1236);
  assert.equal(casement.glassW, 473);
  assert.equal(casement.glassH, 1136);

  assert.ok(fixed, '应有固定面板');
  assert.equal(fixed.glassW, 533);
  assert.equal(fixed.glassH, 1330);

  assert.equal(geometry.mullions.length, 1);
  assert.equal(geometry.mullions[0].orientation, 'vertical');
  assert.equal(geometry.mullions[0].length, 1340);
});

test('sliding design 生成两扇', () => {
  const design = createDesign('sliding', {
    openingW: 2000,
    openingH: 1500,
    seriesId: 'series-108',
    name: '测试推拉窗',
  }, series60);

  const geometry = computeGeometry(design, series60);
  const sliding = geometry.sizes.panels.find((p) => p.windowType === 'sliding');
  assert.ok(sliding);
  assert.equal(sliding.sashCount, 2);
  assert.ok(sliding.sashW > 0 && sliding.sashH > 0);
});