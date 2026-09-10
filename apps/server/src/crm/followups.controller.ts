import { Controller, Delete, Param } from '@nestjs/common';
import { CrmService } from './crm.service';

/** 跟进记录（独立删除入口） */
@Controller('crm/follow-ups')
export class FollowUpsController {
  constructor(private readonly crm: CrmService) {}

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ id: string; deleted: boolean }> {
    return this.crm.removeFollowUp(id);
  }
}
