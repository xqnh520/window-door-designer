import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { JsonFileMaterialsRepository } from './materials.repository';
import { WarehouseService } from './warehouse.service';
import {
  nextCode,
  type AdjustInventoryDto,
  type BatchLineResult,
  type BatchOutboundDto,
  type BatchResult,
  type CreateMaterialDto,
  type InventoryItem,
  type InventoryOpDto,
  type InventoryQuery,
  type InventoryRow,
  type InventorySummary,
  type InventorySummaryWarehouse,
  type InventoryTransaction,
  type Material,
  type MaterialCost,
  type Page,
  type TransactionQuery,
  type TransactionRow,
  type UpdateInventoryMetaDto,
  type UpdateMaterialDto,
  type UpsertCostDto,
} from './materials.types';

const nowIso = () => new Date().toISOString();

/** 库存复合键（库位统一大写，避免 'a-01' 与 'A-01' 裂成两行） */
const invKey = (i: { materialId: string; warehouseId: string; locationCode: string }): string =>
  `${i.materialId}|${i.warehouseId}|${String(i.locationCode ?? '').trim().toUpperCase()}`;

/** 列表分页辅助（与 crm.service.ts 同构，模块间不互相 import） */
function paginate<T>(list: T[], page = 1, pageSize = 20): Page<T> {
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safeSize = Math.max(1, Math.min(200, Math.floor(pageSize) || 20));
  const start = (safePage - 1) * safeSize;
  return {
    list: list.slice(start, start + safeSize),
    total: list.length,
    page: safePage,
    pageSize: safeSize,
  };
}

/**
 * 物料 / 库存业务服务：
 * - 物料档案 CRUD（软删除、编码自动生成、重量/体积字段）
 * - 采购成本 upsert（IMaterialCost）
 * - 出入库 + 盘点 + 流水（IInventoryTransaction），自动维护 currentQty / lockedQty / availableQty
 * - 批量领料出库（两阶段：先只读校验再写入，默认全成功才落盘）
 * - 缺料预警与按仓库汇总
 */
@Injectable()
export class MaterialsService {
  constructor(
    private readonly repo: JsonFileMaterialsRepository,
    private readonly warehouses: WarehouseService,
  ) {}

  // ---------- 物料档案 ----------

  listMaterials(params: { category?: string; status?: string; keyword?: string }): Material[] {
    return this.repo.getDb().materials.filter((m) => {
      if (m.isDeleted) return false;
      if (params.category && m.category !== params.category) return false;
      if (params.status && m.status !== params.status) return false;
      if (params.keyword) {
        const k = params.keyword.toLowerCase();
        if (!m.name.toLowerCase().includes(k) && !m.code.toLowerCase().includes(k) && !m.specModel.toLowerCase().includes(k)) return false;
      }
      return true;
    });
  }

  getMaterial(id: string): Material {
    const m = this.repo.getDb().materials.find((x) => x.id === id && !x.isDeleted);
    if (!m) throw new NotFoundException(`物料 ${id} 不存在`);
    return m;
  }

  createMaterial(dto: CreateMaterialDto): Material {
    const db = this.repo.getDb();
    const now = nowIso();
    // 编码：未提供时按「分类-规格-序号」自动生成（AL-6063-T5-02 …）
    const code = (dto.code ?? '').trim() || nextCode(dto.category, dto.specModel ?? '', db.materials.map((m) => m.code));
    if (db.materials.some((m) => !m.isDeleted && m.code === code)) {
      throw new BadRequestException(`物料编码 ${code} 已存在`);
    }
    const material: Material = {
      id: randomUUID(),
      code,
      name: dto.name,
      category: dto.category,
      specModel: dto.specModel ?? '',
      color: dto.color ?? '',
      unit: dto.unit,
      brand: dto.brand ?? '',
      description: dto.description,
      barcode: dto.barcode,
      status: dto.status ?? 'active',
      weightKg: dto.weightKg,
      volumeM3: dto.volumeM3,
      createdAt: now,
      updatedAt: now,
      createdBy: dto.createdBy ?? 'system',
      updatedBy: dto.createdBy ?? 'system',
      isDeleted: false,
    };
    db.materials.push(material);
    this.repo.persist();
    return material;
  }

