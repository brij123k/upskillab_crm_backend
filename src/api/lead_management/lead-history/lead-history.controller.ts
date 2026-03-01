import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LeadHistoryLogic } from './lead-history.logic';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { Roles } from 'src/common/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';

@ApiTags('Lead History')
@ApiBearerAuth()
@Controller('lead-history')
export class LeadHistoryController {
  constructor(private readonly logic: LeadHistoryLogic) {}

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @Get(':leadId')
  getLeadHistory(@Param('leadId') leadId: number) {
    console.log(leadId)
    return this.logic.getHistoryByLead(leadId.toString());
  }

  
}
