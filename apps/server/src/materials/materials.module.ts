import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { MaterialsController } from './materials.controller';
import { JsonFileMaterialsRepository } from './materials.repository';
import { MaterialsService } from './materials.service';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';

@Module({
  controllers: [MaterialsController, InventoryController, WarehouseController],
  providers: [MaterialsService, WarehouseService, JsonFileMaterialsRepository],
})
export class MaterialsModule {}
