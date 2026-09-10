import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';

export interface CreateOrderDto {
  customer: string;
  phone?: string;
  designName: string;
  designId: string;
  openingW?: number;
  openingH?: number;
  seriesId?: string;
  total: number;
  bom: unknown[];
}

export interface Order {
  id: number;
  customer: string;
  phone?: string;
  designName: string;
  designId: string;
  openingW?: number;
  openingH?: number;
  seriesId?: string;
  total: number;
  bom: unknown[];
  createdAt: string;
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(): Order[] {
    return this.ordersService.findAll();
  }

  @Get(':id')
  findById(@Param('id', ParseIntPipe) id: number): Order {
    const order = this.ordersService.findById(id);
    if (!order) {
      throw new NotFoundException(`订单 ${id} 不存在`);
    }
    return order;
  }

  @Post()
  create(@Body() dto: CreateOrderDto): Order {
    return this.ordersService.create(dto);
  }
}