import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { LeadStatsService } from './leadStats.service';

@ApiTags('Lead Stats')
@ApiBearerAuth('JWT')
@Controller('lead-stats')
export class LeadStatsController {
  constructor(
    private readonly leadStatsService: LeadStatsService,
  ) {}

  @UseGuards(
    JwtAuthGuard,
    RoleGuard,
    PermissionGuard,
  )
  @Roles('Admin', 'bd')
  @RequirePermission(
    PERMISSIONS.LEAD.MODULE,
    PERMISSIONS.LEAD.ACTIONS.READ,
  )
  @Get()
  @ApiOperation({
    summary: 'Lead Statistics Dashboard',
  })
  getLeadStats(
    @Query() query: any,
    @Req() req: any,
  ) {
    return this.leadStatsService.getLeadStats(
      query,
      req.user,
    );
  }
}