import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CrmService } from './crm.service';
import type { CreateOrderDto, Order, Page, UpdateOrderDto } from './crm.types';

/**
 * 订单 REST API
 * GET  /crm/orders?customerId=&status=&page=&pageSize=  订单列表
 * POST /crm/orders                                       创建订单（关联方案 + 报价快照）
 * GET    /crm/orders/:id                                 订单详情
 * PATCH  /crm/orders/:id                                 状态流转 / 收款（定金/尾款）
 * DELETE /crm/orders/:id                                 删除订单（误建清理）
 */
@Controller('crm/orders')
export class OrdersController {
  constructor(private readonly crm: CrmService) {}

  @Get()
  async list(
    @Query('customerId') customerId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Page<Order>> {
    return this.crm.listOrders({ customerId, status, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined });
  }

  @Post()
  async create(@Body() dto: CreateOrderDto): Promise<Order> {
    return this.crm.createOrder(dto);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<Order> {
    return this.crm.getOrder(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateOrderDto): Promise<Order> {
    return this.crm.updateOrder(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: boolean }> {
    return this.crm.removeOrder(id);
  }
}
