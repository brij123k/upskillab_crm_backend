import { Controller, Post, Body } from '@nestjs/common';
import { LeadScheduleLogic } from './lead-schedule.logic';
import { CreateLeadScheduleDTO } from 'src/dto/lead-management/lead-schedule.dto';

@Controller('lead-schedules')
export class LeadScheduleController {
  constructor(
    private readonly logic: LeadScheduleLogic,
  ) {}

  @Post()
  create(@Body() dto: CreateLeadScheduleDTO) {
    return this.logic.create(dto);
  }

  // @Get(':leadId')
  // getScheduler()
}
