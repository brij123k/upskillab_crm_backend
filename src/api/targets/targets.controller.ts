import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { TargetsLogic } from './targets.logic';

@ApiTags('Targets')
@ApiBearerAuth()
@Controller('targets')
export class TargetsController {
  constructor(private readonly logic: TargetsLogic) {}

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(PERMISSIONS.TARGETS.MODULE, PERMISSIONS.TARGETS.ACTIONS.READ)
  @Get('report')
  @ApiOperation({ summary: 'Get monthly target report for all users' })
  report(@Query('month') month?: string) {
    return this.logic.report(month);
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(PERMISSIONS.TARGETS.MODULE, PERMISSIONS.TARGETS.ACTIONS.READ)
  @Get('revenue-report')
  @ApiOperation({ summary: 'Get revenue target comparison report for all users' })
  revenueReport(
    @Query('months') months?: string | string[],
    @Query('month') month?: string,
  ) {
    return this.logic.revenueReport(months, month);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  @ApiOperation({ summary: 'Get current user monthly target summary' })
  me(@Req() req: any, @Query('month') month?: string, @Query('metric') metric?: any) {
    return this.logic.myTarget(req.user.userId, month, metric);
  }

  @UseGuards(JwtAuthGuard)
  @Get('compare/me')
  @ApiOperation({ summary: 'Get current user target comparison chart data' })
  compareMe(@Req() req: any, @Query('month') month?: string, @Query('metric') metric?: any) {
    return this.logic.myTarget(req.user.userId, month, metric);
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(PERMISSIONS.TARGETS.MODULE, PERMISSIONS.TARGETS.ACTIONS.READ)
  @Get('user/:userId')
  @ApiOperation({ summary: 'Get target summary for a specific user' })
  getByUser(@Param('userId') userId: string, @Query('month') month?: string, @Query('metric') metric?: any) {
    return this.logic.myTarget(userId, month, metric);
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(PERMISSIONS.TARGETS.MODULE, PERMISSIONS.TARGETS.ACTIONS.CREATE)
  @Post()
  @ApiOperation({ summary: 'Create or update a monthly target for one user' })
  upsert(@Body() body: any, @Req() req: any) {
    return this.logic.upsertTarget(body, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(PERMISSIONS.TARGETS.MODULE, PERMISSIONS.TARGETS.ACTIONS.CREATE)
  @Post('bulk')
  @ApiOperation({ summary: 'Create or update monthly targets for many users' })
  bulk(@Body() body: any, @Req() req: any) {
    return this.logic.bulkUpsert(body, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(PERMISSIONS.TARGETS.MODULE, PERMISSIONS.TARGETS.ACTIONS.COPY)
  @Post('copy')
  @ApiOperation({ summary: 'Copy targets from one month to another' })
  copy(@Body() body: any, @Req() req: any) {
    return this.logic.copyMonth(body, req.user.userId);
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(PERMISSIONS.TARGETS.MODULE, PERMISSIONS.TARGETS.ACTIONS.UPDATE)
  @Patch(':id')
  @ApiOperation({ summary: 'Update a target row' })
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.logic.update(id, body, req.user.userId);
  }
}