  updateMaterial(id: string, dto: UpdateMaterialDto): Material {
    const db = this.repo.getDb();
    const m = db.materials.find((x) => x.id === id && !x.isDeleted);
    if (!m) throw new NotFoundException(`物料 ${id} 不存在`);
    Object.assign(m, dto, { updatedAt: nowIso(), updatedBy: dto.createdBy ?? m.updatedBy });
    this.repo.persist();
    return m;
  }

  /** 逻辑删除（isDeleted = true） */
  removeMaterial(id: string): { id: string; deleted: boolean } {
    const db = this.repo.getDb();
    const m = db.materials.find((x) => x.id === id && !x.isDeleted);
    if (!m) throw new NotFoundException(`物料 ${id} 不存在`);
    m.isDeleted = true;
    m.updatedAt = nowIso();
    this.repo.persist();
    return { id, deleted: true };
  }

  // ---------- 采购成本（IMaterialCost） ----------

  getCost(materialId: string): MaterialCost {
    const db = this.repo.getDb();
    this.getMaterial(materialId);
    const cost = db.costs.find((c) => c.materialId === materialId);
    if (!cost) throw new NotFoundException(`物料 ${materialId} 尚未维护成本信息`);
    return cost;
  }

  upsertCost(materialId: string, dto: UpsertCostDto): MaterialCost {
    const db = this.repo.getDb();
    this.getMaterial(materialId);
    const existed = db.costs.find((c) => c.materialId === materialId);
    const cost: MaterialCost = existed
      ? Object.assign(existed, dto)
      : { materialId, ...dto, currency: dto.currency ?? 'CNY', leadTimeDays: dto.leadTimeDays ?? 7, moq: dto.moq ?? 1, costType: dto.costType ?? 'variable' };
    if (!existed) db.costs.push(cost);
    this.repo.persist();
    return cost;
  }

  // ---------- 库存查询 / 预警 / 汇总 ----------

  /** 库存列表：附带物料、仓库名与缺料标记；物料已软删的库存行不再展示 */
  listInventory(params: InventoryQuery = {}): InventoryRow[] {
    const db = this.repo.getDb();
    const rows: (InventoryRow & { material: Material })[] = [];
    for (const item of db.inventory) {
      const material = db.materials.find((m) => m.id === item.materialId && !m.isDeleted);
      if (!material) continue;
      if (params.warehouseId && item.warehouseId !== params.warehouseId) continue;
      if (params.category && material.category !== params.category) continue;
      const warning = item.safetyStock > 0 && item.availableQty < item.safetyStock;
      if (params.onlyWarning && !warning) continue;
      rows.push({ ...item, material, warehouseName: this.warehouses.nameOf(item.warehouseId), warning });
    }
    return rows.sort((a, b) =>
      a.warehouseId === b.warehouseId
        ? a.material.code.localeCompare(b.material.code)
        : a.warehouseId.localeCompare(b.warehouseId),
    );
  }

  /** 按仓库汇总 + 全局缺料条数（首页角标用）；尚无库存行的仓库也返回，便于前端展示全量仓库 */
  summarizeInventory(warehouseId?: string): InventorySummary {
    const rows = this.listInventory({ warehouseId });
    const map = new Map<string, InventorySummaryWarehouse>();
    for (const row of rows) {
      let entry = map.get(row.warehouseId);
      if (!entry) {
        entry = {
          warehouseId: row.warehouseId,
          warehouseName: row.warehouseName ?? row.warehouseId,
          skuCount: 0,
          totalQty: 0,
          warningCount: 0,
        };
        map.set(row.warehouseId, entry);
      }
      entry.skuCount += 1;
      entry.totalQty += row.currentQty;
      if (row.warning) entry.warningCount += 1;
    }
    for (const w of this.warehouses.listWarehouses()) {
      if (warehouseId && w.id !== warehouseId) continue;
      if (!map.has(w.id)) {
        map.set(w.id, { warehouseId: w.id, warehouseName: `${w.code} ${w.name}`, skuCount: 0, totalQty: 0, warningCount: 0 });
      }
    }
    const warehouses = [...map.values()];
    return { warningCount: warehouses.reduce((sum, w) => sum + w.warningCount, 0), warehouses };
  }

