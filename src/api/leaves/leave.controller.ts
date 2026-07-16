import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { LeaveLogic } from './leave.logic';
import { CreateLeavePolicyDto, UpdateLeavePolicyDto } from 'src/dto/leave-policy.dto';
import { CreateLeaveDto } from 'src/dto/create-leave.dto';
import { LeaveDecisionDto } from 'src/dto/leave-decision.dto';
import { CancelLeaveDto } from 'src/dto/cancel-leave.dto';

@ApiTags('Leaves')
@ApiBearerAuth()
@Controller('leaves')
export class LeaveController {
  constructor(private readonly logic: LeaveLogic) {}

@Post()
@UseGuards(JwtAuthGuard)
@ApiOperation({
  summary: 'Apply Leave',
})
create(
  @Req() req: any,
  @Body() dto: CreateLeaveDto,
) {
  return this.logic.createLeave(
    dto,
    req.user.userId,
  );
}

  @Get()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @ApiOperation({ summary: 'List leave requests' })
  findAll(@Req() req: any, @Query() query: any) {
    return this.logic.getRequests(req.user.userId, query);
  }

   /* -------------------------------------------------------------------------- */
  /*                               LEAVE POLICY                                 */
  /* -------------------------------------------------------------------------- */

  @Post('policies')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @ApiOperation({
    summary: 'Create Leave Policy',
  })
  createPolicy(
    @Body()
    dto: CreateLeavePolicyDto,
  ) {
    return this.logic.createPolicy(dto);
  }

  @Get('policies')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get All Leave Policies',
  })
  getPolicies(
    @Query() query: any,
  ) {
    return this.logic.getPolicies(query);
  }

  @Get('policies/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get Leave Policy By Id',
  })
  getPolicyById(
    @Param('id')
    id: string,
  ) {
    return this.logic.getPolicyById(id);
  }

  @Get('policies/role/:roleId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get Leave Policy By Role & Year',
  })
  getPolicyByRole(
    @Param('roleId')
    roleId: string,

    @Query('year')
    year: number,
  ) {
    return this.logic.getPolicyByRole(
      roleId,
      Number(year),
    );
  }

  @Patch('policies/:id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @ApiOperation({
    summary: 'Update Leave Policy',
  })
  updatePolicy(
    @Param('id')
    id: string,

    @Body()
    dto: UpdateLeavePolicyDto,
  ) {
    return this.logic.updatePolicy(
      id,
      dto,
    );
  }

  @Delete('policies/:id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin')
  @ApiOperation({
    summary: 'Delete Leave Policy',
  })
  deletePolicy(
    @Param('id')
    id: string,
  ) {
    return this.logic.deletePolicy(id);
  }

@Patch(':id/decision')
@UseGuards(
  JwtAuthGuard,
  RoleGuard,
  PermissionGuard,
)
@Roles('Admin', 'bd')
@RequirePermission(
  PERMISSIONS.LEAVE.MODULE,
  PERMISSIONS.LEAVE.ACTIONS.APPROVE,
)
@ApiOperation({
  summary: 'Approve / Reject Leave',
})
decision(
  @Param('id')
  id: string,

  @Req()
  req: any,

  @Body()
  dto: LeaveDecisionDto,
) {
  return this.logic.decideLeave(
    id,
    req.user.userId,
    dto,
  );
}
@Patch('me/:id/cancel')
@UseGuards(JwtAuthGuard)
@ApiOperation({
  summary: 'Cancel My Leave',
})
cancelLeave(
  @Req() req: any,

  @Param('id')
  id: string,

  @Body()
  dto: CancelLeaveDto,
) {
  return this.logic.cancelLeave(
    id,
    req.user.userId,
    dto,
  );
}

@Get('me')
@UseGuards(JwtAuthGuard)
@ApiOperation({
  summary: 'Get My Leave Requests',
})
myLeaves(
  @Req() req: any,
  @Query() query: any,
) {
  return this.logic.getMyLeaves(
    req.user.userId,
    query,
  );
}

@Get('requests')
@UseGuards(
  JwtAuthGuard,
  RoleGuard,
  PermissionGuard,
)
@Roles('Admin', 'bd')
@RequirePermission(
  PERMISSIONS.LEAVE.MODULE,
  PERMISSIONS.LEAVE.ACTIONS.APPROVE,
)
@ApiOperation({
  summary: 'Get Leave Requests For Approval',
})
getRequests(
  @Req() req: any,
  @Query() query: any,
) {
  return this.logic.getLeaveRequests(
    req.user.userId,
    query,
  );
}
@Get('requests/:id')
@UseGuards(
  JwtAuthGuard,
  RoleGuard,
  PermissionGuard,
)
@Roles('Admin', 'bd')
@RequirePermission(
  PERMISSIONS.LEAVE.MODULE,
  PERMISSIONS.LEAVE.ACTIONS.APPROVE,
)
@ApiOperation({
  summary: 'Get Leave Request By Id',
})
getRequestById(
  @Req() req: any,

  @Param('id')
  id: string,
) {
  return this.logic.getLeaveRequestById(
    req.user.userId,
    id,
  );
}
}
