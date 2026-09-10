import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import type { CreateWarehouseDto, UpdateWarehouseDto, Warehouse } from './materials.types';

/**
 * 仓库 / 库位主数据 REST API（IWarehouse）
 *
 * GET    /warehouses        仓库列表（含库位编码）
 * GET    /warehouses/:id     仓库详情
 * POST   /warehouses         新建（code 缺省自动生成 WH01…；首个仓库强制为默认仓）
 * PATCH  /warehouses/:id     更新（删库位前校验该库位无结存）
 * DELETE /warehouses/:id     软删除（有结存库存或为唯一仓库时拒绝）
 */
@Controller('warehouses')
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get()
  list(): Warehouse[] {
    return this.warehouseService.listWarehouses();
  }

  @Get(':id')
  get(@Param('id') id: string): Warehouse {
    return this.warehouseService.getWarehouse(id);
  }

  @Post()
  create(@Body() dto: CreateWarehouseDto): Warehouse {
    return this.warehouseService.createWarehouse(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWarehouseDto): Warehouse {
    return this.warehouseService.updateWarehouse(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string): { id: string; deleted: boolean } {
    return this.warehouseService.removeWarehouse(id);
  }
}
