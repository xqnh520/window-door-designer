import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { FollowUpsController } from './followups.controller';
import { SchemesController } from './schemes.controller';
import { OrdersController } from './orders.controller';
import { PrismaCrmRepository } from './prisma.crm.repository';
import { CrmService } from './crm.service';

@Module({
  controllers: [CustomersController, FollowUpsController, SchemesController, OrdersController],
  providers: [CrmService, PrismaCrmRepository],
})
export class CrmModule {}