  /** 库存主数据维护（安全库存 / 上限 / 锁定量），不产生流水 */
  updateInventoryMeta(dto: UpdateInventoryMetaDto): InventoryItem {
    this.getMaterial(dto.materialId);
    this.warehouses.assertWarehouseLocation(dto.warehouseId, dto.locationCode);
    const inv = this.ensureInventory(dto);
    if (dto.safetyStock != null) inv.safetyStock = this.assertQty(dto.safetyStock, '安全库存');
    if (dto.maxStock != null) inv.maxStock = this.assertQty(dto.maxStock, '最高库存');
    if (dto.lockedQty != null) {
      const locked = this.assertQty(dto.lockedQty, '锁定数量');
      if (locked > inv.currentQty) {
        throw new BadRequestException(`锁定数量不能大于现有库存 ${inv.currentQty}`);
      }
      inv.lockedQty = locked;
    }
    inv.availableQty = inv.currentQty - inv.lockedQty;
    this.repo.persist();
    return inv;
  }

  private assertQty(value: number, label: string): number {
    if (!Number.isFinite(value) || value < 0) throw new BadRequestException(`${label}不能为负数`);
    return Math.round(value);
  }

  private findInventory(key: { materialId: string; warehouseId: string; locationCode: string }): InventoryItem | undefined {
    const target = invKey(key);
    return this.repo.getDb().inventory.find((i) => invKey(i) === target);
  }

  private ensureInventory(item: { materialId: string; warehouseId: string; locationCode: string; safetyStock?: number }): InventoryItem {
    const db = this.repo.getDb();
    const locationCode = String(item.locationCode ?? '').trim().toUpperCase();
    let inv = db.inventory.find(
      (i) => i.materialId === item.materialId && i.warehouseId === item.warehouseId && i.locationCode === locationCode,
    );
    if (!inv) {
      inv = {
        materialId: item.materialId,
        warehouseId: item.warehouseId,
        locationCode,
        currentQty: 0,
        lockedQty: 0,
        availableQty: 0,
        safetyStock: item.safetyStock ?? 0,
      };
      db.inventory.push(inv);
    } else if (item.safetyStock != null) {
      inv.safetyStock = item.safetyStock;
    }
    return inv;
  }

  private appendTransaction(tx: Omit<InventoryTransaction, 'id' | 'createdAt' | 'updatedAt' | 'isDeleted'>): InventoryTransaction {
    const db = this.repo.getDb();
    const now = nowIso();
    const record: InventoryTransaction = { ...tx, id: randomUUID(), createdAt: now, updatedAt: now, isDeleted: false };
    db.transactions.push(record);
    return record;
  }

  // ---------- 出入库 / 盘点 ----------

  /** 入库：增加库存 + 记录流水（盘点请用 adjustInventory，语义是「设为实盘数」） */
  inbound(dto: InventoryOpDto): InventoryTransaction {
    this.getMaterial(dto.materialId);
    this.warehouses.assertWarehouseLocation(dto.warehouseId, dto.locationCode);
    if (!Number.isFinite(dto.quantity) || dto.quantity <= 0) {
      throw new BadRequestException('入库数量必须大于 0');
    }
    const inv = this.ensureInventory(dto);
    const beforeQty = inv.currentQty;
    inv.currentQty += dto.quantity;
    inv.availableQty = inv.currentQty - inv.lockedQty;
    inv.lastInboundTime = nowIso();
    const tx = this.appendTransaction({
      transactionType: 'inbound',
      materialId: dto.materialId,
      warehouseId: dto.warehouseId,
      locationCode: inv.locationCode,
      quantity: dto.quantity,
      beforeQty,
      afterQty: inv.currentQty,
      relatedDocNo: dto.relatedDocNo ?? '',
      operatorId: dto.operatorId ?? 'system',
      operateTime: nowIso(),
      remark: dto.remark ?? '入库',
    });
    this.repo.persist();
    return tx;
  }

  /** 出库：校验可用库存充足后扣减 + 记录流水 */
  outbound(dto: InventoryOpDto): InventoryTransaction {
    this.getMaterial(dto.materialId);
    this.warehouses.assertWarehouseLocation(dto.warehouseId, dto.locationCode);
    if (!Number.isFinite(dto.quantity) || dto.quantity <= 0) {
      throw new BadRequestException('出库数量必须大于 0');
    }
    return this.applyOutbound(dto, true);
  }

