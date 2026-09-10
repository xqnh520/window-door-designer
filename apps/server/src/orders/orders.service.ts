import { Injectable } from '@nestjs/common';
import type { CreateOrderDto, Order } from './orders.controller';
import { JsonFileOrderRepository, type OrderRepository } from './orders.repository';

@Injectable()
export class OrdersService {
  private readonly repo: OrderRepository = new JsonFileOrderRepository();

  findAll(): Order[] {
    return this.repo.findAll();
  }

  findById(id: number): Order | undefined {
    return this.repo.findById(id);
  }

  create(dto: CreateOrderDto): Order {
    const order: Order = {
      id: 0,
      customer: dto.customer,
      phone: dto.phone,
      designName: dto.designName,
      designId: dto.designId,
      total: dto.total,
      bom: dto.bom,
      createdAt: new Date().toISOString(),
    };
    return this.repo.create(order);
  }
}
