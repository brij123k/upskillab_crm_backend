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
  Query,
} from '@nestjs/common';
import { MeetingLogLogic } from './meeting-log.logic';
import { CreateMeetingDTO,UpdateMeetingDTO } from 'src/dto/meeting-log.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { PermissionGuard } from 'src/common/guards/permission.guard';

@Controller('meeting-logs')
export class MeetingLogController {
  constructor(private readonly logic: MeetingLogLogic) {}

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('Admin','bd')
  @RequirePermission(
           PERMISSIONS.Meeting.MODULE,
           PERMISSIONS.Meeting.ACTIONS.CREATE,
         )
  create(@Body() dto: CreateMeetingDTO, @Req() req) {
    return this.logic.create(dto, req?.user.userId);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('Admin','bd')
  update(@Param('id') id: string, @Body() dto: UpdateMeetingDTO,@Req() req) {
    return this.logic.update(id, dto,req?.user.userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('Admin','bd')
  delete(@Param('id') id: string) {
    return this.logic.delete(id);
  }

  @Get('lead/:leadId')
  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('Admin','bd')
  @RequirePermission(
           PERMISSIONS.Meeting.MODULE,
           PERMISSIONS.Meeting.ACTIONS.READ,
         )
  getByLead(@Param('leadId') leadId: number) {
    return this.logic.getByLeadId(Number(leadId));
  }

  @Get()
  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('Admin','bd')
    @RequirePermission(
           PERMISSIONS.Meeting.MODULE,
           PERMISSIONS.Meeting.ACTIONS.READ,
         )
  getByUser(@Req() req) {
    return this.logic.getByUser(req.user);
  }

  @Get('with-feedbacks')
  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('Admin','bd')
    @RequirePermission(
           PERMISSIONS.Meeting.MODULE,
           PERMISSIONS.Meeting.ACTIONS.READ,
         )
  getWithFeedbacks(@Query() query: any,@Req() req) {
    return this.logic.getMeetingsByUsers(query,req.user.userId);
  }@Post('feeback')
  @UseGuards(JwtAuthGuard,RoleGuard)
  @Roles('Admin','bd')
  @RequirePermission(
    PERMISSIONS.Meeting.MODULE,
    PERMISSIONS.Meeting.ACTIONS.FEEDBACK
  )
  addfeedback(@Body() dto: any,@Req() req){
    return this.logic.addFeedback(dto,req.user.userId)
  }
}
