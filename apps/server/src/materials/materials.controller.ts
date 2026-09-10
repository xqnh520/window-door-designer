import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { MaterialsService } from './materials.service';
import type {
  CreateMaterialDto,
  InventoryTransaction,
  Material,
  MaterialCost,
  UpdateMaterialDto,
  UpsertCostDto,
} from './materials.types';

/**
 * 物料档案 REST API（IMaterial + IMaterialCost + IInventoryTransaction）
 *
 * GET    /materials                   物料列表（?category=&status=&keyword=）
 * GET    /materials/:id                物料详情
 * POST   /materials                    新增物料（code 缺省自动生成）
 * PATCH  /materials/:id                更新物料（含重量/体积）
 * DELETE /materials/:id                软删除
 * GET    /materials/:id/transactions   该物料的出入库流水
 * GET    /materials/:id/cost           采购成本
 * PUT    /materials/:id/cost           新增/更新采购成本
 */
@Controller('materials')
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Get()
  list(@Query('category') category?: string, @Query('status') status?: string, @Query('keyword') keyword?: string): Material[] {
    return this.materialsService.listMaterials({ category, status, keyword });
  }

  @Get(':id')
  get(@Param('id') id: string): Material {
    return this.materialsService.getMaterial(id);
  }

  @Post()
  create(@Body() dto: CreateMaterialDto): Material {
    return this.materialsService.createMaterial(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMaterialDto): Material {
    return this.materialsService.updateMaterial(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string): { id: string; deleted: boolean } {
    return this.materialsService.removeMaterial(id);
  }

  @Get(':id/transactions')
  transactions(@Param('id') id: string): InventoryTransaction[] {
    return this.materialsService.listTransactions(id);
  }

  @Get(':id/cost')
  getCost(@Param('id') id: string): MaterialCost {
    return this.materialsService.getCost(id);
  }

  @Put(':id/cost')
  upsertCost(@Param('id') id: string, @Body() dto: UpsertCostDto): MaterialCost {
    return this.materialsService.upsertCost(id, dto);
  }
}
