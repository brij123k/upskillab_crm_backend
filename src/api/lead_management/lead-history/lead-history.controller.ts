import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LeadHistoryLogic } from './lead-history.logic';

@ApiTags('Lead History')
@ApiBearerAuth()
@Controller('lead-history')
export class LeadHistoryController {
  constructor(private readonly logic: LeadHistoryLogic) {}

  @Get(':leadId')
  getLeadHistory(@Param('leadId') leadId: number) {
    return this.logic.getHistoryByLead(leadId.toString());
  }

  
}
