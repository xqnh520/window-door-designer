import type { CrmDb } from './crm.types';

/**
 * CRM 仓库抽象：JsonFileCrmRepository（本地 JSON）与 PrismaCrmRepository（PostgreSQL）
 * 同一接口，Service/Controller 无需感知存储层差异。
 */
export interface CrmRepository {
  getDb(): Promise<CrmDb>;
  persist(): Promise<void>;
}
