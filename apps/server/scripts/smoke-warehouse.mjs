/**
 * 仓库管理后端冒烟测试。
 *
 * 用法：先 `npm run dev:server`，再 `node apps/server/scripts/smoke-warehouse.mjs`
 * 会以 SMOKE- 前缀的物料编码与单据号写入 apps/server/data/materials.json，
 * 每次运行使用不同后缀，可重复执行；失败时进程退出码为 1。
 */
const BASE = process.env.WDD_API ?? 'http://localhost:3000';
const RUN = Date.now().toString(36).toUpperCase();

let failed = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` → ${detail}` : ''}`);
  }
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, message: json && json.message ? json.message : '' };
}

const warehouses = async () => (await call('GET', '/warehouses')).body;

async function main() {
  console.log(`仓库管理冒烟测试 · ${BASE} · 批次 ${RUN}\n`);

  // ---- 1. 仓库主数据 ----
  console.log('[1] 仓库 / 库位主数据');
  const seeded = await warehouses();
  check('默认仓库已种入', seeded.length >= 1 && seeded.some((w) => w.code === 'WH01'), JSON.stringify(seeded).slice(0, 120));
  const wh = seeded.find((w) => w.isDefault) ?? seeded[0];
  const loc = wh.locations[0];

  const created = await call('POST', '/warehouses', { name: `SMOKE 仓 ${RUN}`, locations: [' c-01 ', 'C-01', 'C-02'] });
  check('新建仓库 code 自动生成', created.status === 201 && /^WH\d+$/.test(created.body.code ?? ''), created.message);
  check('库位去空白/大写/去重', JSON.stringify(created.body.locations) === '["C-01","C-02"]', JSON.stringify(created.body.locations));
  const smokeWh = created.body;

  const dupCode = await call('POST', '/warehouses', { code: smokeWh.code, name: '重复编码' });
  check('仓库编码重复被拒', dupCode.status === 400, `${dupCode.status} ${dupCode.message}`);

  const dropLoc = await call('PATCH', `/warehouses/${smokeWh.id}`, { locations: ['C-01'] });
  check('无结存时可删库位', dropLoc.status === 200 && dropLoc.body.locations.length === 1, dropLoc.message);

  // ---- 2. 物料档案 ----
  console.log('\n[2] 物料档案');
  const mat = await call('POST', '/materials', {
    code: `AL-SMOKE-${RUN}`, name: `SMOKE 型材 ${RUN}`, category: 'profile', specModel: 'SMOKE', unit: '米',
  });
  check('新建物料', mat.status === 201 && !!mat.body.id, mat.message);
  const materialId = mat.body.id;

  const glass = await call('POST', '/materials', {
    name: `SMOKE 玻璃 ${RUN}`, category: 'glass', specModel: '5+12A+5', unit: '块',
  });
  check("单位 '块' 可用（BOM 语义）", glass.status === 201 && glass.body.unit === '块', glass.message);

  // ---- 3. 入库 → 出库 → 盘点 ----
  console.log('\n[3] 入库 / 出库 / 盘点');
  const inb = await call('POST', '/inventory/inbound', {
    materialId, warehouseId: wh.id, locationCode: loc, quantity: 100, relatedDocNo: `PO-SMOKE-${RUN}`,
  });
  check('入库 100', inb.status === 201 && inb.body.afterQty === 100, JSON.stringify(inb.body).slice(0, 120));

  const badLoc = await call('POST', '/inventory/inbound', {
    materialId, warehouseId: wh.id, locationCode: 'ZZ-99-99', quantity: 1, relatedDocNo: `PO-SMOKE-BAD-${RUN}`,
  });
  check('库位不属于仓库时被拒', badLoc.status === 400 && /不属于仓库/.test(badLoc.message), `${badLoc.status} ${badLoc.message}`);

  const over = await call('POST', '/inventory/outbound', {
    materialId, warehouseId: wh.id, locationCode: loc, quantity: 999, relatedDocNo: `WO-SMOKE-X-${RUN}`,
  });
  check('超量出库被拒', over.status === 400 && /可用库存不足/.test(over.message), over.message);

  const out = await call('POST', '/inventory/outbound', {
    materialId, warehouseId: wh.id, locationCode: loc, quantity: 30, relatedDocNo: `WO-SMOKE-${RUN}`,
  });
  check('出库 30 → 余 70', out.status === 201 && out.body.afterQty === 70 && out.body.quantity === -30, JSON.stringify(out.body).slice(0, 120));

  const adj = await call('POST', '/inventory/adjust', {
    materialId, warehouseId: wh.id, locationCode: loc, countedQty: 65, relatedDocNo: `IC-SMOKE-${RUN}`,
  });
  check('盘点实盘 65 → 差额 -5', adj.status === 201 && adj.body.afterQty === 65 && adj.body.quantity === -5, JSON.stringify(adj.body).slice(0, 140));

  const adjSame = await call('POST', '/inventory/adjust', {
    materialId, warehouseId: wh.id, locationCode: loc, countedQty: 65, relatedDocNo: `IC-SMOKE-SAME-${RUN}`,
  });
  check('盘点无差异也留痕', adjSame.status === 201 && adjSame.body.quantity === 0 && /无差异/.test(adjSame.body.remark ?? ''), adjSame.message);

  // ---- 4. 流水 ----
  console.log('\n[4] 出入库流水');
  const txAll = await call('GET', `/inventory/transactions?materialId=${materialId}&pageSize=50`);
  const chain = txAll.body.list.slice().reverse().map((t) => `${t.transactionType}:${t.beforeQty}->${t.afterQty}`);
  check('流水链路连续', chain.join(' ') === 'inbound:0->100 outbound:100->70 adjust:70->65 adjust:65->65', chain.join(' '));
  check('流水带仓库名', txAll.body.list.every((t) => !!t.warehouseName), JSON.stringify(txAll.body.list[0]).slice(0, 120));

  const txAdj = await call('GET', `/inventory/transactions?materialId=${materialId}&transactionType=adjust`);
  check('按类型筛选', txAdj.body.total === 2 && txAdj.body.list.every((t) => t.transactionType === 'adjust'), `total=${txAdj.body.total}`);

  const txDoc = await call('GET', `/inventory/transactions?keyword=WO-SMOKE-${RUN}`);
  check('按单据号搜索', txDoc.body.total === 1, `total=${txDoc.body.total}`);

  const txPage = await call('GET', `/inventory/transactions?materialId=${materialId}&page=2&pageSize=2`);
  check('分页', txPage.body.page === 2 && txPage.body.list.length === 2 && txPage.body.total === 4, JSON.stringify({ p: txPage.body.page, n: txPage.body.list.length, t: txPage.body.total }));

  // ---- 5. 预警 / 汇总 ----
  console.log('\n[5] 安全库存预警与汇总');
  const meta = await call('PATCH', '/inventory', {
    materialId, warehouseId: wh.id, locationCode: loc, safetyStock: 80,
  });
  check('维护安全库存 80', meta.status === 200 && meta.body.safetyStock === 80 && meta.body.availableQty === 65, JSON.stringify(meta.body).slice(0, 120));

  const rows = await call('GET', '/inventory');
  const row = rows.body.find((r) => r.materialId === materialId);
  check('缺料标记 warning=true', !!row && row.warning === true, JSON.stringify(row).slice(0, 140));

  const onlyWarn = await call('GET', '/inventory?onlyWarning=1');
  check('只看缺料筛选', onlyWarn.body.length >= 1 && onlyWarn.body.every((r) => r.warning), `n=${onlyWarn.body.length}`);

  const summary = await call('GET', '/inventory/summary');
  check('汇总含缺料条数', summary.body.warningCount >= 1 && summary.body.warehouses.length >= seeded.length, JSON.stringify(summary.body).slice(0, 160));

  const lock = await call('PATCH', '/inventory', {
    materialId, warehouseId: wh.id, locationCode: loc, lockedQty: 999,
  });
  check('锁定量不能超过现有库存', lock.status === 400, `${lock.status} ${lock.message}`);

  // ---- 6. 批量领料出库 ----
  console.log('\n[6] 批量领料出库');
  const doc1 = `WO-SMOKE-B1-${RUN}`;
  const short = await call('POST', '/inventory/batch-outbound', {
    relatedDocNo: doc1,
    lines: [
      { materialId, warehouseId: wh.id, locationCode: loc, quantity: 50 },
      { materialId, warehouseId: wh.id, locationCode: loc, quantity: 30 },
    ],
  });
  check('同库位合计超量 → 整单拒绝', short.status === 201 && short.body.ok === false && short.body.succeeded === 0, JSON.stringify(short.body).slice(0, 200));
  check('失败明细指出不足行', short.body.results[1].ok === false && /可用库存不足：当前 15/.test(short.body.results[1].error ?? ''), short.body.results[1].error);

  const afterReject = await call('GET', `/inventory/transactions?keyword=${doc1}`);
  check('整单拒绝后不留流水', afterReject.body.total === 0, `total=${afterReject.body.total}`);
  const qtyAfterReject = (await call('GET', '/inventory')).body.find((r) => r.materialId === materialId);
  check('整单拒绝后库存未变', qtyAfterReject.currentQty === 65, `currentQty=${qtyAfterReject.currentQty}`);

  const doc2 = `WO-SMOKE-B2-${RUN}`;
  const okBatch = await call('POST', '/inventory/batch-outbound', {
    relatedDocNo: doc2,
    remark: `领料：SMOKE ${RUN}`,
    lines: [
      { materialId, warehouseId: wh.id, locationCode: loc, quantity: 50 },
      { materialId: glass.body.id, warehouseId: wh.id, locationCode: loc, quantity: 0 },
    ],
  });
  check('含非法行时整单仍拒绝', okBatch.body.ok === false && okBatch.body.results[1].ok === false, JSON.stringify(okBatch.body.results[1]).slice(0, 120));

  await call('POST', '/inventory/inbound', {
    materialId: glass.body.id, warehouseId: wh.id, locationCode: loc, quantity: 8, relatedDocNo: `PO-SMOKE-G-${RUN}`,
  });
  const doc3 = `WO-SMOKE-B3-${RUN}`;
  const okBatch2 = await call('POST', '/inventory/batch-outbound', {
    relatedDocNo: doc3,
    remark: `领料：SMOKE ${RUN}`,
    lines: [
      { materialId, warehouseId: wh.id, locationCode: loc, quantity: 50 },
      { materialId: glass.body.id, warehouseId: wh.id, locationCode: loc, quantity: 3 },
    ],
  });
  check('两行齐备 → 整单成功', okBatch2.body.ok === true && okBatch2.body.succeeded === 2, JSON.stringify(okBatch2.body).slice(0, 200));

  const docTx = await call('GET', `/inventory/transactions?keyword=${doc3}`);
  check('同单据号两条流水', docTx.body.total === 2 && docTx.body.list.every((t) => t.transactionType === 'outbound'), `total=${docTx.body.total}`);
  check('流水备注带上领料信息', docTx.body.list.every((t) => (t.remark ?? '').includes('领料：SMOKE')), docTx.body.list[0]?.remark);

  const finalQty = (await call('GET', '/inventory')).body.find((r) => r.materialId === materialId);
  check('库存扣减正确 65-50=15', finalQty.currentQty === 15 && finalQty.availableQty === 15, `currentQty=${finalQty.currentQty}`);

  const dupDoc = await call('POST', '/inventory/batch-outbound', {
    relatedDocNo: doc3,
    lines: [{ materialId, warehouseId: wh.id, locationCode: loc, quantity: 1 }],
  });
  check('单据号重复提交被拒（幂等）', dupDoc.status === 400 && /已提交/.test(dupDoc.message), `${dupDoc.status} ${dupDoc.message}`);

  const partial = await call('POST', '/inventory/batch-outbound', {
    relatedDocNo: `WO-SMOKE-P-${RUN}`,
    allowPartial: true,
    lines: [
      { materialId, warehouseId: wh.id, locationCode: loc, quantity: 5 },
      { materialId, warehouseId: wh.id, locationCode: loc, quantity: 9999 },
    ],
  });
  check('allowPartial 逐行提交', partial.body.ok === false && partial.body.succeeded === 1 && partial.body.failed === 1, JSON.stringify(partial.body).slice(0, 160));

  // ---- 7. 收尾清理 ----
  console.log('\n[7] 清理冒烟数据');
  const delBusy = await call('DELETE', `/warehouses/${wh.id}`);
  check('有结存库存的仓库不可删', delBusy.status === 400 && /结存库存/.test(delBusy.message), `${delBusy.status} ${delBusy.message}`);
  const delWh = await call('DELETE', `/warehouses/${smokeWh.id}`);
  check('删除无结存的冒烟仓库', delWh.status === 200 && delWh.body.deleted === true, delWh.message);
  const delOnly = await call('DELETE', `/warehouses/${wh.id}`);
  check('仅剩一个仓库时不可删', delOnly.status === 400, `${delOnly.status} ${delOnly.message}`);
  await call('DELETE', `/materials/${materialId}`);
  await call('DELETE', `/materials/${glass.body.id}`);
  const left = (await call('GET', '/inventory')).body.filter((r) => r.material && r.material.code.includes('SMOKE'));
  check('软删物料后其库存行不再展示', left.length === 0, `left=${left.length}`);

  console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项失败`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('冒烟测试异常：', err);
  process.exit(1);
});
