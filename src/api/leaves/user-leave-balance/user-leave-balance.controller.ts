import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';

import { UserLeaveBalanceService } from './user-leave-balance.service';

@ApiTags('User Leave Balance')
@ApiBearerAuth()
@Controller('leave-balances')
export class UserLeaveBalanceController {
  constructor(
    private readonly service: UserLeaveBalanceService,
  ) {}

  /* -------------------------------------------------------------------------- */
  /*                              USER APIs                                     */
  /* -------------------------------------------------------------------------- */

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'My Current Leave Balance',
  })
  myBalance(
    @Req() req: any,
    @Query('year') year?: number,
  ) {
    return this.service.getCurrentBalance(
      req.user.userId,
      year ? Number(year) : undefined,
    );
  }

  @Get('me/summary')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'My Leave Summary',
  })
  mySummary(
    @Req() req: any,
    @Query('year') year?: number,
  ) {
    return this.service.getBalanceSummary(
      req.user.userId,
      year ? Number(year) : undefined,
    );
  }

  @Get('me/history')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'My Leave Balance History',
  })
  myHistory(
    @Req() req: any,
  ) {
    return this.service.getBalanceHistory(
      req.user.userId,
    );
  }

  /* -------------------------------------------------------------------------- */
  /*                             EL ENCASHMENT                                  */
  /* -------------------------------------------------------------------------- */

  @Patch('me/encash')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Encash Earned Leave',
  })
  encashLeave(
    @Req() req: any,
    @Body() body: { days: number },
  ) {
    return this.service.encashEarnedLeave(
      req.user.userId,
      Number(body.days),
    );
  }

  /* -------------------------------------------------------------------------- */
  /*                               ADMIN APIs                                   */
  /* -------------------------------------------------------------------------- */

  @Get()
  @UseGuards(
    JwtAuthGuard,
    RoleGuard,
    PermissionGuard,
  )
  @Roles('Admin')
//   @RequirePermission(
//     PERMISSIONS.LEAVE.MODULE,
//     PERMISSIONS.LEAVE.ACTIONS.VIEW,
//   )
  @ApiOperation({
    summary: 'All Leave Balances',
  })
  getAll(
    @Query() query: any,
  ) {
    return this.service.getAllBalances(query);
  }

  @Get(':userId')
  @UseGuards(
    JwtAuthGuard,
    RoleGuard,
    PermissionGuard,
  )
  @Roles('Admin')
//   @RequirePermission(
//     PERMISSIONS.LEAVE.MODULE,
//     PERMISSIONS.LEAVE.ACTIONS.VIEW,
//   )
  @ApiOperation({
    summary: 'Get User Balance',
  })
  getUserBalance(
    @Param('userId') userId: string,
    @Query('year') year?: number,
  ) {
    return this.service.getCurrentBalance(
      userId,
      year ? Number(year) : undefined,
    );
  }

  /* -------------------------------------------------------------------------- */
  /*                           CRON / MANUAL APIs                               */
  /* -------------------------------------------------------------------------- */

  @Post('cron/monthly')
  @UseGuards(
    JwtAuthGuard,
    RoleGuard,
  )
  @Roles('Admin')
  @ApiOperation({
    summary: 'Run Monthly Leave Credit',
  })
  runMonthlyCron(
    @Body()
    body: {
      year?: number;
      month?: number;
    },
  ) {
    // return this.service.creditMonthlyLeaves(
    //   body.year,
    //   body.month,
    // );
    return this.service.creditMonthlyLeaves(
      2026,
      7,
    );
  }

  @Post('cron/yearly')
  @UseGuards(
    JwtAuthGuard,
    RoleGuard,
  )
  @Roles('Admin')
  @ApiOperation({
    summary: 'Run Year Carry Forward',
  })
  runYearlyCron(
    @Body()
    body: {
      year?: number;
    },
  ) {
    return this.service.carryForwardToNextYear(
      body.year,
    );
  }
}