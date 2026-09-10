import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { MaterialsService } from './materials.service';
import type {
  AdjustInventoryDto,
  BatchOutboundDto,
  BatchResult,
  InventoryItem,
  InventoryOpDto,
  InventoryQuery,
  InventoryRow,
  InventorySummary,
  InventoryTransaction,
  MaterialCategory,
  Page,
  TransactionQuery,
  TransactionRow,
  TransactionType,
  UpdateInventoryMetaDto,
} from './materials.types';

const flag = (v?: string): boolean => v === '1' || v === 'true' || v === 'yes';
const num = (v?: string): number | undefined => (v == null || v === '' ? undefined : Number(v));

/**
 * 库存 REST API（IInventory + IInventoryTransaction）
 *
 * GET   /inventory                  库存列表（?warehouseId=&category=&onlyWarning=1），含物料 / 仓库名 / 缺料标记
 * GET   /inventory/summary          按仓库汇总 + 缺料条数（?warehouseId=）
 * GET   /inventory/transactions     出入库流水分页（?materialId=&transactionType=&warehouseId=&keyword=&from=&to=&page=&pageSize=）
 * PATCH /inventory                  维护安全库存 / 最高库存 / 锁定量（不产生流水）
 * POST  /inventory/inbound          入库
 * POST  /inventory/outbound         出库（校验可用库存）
 * POST  /inventory/adjust           盘点：currentQty 设为实盘数，流水记差额
 * POST  /inventory/batch-outbound   批量领料出库（恒 200 返回 BatchResult，逐行成败见 results）
 *
 * from / to 按 ISO 字符串比较，按日筛选时前端需补全为 T00:00:00 / T23:59:59.999。
 */
@Controller('inventory')
export class InventoryController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Get()
  list(
    @Query('warehouseId') warehouseId?: string,
    @Query('category') category?: MaterialCategory,
    @Query('onlyWarning') onlyWarning?: string,
  ): InventoryRow[] {
    return this.materialsService.listInventory({ warehouseId, category, onlyWarning: flag(onlyWarning) });
  }

  @Get('summary')
  summary(@Query('warehouseId') warehouseId?: string): InventorySummary {
    return this.materialsService.summarizeInventory(warehouseId);
  }

  @Get('transactions')
  transactions(
    @Query('materialId') materialId?: string,
    @Query('transactionType') transactionType?: TransactionType,
    @Query('warehouseId') warehouseId?: string,
    @Query('keyword') keyword?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Page<TransactionRow> {
    const query: TransactionQuery = {
      materialId,
      transactionType,
      warehouseId,
      keyword,
      from,
      to,
      page: num(page),
      pageSize: num(pageSize),
    };
    return this.materialsService.listTransactionsPaged(query);
  }

  @Patch()
  updateMeta(@Body() dto: UpdateInventoryMetaDto): InventoryItem {
    return this.materialsService.updateInventoryMeta(dto);
  }

  @Post('inbound')
  inbound(@Body() dto: InventoryOpDto): InventoryTransaction {
    return this.materialsService.inbound(dto);
  }

  @Post('outbound')
  outbound(@Body() dto: InventoryOpDto): InventoryTransaction {
    return this.materialsService.outbound(dto);
  }

  @Post('adjust')
  adjust(@Body() dto: AdjustInventoryDto): InventoryTransaction {
    return this.materialsService.adjustInventory(dto);
  }

  @Post('batch-outbound')
  batchOutbound(@Body() dto: BatchOutboundDto): BatchResult {
    return this.materialsService.batchOutbound(dto);
  }
}
