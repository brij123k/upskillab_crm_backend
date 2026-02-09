import {
  Controller,
  Post,
  Patch,
  Get,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MeetingLogLogic } from './meeting-log.logic';
import { CreateMeetingDTO,UpdateMeetingDTO } from 'src/dto/meeting-log.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';

@Controller('meeting-logs')
export class MeetingLogController {
  constructor(private readonly logic: MeetingLogLogic) {}

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin','bd')
  @RequirePermission(
           PERMISSIONS.Meeting.MODULE,
           PERMISSIONS.Meeting.ACTIONS.CREATE,
         )
  create(@Body() dto: CreateMeetingDTO, @Req() req) {
    return this.logic.create(dto, req?.user.userId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin','bd')
  update(@Param('id') id: string, @Body() dto: UpdateMeetingDTO) {
    return this.logic.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin','bd')
  delete(@Param('id') id: string) {
    return this.logic.delete(id);
  }

  @Get('lead/:leadId')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin','bd')
  @RequirePermission(
           PERMISSIONS.Meeting.MODULE,
           PERMISSIONS.Meeting.ACTIONS.READ,
         )
  getByLead(@Param('leadId') leadId: number) {
    return this.logic.getByLeadId(Number(leadId));
  }

  @Get()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin','bd')
    @RequirePermission(
           PERMISSIONS.Meeting.MODULE,
           PERMISSIONS.Meeting.ACTIONS.READ,
         )
  getByUser(@Req() req) {
    return this.logic.getByUser(req.user);
  }

  @Get('with-feedbacks')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin','bd')
    @RequirePermission(
           PERMISSIONS.Meeting.MODULE,
           PERMISSIONS.Meeting.ACTIONS.READ,
         )
  getWithFeedbacks() {
    return this.logic.meetingsWithFeedbacks();
  }
}
