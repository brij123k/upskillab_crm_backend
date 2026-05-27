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
  @ApiOperation({ summary: 'Get attendance for current user' })
  me(@Req() req: any,@Query('month') month?: string,) {
    return this.logic.getMyAttendance(req.user.userId, { month });
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

  @Get('report/salary-sheet')
  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'hr')
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
  @Roles('Admin', 'hr')
  @ApiOperation({ summary: 'Get attendance by id' })
  findOne(@Param('id') id: string) {
    return this.logic.findById(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'hr')
  @ApiOperation({ summary: 'Update attendance record' })
  update(@Param('id') id: string, @Body() dto: UpdateAttendanceDto) {
    return this.logic.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'hr')
  @ApiOperation({ summary: 'Delete attendance record' })
  delete(@Param('id') id: string) {
    return this.logic.delete(id);
  }
}
