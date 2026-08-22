import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CreateAttendanceDto } from 'src/dto/attendance/create-attendance.dto';
import { UpdateAttendanceDto } from 'src/dto/attendance/update-attendance.dto';
import { AttendanceLogic } from './attendance.logic';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { ChangeAttendanceStatusDto } from 'src/dto/attendance/change-attendance-status.dto';

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly logic: AttendanceLogic) {}

  @Post()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @ApiOperation({ summary: 'Create an attendance record manually' })
  create(@Body() dto: CreateAttendanceDto) {
    return this.logic.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @ApiOperation({ summary: 'List attendance records' })
  findAll(@Query() query: any) {
    return this.logic.findAll(query);
  }

@Get('me')
@UseGuards(JwtAuthGuard)
@ApiOperation({
  summary: 'Get current user attendance by month and year',
})
me(
  @Req() req: any,
  @Query('month') month?: string,
  @Query('year') year?: string,
) {
  return this.logic.getMyAttendance(
    req.user.userId,
    {
      month,
      year,
    },
  );
}

  @Get('user/:userId')
@UseGuards(JwtAuthGuard)
@ApiOperation({ summary: 'Get attendance for user (monthly filter)' })
userAttendence(
  @Param('userId') userId: string,
  @Query('month') month?: string,
) {
  return this.logic.getMyAttendance(userId, { month });
}

  @Post('reconcile')
  // @UseGuards(JwtAuthGuard, RoleGuard)
  // @Roles('Admin', 'bd')
  @ApiOperation({ summary: 'Reconcile attendance for all active employees based on their last 30 days and KRA status' })
  reconcileAll(@Query('days') days?: string, @Query('referenceDate') referenceDate?: string) {
    return this.logic.reconcileAttendanceForAllUsers(
      referenceDate ? new Date(referenceDate) : new Date(),
      days ? Number(days) : 30,
    );
  }

  @Get('metrics/:userId')
  // @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Return per-day KRA metrics and attendance decision for a user over a requested range' })
  getUserDailyMetrics(
    @Param('userId') userId: string,
    @Query('days') days?: string,
    @Query('referenceDate') referenceDate?: string,
  ) {
    return this.logic.getUserDailyMetrics(
      userId,
      referenceDate ? new Date(referenceDate) : new Date(),
      days ? Number(days) : 30,
    );
  }

  @Get('report/salary-sheet')
  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @RequirePermission(
    PERMISSIONS.REPORTS.MODULE,
    PERMISSIONS.REPORTS.ACTIONS.SALARY_SHEET,
  )
  @ApiOperation({ summary: 'Get monthly salary sheet report for each user' })
  salarySheetReport(@Query() query: any) {
    return this.logic.salarySheetReport(query);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @ApiOperation({ summary: 'Get attendance by id' })
  findOne(@Param('id') id: string) {
    return this.logic.findById(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @ApiOperation({ summary: 'Update attendance record' })
  update(@Param('id') id: string, @Body() dto: UpdateAttendanceDto) {
    return this.logic.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @ApiOperation({ summary: 'Delete attendance record' })
  delete(@Param('id') id: string) {
    return this.logic.delete(id);
  }


  @Patch(':id/change-status')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles('Admin', 'bd')
@ApiOperation({
  summary: 'Change attendance status with remark',
})
changeStatus(
  @Param('id') id: string,
  @Body() dto: ChangeAttendanceStatusDto,
  @Req() req: any,
) {
  console.log("Data",id,dto,req.user)
  return this.logic.changeStatus(
    id,
    dto,
    req.user.userId,
  );
}
}
