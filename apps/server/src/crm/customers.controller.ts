import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CrmService } from './crm.service';
import type {
  CreateCustomerDto,
  CreateFollowUpDto,
  Customer,
  DesignScheme,
  FollowUp,
  Page,
  UpdateCustomerDto,
} from './crm.types';

/** 方案列表摘要（不含 designData 大字段） */
type SchemeSummary = Omit<DesignScheme, 'designData'>;

/**
 * 客户 REST API
 * GET    /crm/customers                   列表（page/pageSize/status/keyword）
 * POST   /crm/customers                   创建客户（phone 冲突 409）
 * GET    /crm/customers/:id               客户详情
 * PATCH  /crm/customers/:id               更新 / 状态流转
 * DELETE /crm/customers/:id               删除（级联跟进/方案/订单）
 * GET    /crm/customers/:id/follow-ups    跟进时间轴
 * POST   /crm/customers/:id/follow-ups    添加跟进
 * GET    /crm/customers/:id/schemes       方案列表（摘要）
 */
@Controller('crm/customers')
export class CustomersController {
  constructor(private readonly crm: CrmService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ): Promise<Page<Customer>> {
    return this.crm.listCustomers({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      status,
      keyword,
    });
  }

  @Post()
  async create(@Body() dto: CreateCustomerDto): Promise<Customer> {
    return this.crm.createCustomer(dto);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<Customer> {
    return this.crm.getCustomer(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCustomerDto): Promise<Customer> {
    return this.crm.updateCustomer(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: boolean }> {
    return this.crm.removeCustomer(id);
  }

  @Get(':id/follow-ups')
  async followUps(@Param('id') id: string): Promise<FollowUp[]> {
    return this.crm.listFollowUps(id);
  }

  @Post(':id/follow-ups')
  async addFollowUp(@Param('id') id: string, @Body() dto: CreateFollowUpDto): Promise<FollowUp> {
    return this.crm.createFollowUp(id, dto);
  }

  @Get(':id/schemes')
  async schemes(@Param('id') id: string): Promise<SchemeSummary[]> {
    return this.crm.listSchemes(id);
  }
}
