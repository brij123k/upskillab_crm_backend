import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Delete,
  UseGuards,
  Req,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateCallLogDto } from 'src/dto/call-log/create-call-log.dto';
import { CallLogLogic } from './call-log.logic';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RoleGuard } from 'src/common/guards/role.guard';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { PermissionGuard } from 'src/common/guards/permission.guard';

@ApiTags('Call Logs')
@Controller('call-logs')
export class CallLogController {
  constructor(private readonly logic: CallLogLogic) {}

  @Post()
  @ApiOperation({ summary: 'Create call log (web & mobile)' })
    @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
   @Roles('Admin','bd')
    @RequirePermission(
         PERMISSIONS.Calls.MODULE,
         PERMISSIONS.Calls.ACTIONS.CREATE,
       )
  create(
    @Body() dto: any,
    @CurrentUser() user: any,
  ) {
    return this.logic.create(dto, user.userId);
  }

  @Get('lead/:leadId')
  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
   @Roles('Admin','bd')
   @RequirePermission(
         PERMISSIONS.Calls.MODULE,
         PERMISSIONS.Calls.ACTIONS.READ,
       )
  @ApiOperation({ summary: 'Get call logs by leadId' })
  getByLead(@Param('leadId') leadId: number) {
    return this.logic.getByLead(Number(leadId));
  }

  @Get()
   @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
   @Roles('bd','Admin')
   @RequirePermission(
         PERMISSIONS.Calls.MODULE,
         PERMISSIONS.Calls.ACTIONS.READ,
       )
  @ApiOperation({ summary: 'Get call logs by userId' })
  getByUser(
  @Param() params: any, @Req() req: any) {
    return this.logic.getByUser(params,req?.user.userId);
  }

  @Get('users')
  @UseGuards(JwtAuthGuard, RoleGuard,PermissionGuard)
  @Roles('bd','Admin')
  @ApiOperation({ summary: 'Get call logs by userId' })
  @RequirePermission(
         PERMISSIONS.Calls.MODULE,
         PERMISSIONS.Calls.ACTIONS.READ,
       )
  getByUsers(
  @Query() query: any, @Req() req: any) {
    return this.logic.getByUsers(query,req?.user.userId);
  }

  @Get('callLogReview/:callLogId')
@ApiOperation({ summary: "Get call Log review by call Log Id" })
async getreviewbycallId(
  @Param('callLogId') callLogId: string
): Promise<any> {
  return this.logic.getreviewbycallId(callLogId);
}

  @Patch(':id')
  @ApiOperation({ summary: 'Update call log' })
  update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateCallLogDto>,
    @CurrentUser() user: any,
  ) {
    return this.logic.update(id, dto, user.userId);
  }

  @Get('report/employee-pool-daily-utilization')
  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(
    PERMISSIONS.Calls.MODULE,
    PERMISSIONS.Calls.ACTIONS.READ,
  )
  @ApiOperation({ summary: 'Get daily pool-wise employee utilization report with call logs, leads, and conversion metrics' })
  employeePoolDailyUtilizationReport(@Query() query: any) {
    return this.logic.employeePoolDailyUtilizationReport(query);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete call log' })
  delete(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.logic.delete(id, user.userId);
  }
}
