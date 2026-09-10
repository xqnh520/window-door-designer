import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { CrmDb } from './crm.types';
import type { CrmRepository } from './crm.repository.interface';

/**
 * CRM 仓库：默认本地 JSON 文件持久化（data/crm.json）。
 * 切换 PostgreSQL + Prisma 时，仅需替换本实现（读写相同结构），
 * 不修改 Service / Controller。
 */
@Injectable()
export class JsonFileCrmRepository implements CrmRepository {
  private readonly filePath: string;
  private db: CrmDb = { customers: [], followUps: [], schemes: [], orders: [] };

  constructor() {
    this.filePath = path.resolve(process.cwd(), 'data', 'crm.json');
    this.load();
  }

  async getDb(): Promise<CrmDb> {
    return this.db;
  }

  async persist(): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.db, null, 2), 'utf-8');
    } catch (err) {
      console.error('保存 CRM 数据失败:', err);
    }
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<CrmDb>;
      this.db = {
        customers: Array.isArray(raw.customers) ? raw.customers : [],
        followUps: Array.isArray(raw.followUps) ? raw.followUps : [],
        schemes: Array.isArray(raw.schemes) ? raw.schemes : [],
        orders: Array.isArray(raw.orders) ? raw.orders : [],
      };
    } catch (err) {
      console.error('加载 CRM 数据失败（将使用空库）:', err);
    }
  }
}
