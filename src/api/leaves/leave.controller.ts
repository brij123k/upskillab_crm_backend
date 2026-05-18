import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { LeaveLogic } from './leave.logic';

@ApiTags('Leaves')
@ApiBearerAuth()
@Controller('leaves')
export class LeaveController {
  constructor(private readonly logic: LeaveLogic) {}

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @ApiOperation({ summary: 'Create leave request(s)' })
  create(@Body() dto: any, @Req() req: any) {
    return this.logic.create(dto, req.user.userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @ApiOperation({ summary: 'List leave requests' })
  findAll(@Req() req: any, @Query() query: any) {
    return this.logic.getRequests(req.user.userId, query);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current user leaves' })
  myLeaves(@Req() req: any, @Query() query: any) {
    return this.logic.getMyLeaves(req.user.userId, query);
  }

  @Get('me/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get current user leave by id' })
  myLeaveById(@Req() req: any, @Param('id') id: string) {
    return this.logic.getMyLeaveById(req.user.userId, id);
  }

  @Patch('me/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Update current user leave' })
  updateMine(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    return this.logic.updateMyLeave(id, req.user.userId, dto);
  }

  @Patch('me/:id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cancel current user leave' })
  cancelMine(@Req() req: any, @Param('id') id: string) {
    return this.logic.cancelMyLeave(id, req.user.userId);
  }

  @Get('requests')
  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(PERMISSIONS.LEAVE.MODULE, PERMISSIONS.LEAVE.ACTIONS.APPROVE)
  @ApiOperation({ summary: 'Get leave requests that need approval for current user' })
  requests(@Req() req: any, @Query() query: any) {
    return this.logic.getRequests(req.user.userId, query);
  }

  @Get('requests/:id')
  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(PERMISSIONS.LEAVE.MODULE, PERMISSIONS.LEAVE.ACTIONS.APPROVE)
  @ApiOperation({ summary: 'Get a leave request assigned to current user' })
  requestById(@Req() req: any, @Param('id') id: string) {
    return this.logic.getRequestById(req.user.userId, id);
  }

  @Patch(':id/decision')
  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(PERMISSIONS.LEAVE.MODULE, PERMISSIONS.LEAVE.ACTIONS.APPROVE)
  @ApiOperation({ summary: 'Approve or reject a leave request' })
  decide(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    return this.logic.decideLeave(id, req.user.userId, dto);
  }
}
