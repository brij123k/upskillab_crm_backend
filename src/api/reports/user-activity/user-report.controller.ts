import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserReportService } from './user-report.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { UserActivityReportQueryDto } from 'src/dto/reports/user-activity-report.dto';

@ApiTags('Reports')
@Controller('reports')
export class UserReportController {
  constructor(private readonly reportService: UserReportService) {}

  @Get('user-activity-summary')
//   @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
//   @Roles('Admin', 'bd')
  @RequirePermission(PERMISSIONS.REPORTS.MODULE, PERMISSIONS.REPORTS.ACTIONS.READ)
  @ApiOperation({ summary: 'Get user activity summary report across leads, calls, orders, and stage changes' })
  async userActivitySummary(@Query() query: UserActivityReportQueryDto) {
    return this.reportService.userActivityReport(query);
  }
}
