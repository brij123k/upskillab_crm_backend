import { Controller, Post, Body, Param, UseGuards, Req, Get, Query, Patch } from '@nestjs/common';
import { LeadScheduleLogic } from './lead-schedule.logic';
import { CreateLeadScheduleDTO } from 'src/dto/lead-management/lead-schedule.dto';
import { LeadScheduleCron } from './lead-schedule.cron';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';

@Controller('lead-schedules')
export class LeadScheduleController {
  constructor(
    private readonly logic: LeadScheduleLogic,
    private readonly leadScheduleCron: LeadScheduleCron,
  ) { }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @Post()
  create(@Body() dto: CreateLeadScheduleDTO, @Req() req: any) {
    return this.logic.create(dto, req.user);
  }

  @Post(':leadId')
  instantReminder(@Param('leadId') leadId: number) {
    return this.leadScheduleCron.handleInstantCall(leadId)
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @Get()
  getSchedules(@Query() query: any,@Req() req: any) {
    return this.logic.getSchedules(query,req.user)

  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @Patch(':scheduleId/complete')
  complete(@Param('scheduleId') scheduleId: string) {

    return this.logic.completeSchedule(scheduleId)

  }
}
