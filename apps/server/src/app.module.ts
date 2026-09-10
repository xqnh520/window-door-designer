import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module';
import { MaterialsModule } from './materials/materials.module';
import { CrmModule } from './crm/crm.module';

@Module({
  imports: [OrdersModule, MaterialsModule, CrmModule],
})
export class AppModule {}