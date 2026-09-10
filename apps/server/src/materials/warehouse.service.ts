import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { JsonFileMaterialsRepository } from './materials.repository';
import {
  nextWarehouseCode,
  type CreateWarehouseDto,
  type UpdateWarehouseDto,
  type Warehouse,
} from './materials.types';

const nowIso = () => new Date().toISOString();

/** 库位编码规范化：去空白、转大写、去重（保持输入顺序） */
function normalizeLocations(list?: string[]): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const loc = String(raw ?? '').trim().toUpperCase();
    if (!loc || seen.has(loc)) continue;
    seen.add(loc);
    out.push(loc);
  }
  return out;
}

/**
 * 仓库 / 库位主数据服务：
 * - 仓库档案 CRUD（软删除、编码自动生成、默认仓唯一）
 * - 库位维护（删除前校验该库位无结存，避免库存行变孤儿）
 * - 为出入库提供仓库/库位合法性校验与仓库名回显
 */
@Injectable()
export class WarehouseService {
  constructor(private readonly repo: JsonFileMaterialsRepository) {}

  listWarehouses(): Warehouse[] {
    return this.repo.getDb().warehouses.filter((w) => !w.isDeleted);
  }

  getWarehouse(id: string): Warehouse {
    const w = this.listWarehouses().find((x) => x.id === id);
    if (!w) throw new NotFoundException(`仓库 ${id} 不存在`);
    return w;
  }

  /** 默认仓：优先 isDefault，否则取第一个启用仓（前端弹窗的缺省选项） */
  defaultWarehouse(): Warehouse | undefined {
    const actives = this.listWarehouses().filter((w) => w.status === 'active');
    return actives.find((w) => w.isDefault) ?? actives[0];
  }

  /** 仓库名回显（流水/库存列表用）；查不到时退回原始 id，不抛错 */
  nameOf(warehouseId?: string): string | undefined {
    if (!warehouseId) return undefined;
    const w = this.repo.getDb().warehouses.find((x) => x.id === warehouseId);
    return w ? `${w.code} ${w.name}` : warehouseId;
  }

  /** 出入库前置校验：仓库存在且启用、库位非空且属于该仓库 */
  assertWarehouseLocation(warehouseId: string, locationCode: string): Warehouse {
    const w = this.getWarehouse(warehouseId);
    if (w.status !== 'active') throw new BadRequestException(`仓库 ${w.name} 已停用，不能出入库`);
    const loc = String(locationCode ?? '').trim();
    if (!loc) throw new BadRequestException('库位不能为空');
    if (!w.locations.some((l) => l.toUpperCase() === loc.toUpperCase())) {
      throw new BadRequestException(`库位 ${loc} 不属于仓库 ${w.name}`);
    }
    return w;
  }

  createWarehouse(dto: CreateWarehouseDto): Warehouse {
    const db = this.repo.getDb();
    const now = nowIso();
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('仓库名称必填');
    const alive = db.warehouses.filter((w) => !w.isDeleted);
    const code = (dto.code ?? '').trim().toUpperCase() || nextWarehouseCode(alive.map((w) => w.code));
    if (alive.some((w) => w.code === code)) throw new BadRequestException(`仓库编码 ${code} 已存在`);
    const warehouse: Warehouse = {
      id: randomUUID(),
      code,
      name,
      address: dto.address,
      manager: dto.manager,
      phone: dto.phone,
      locations: normalizeLocations(dto.locations),
      // 第一个仓库强制为默认仓，否则前端没有可用的缺省仓库
      isDefault: alive.length === 0 ? true : !!dto.isDefault,
      status: dto.status ?? 'active',
      remark: dto.remark,
      createdAt: now,
      updatedAt: now,
      createdBy: dto.createdBy ?? 'system',
      updatedBy: dto.createdBy ?? 'system',
      isDeleted: false,
    };
    db.warehouses.push(warehouse);
    if (warehouse.isDefault) this.clearOtherDefaults(warehouse.id);
    this.repo.persist();
    return warehouse;
  }

  updateWarehouse(id: string, dto: UpdateWarehouseDto): Warehouse {
    const db = this.repo.getDb();
    const w = this.getWarehouse(id);
    if (dto.code != null) {
      const code = dto.code.trim().toUpperCase();
      if (!code) throw new BadRequestException('仓库编码不能为空');
      if (db.warehouses.some((x) => !x.isDeleted && x.id !== id && x.code === code)) {
        throw new BadRequestException(`仓库编码 ${code} 已存在`);
      }
      w.code = code;
    }
    if (dto.name != null) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('仓库名称必填');
      w.name = name;
    }
    if (dto.locations) {
      const next = normalizeLocations(dto.locations);
      const removed = w.locations.filter((loc) => !next.includes(loc));
      const busy = removed.filter((loc) =>
        db.inventory.some((i) => i.warehouseId === id && i.locationCode.toUpperCase() === loc && i.currentQty > 0),
      );
      if (busy.length) throw new BadRequestException(`库位 ${busy.join('、')} 仍有结存库存，不能删除`);
      w.locations = next;
    }
    if (dto.address !== undefined) w.address = dto.address;
    if (dto.manager !== undefined) w.manager = dto.manager;
    if (dto.phone !== undefined) w.phone = dto.phone;
    if (dto.remark !== undefined) w.remark = dto.remark;
    if (dto.status !== undefined) w.status = dto.status;
    if (dto.isDefault) {
      w.isDefault = true;
      this.clearOtherDefaults(id);
    }
    w.updatedAt = nowIso();
    w.updatedBy = dto.createdBy ?? w.updatedBy;
    this.repo.persist();
    return w;
  }

  /** 逻辑删除；历史流水不阻断删除（仓库停用属正常业务），只拦结存库存与唯一仓库 */
  removeWarehouse(id: string): { id: string; deleted: boolean } {
    const db = this.repo.getDb();
    const w = this.getWarehouse(id);
    const alive = this.listWarehouses();
    if (alive.length <= 1) throw new BadRequestException('至少保留一个仓库，无法删除');
    if (db.inventory.some((i) => i.warehouseId === id && i.currentQty !== 0)) {
      throw new BadRequestException(`仓库 ${w.name} 仍有结存库存，不能删除`);
    }
    w.isDeleted = true;
    w.updatedAt = nowIso();
    if (w.isDefault) {
      w.isDefault = false;
      const next = alive.find((x) => x.id !== id);
      if (next) next.isDefault = true;
    }
    this.repo.persist();
    return { id, deleted: true };
  }

  private clearOtherDefaults(keepId: string): void {
    this.repo.getDb().warehouses.forEach((w) => {
      if (w.id !== keepId) w.isDefault = false;
    });
  }
}