  /**
   * 出库写入本体。persist=false 供批量领料在循环内调用、结束统一落盘；
   * 单据号/操作人/备注可由批量单据统一覆盖。
   */
  private applyOutbound(
    dto: InventoryOpDto,
    persist: boolean,
    override?: { relatedDocNo?: string; operatorId?: string; remark?: string },
  ): InventoryTransaction {
    const inv = this.ensureInventory(dto);
    if (inv.availableQty < dto.quantity) {
      throw new BadRequestException(`可用库存不足：当前 ${inv.availableQty}，需要 ${dto.quantity}`);
    }
    const beforeQty = inv.currentQty;
    inv.currentQty -= dto.quantity;
    inv.availableQty = inv.currentQty - inv.lockedQty;
    inv.lastOutboundTime = nowIso();
    const tx = this.appendTransaction({
      transactionType: 'outbound',
      materialId: dto.materialId,
      warehouseId: dto.warehouseId,
      locationCode: inv.locationCode,
      quantity: -dto.quantity,
      beforeQty,
      afterQty: inv.currentQty,
      relatedDocNo: override?.relatedDocNo ?? dto.relatedDocNo ?? '',
      operatorId: override?.operatorId ?? dto.operatorId ?? 'system',
      operateTime: nowIso(),
      remark: override?.remark ?? dto.remark ?? '出库',
    });
    if (persist) this.repo.persist();
    return tx;
  }

  /** 盘点：把 currentQty 设为实盘数，流水记「实盘 - 账面」差额（无差异也留痕） */
  adjustInventory(dto: AdjustInventoryDto): InventoryTransaction {
    this.getMaterial(dto.materialId);
    this.warehouses.assertWarehouseLocation(dto.warehouseId, dto.locationCode);
    if (!Number.isFinite(dto.countedQty) || dto.countedQty < 0) {
      throw new BadRequestException('实盘数量不能为负数');
    }
    const countedQty = Math.round(dto.countedQty);
    const inv = this.ensureInventory(dto);
    if (countedQty < inv.lockedQty) {
      throw new BadRequestException(`实盘数量不能小于锁定数量 ${inv.lockedQty}`);
    }
    const beforeQty = inv.currentQty;
    const delta = countedQty - beforeQty;
    inv.currentQty = countedQty;
    inv.availableQty = inv.currentQty - inv.lockedQty;
    const tx = this.appendTransaction({
      transactionType: 'adjust',
      materialId: dto.materialId,
      warehouseId: dto.warehouseId,
      locationCode: inv.locationCode,
      quantity: delta,
      beforeQty,
      afterQty: inv.currentQty,
      relatedDocNo: dto.relatedDocNo ?? '',
      operatorId: dto.operatorId ?? 'system',
      operateTime: nowIso(),
      remark: dto.remark ?? (delta === 0 ? '盘点无差异' : `盘点调整 ${delta > 0 ? '+' : ''}${delta}`),
    });
    this.repo.persist();
    return tx;
  }

  /**
   * 批量领料出库（一张单据多行明细）。
   * 两阶段：阶段一只读校验（同库位多行按合计需求量判断），阶段二才写入。
   * 默认 all-or-nothing：任一行不通过就整体不写，端点仍返回 200 + BatchResult，
   * 由前端把 results[].error 渲染成明细表（「哪几行不足」是业务数据，不是 HTTP 错误）。
   * allowPartial=true 时逐行提交、失败行跳过（导入/运维场景）。
   */
  batchOutbound(dto: BatchOutboundDto): BatchResult {
    const db = this.repo.getDb();
    const lines = Array.isArray(dto.lines) ? dto.lines : [];
    if (!lines.length) throw new BadRequestException('领料明细不能为空');
    const docNo = (dto.relatedDocNo ?? '').trim();
    if (!docNo) throw new BadRequestException('单据号不能为空');
    if (db.transactions.some((t) => !t.isDeleted && t.relatedDocNo === docNo)) {
      throw new BadRequestException(`单据号 ${docNo} 已提交，请勿重复领料`);
    }

    // ---- 阶段一：只读校验 ----
    const demand = new Map<string, number>();
    const results: BatchLineResult[] = lines.map((line, index) => {
      const material = db.materials.find((m) => m.id === line.materialId && !m.isDeleted);
      const base = { index, materialId: line.materialId, code: material?.code ?? '', name: material?.name ?? '未知物料' };
      const fail = (error: string): BatchLineResult => ({ ...base, ok: false, error });
      if (!material) return fail(`物料 ${line.materialId} 不存在`);
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) return fail('出库数量必须大于 0');
      try {
        this.warehouses.assertWarehouseLocation(line.warehouseId, line.locationCode);
      } catch (err) {
        return fail((err as Error).message);
      }
      const key = invKey(line);
      const already = demand.get(key) ?? 0;
      const available = (this.findInventory(line)?.availableQty ?? 0) - already;
      if (available < line.quantity) {
        return fail(`可用库存不足：当前 ${available}，需要 ${line.quantity}`);
      }
      demand.set(key, already + line.quantity);
      return { ...base, ok: true };
    });

