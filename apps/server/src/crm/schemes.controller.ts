import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { CrmService } from './crm.service';
import type { CreateSchemeDto, DesignScheme, UpdateSchemeDto } from './crm.types';

/**
 * 设计方案（Konva）REST API
 * POST /crm/schemes        新建方案（保存画布 designData + colorConfig）
 * GET  /crm/schemes/:id    方案详情（完整 designData，用于画布回显）
 * PUT  /crm/schemes/:id    保存新版本（整体覆盖 designData/colorConfig）
 * DELETE /crm/schemes/:id  删除方案
 */
@Controller('crm/schemes')
export class SchemesController {
  constructor(private readonly crm: CrmService) {}

  @Post()
  async create(@Body() dto: CreateSchemeDto): Promise<DesignScheme> {
    return this.crm.createScheme(dto);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<DesignScheme> {
    return this.crm.getScheme(id);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSchemeDto): Promise<DesignScheme> {
    return this.crm.updateScheme(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: boolean }> {
    return this.crm.removeScheme(id);
  }
}
