import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { MaterialDb, Warehouse } from './materials.types';

/**
 * 物料仓库：默认使用本地 JSON 文件持久化（data/materials.json，重启不丢数据）。
 * 切换到 PostgreSQL + Prisma 时，只需替换本实现（读取/写入相同结构），
 * 不修改 Service / Controller。
 *
 * 注意：persist() 是全量同步写文件，仅适用于**单实例部署**；
 * 多进程/多实例会互相覆盖，届时应换成 Prisma 实现（schema.prisma 已对齐）。
 */
@Injectable()
export class JsonFileMaterialsRepository {
  private readonly filePath: string;
  private db: MaterialDb = { materials: [], inventory: [], costs: [], transactions: [], warehouses: [] };

  constructor() {
    this.filePath = path.resolve(process.cwd(), 'data', 'materials.json');
    this.load();
    this.seedDefaults();
  }

  getDb(): MaterialDb {
    return this.db;
  }

  persist(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.db, null, 2), 'utf-8');
    } catch (err) {
      console.error('保存物料数据失败:', err);
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<MaterialDb>;
      this.db = {
        materials: Array.isArray(raw.materials) ? raw.materials : [],
        inventory: Array.isArray(raw.inventory) ? raw.inventory : [],
        costs: Array.isArray(raw.costs) ? raw.costs : [],
        transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
        warehouses: Array.isArray(raw.warehouses) ? raw.warehouses : [],
      };
    } catch (err) {
      console.error('加载物料数据失败（将使用空库）:', err);
    }
  }

  /** 首次启动种入默认仓库，否则仓库/库位下拉为空，出入库无从下手 */
  private seedDefaults(): void {
    if (this.db.warehouses.some((w) => !w.isDeleted)) return;
    const now = new Date().toISOString();
    const main: Warehouse = {
      id: randomUUID(),
      code: 'WH01',
      name: '主仓库',
      locations: ['A-01-01', 'A-01-02', 'B-01-01'],
      isDefault: true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      createdBy: 'system',
      updatedBy: 'system',
      isDeleted: false,
    };
    this.db.warehouses.push(main);
    this.persist();
  }
}
