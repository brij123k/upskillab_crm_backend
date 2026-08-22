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

import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';

import { AttendanceRecheckLogic } from './attendance-recheck.logic';

import {
  CreateAttendanceRecheckRequestDto,
} from 'src/dto/attendance/create-recheck-request.dto';

import {
  ReviewAttendanceRecheckRequestDto,
} from 'src/dto/attendance/review-recheck-request.dto';

@ApiTags('Attendance Recheck')
@ApiBearerAuth()
@Controller('attendance/recheck')
export class AttendanceRecheckController {
  constructor(
    private readonly logic: AttendanceRecheckLogic,
  ) {}

  @Post(':attendanceId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Request attendance recheck',
  })
  createRequest(
    @Param('attendanceId')
    attendanceId: string,

    @Body()
    dto: CreateAttendanceRecheckRequestDto,

    @Req()
    req: any,
  ) {
    return this.logic.createRequest(
      attendanceId,
      req.user.userId,
      dto,
    );
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get my attendance recheck requests',
  })
  getMyRequests(
    @Req() req: any,
  ) {
    return this.logic.getMyRequests(
      req.user.userId,
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'hr')
  @ApiOperation({
    summary: 'List attendance recheck requests',
  })
  getAllRequests(
    @Query() query: any,
  ) {
    return this.logic.getAllRequests(query);
  }

  @Patch(':requestId/review')
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'hr')
  @ApiOperation({
    summary: 'Approve or reject attendance recheck',
  })
  review(
    @Param('requestId')
    requestId: string,

    @Body()
    dto: ReviewAttendanceRecheckRequestDto,

    @Req()
    req: any,
  ) {
    return this.logic.reviewRequest(
      requestId,
      req.user.userId,
      dto,
    );
  }
}