    const failedCount = results.filter((r) => !r.ok).length;
    if (failedCount > 0 && !dto.allowPartial) {
      return { ok: false, total: lines.length, succeeded: 0, failed: failedCount, relatedDocNo: docNo, results };
    }

    // ---- 阶段二：写入（批量只在末尾 persist 一次） ----
    const inventoryCount = db.inventory.length;
    const transactionCount = db.transactions.length;
    const snapshot = new Map<string, InventoryItem>();
    try {
      for (const row of results) {
        if (!row.ok) continue;
        const line = lines[row.index];
        const key = invKey(line);
        if (!snapshot.has(key)) {
          const inv = this.ensureInventory(line);
          snapshot.set(key, { ...inv });
        }
        try {
          row.transaction = this.applyOutbound(line, false, {
            relatedDocNo: docNo,
            operatorId: dto.operatorId,
            remark: dto.remark,
          });
        } catch (err) {
          if (!dto.allowPartial) throw err;
          row.ok = false;
          row.error = (err as Error).message;
          delete row.transaction;
        }
      }
    } catch (err) {
      // 内存回滚：截断本次新增的库存行/流水，并还原被改动行的数量快照；不落盘
      db.inventory.splice(inventoryCount);
      db.transactions.splice(transactionCount);
      snapshot.forEach((before, key) => {
        const inv = db.inventory.find((i) => invKey(i) === key);
        if (inv) Object.assign(inv, before);
      });
      throw new BadRequestException(`领料失败，已回滚：${(err as Error).message}`);
    }

    this.repo.persist();
    const succeeded = results.filter((r) => okWithTx(r)).length;
    return {
      ok: succeeded === lines.length,
      total: lines.length,
      succeeded,
      failed: lines.length - succeeded,
      relatedDocNo: docNo,
      results,
    };
  }

  // ---------- 流水 ----------

  listTransactions(materialId?: string): InventoryTransaction[] {
    return this.repo
      .getDb()
      .transactions.filter((t) => !t.isDeleted && (!materialId || t.materialId === materialId))
      .sort((a, b) => (a.operateTime < b.operateTime ? 1 : -1));
  }

  /**
   * 全局流水分页查询（附物料与仓库名）。
   * from / to 按 ISO 字符串比较，前端传「按日」时应补全为 T00:00:00 / T23:59:59.999。
   */
  listTransactionsPaged(query: TransactionQuery = {}): Page<TransactionRow> {
    const db = this.repo.getDb();
    const kw = (query.keyword ?? '').trim().toLowerCase();
    const list: TransactionRow[] = db.transactions
      .filter((t) => !t.isDeleted)
      .filter((t) => !query.materialId || t.materialId === query.materialId)
      .filter((t) => !query.transactionType || t.transactionType === query.transactionType)
      .filter((t) => !query.warehouseId || t.warehouseId === query.warehouseId)
      .filter((t) => !query.from || t.operateTime >= query.from)
      .filter((t) => !query.to || t.operateTime <= query.to)
      .filter(
        (t) =>
          !kw ||
          (t.relatedDocNo ?? '').toLowerCase().includes(kw) ||
          (t.remark ?? '').toLowerCase().includes(kw),
      )
      .sort((a, b) => (a.operateTime < b.operateTime ? 1 : -1))
      .map((t) => ({
        ...t,
        material: db.materials.find((m) => m.id === t.materialId && !m.isDeleted),
        warehouseName: this.warehouses.nameOf(t.warehouseId),
      }));
    return paginate(list, query.page, query.pageSize);
  }
}

function okWithTx(row: BatchLineResult): boolean {
  return row.ok && !!row.transaction;
}
