import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { Types } from 'mongoose';

import { AttendanceData } from './attendance.data';
import { AttendanceRecheckData } from './attendance-recheck.data';

import {
  AttendanceStatus,
} from 'src/schema/attendance.schema';

import {
  AttendanceRecheckStatus,
} from 'src/schema/attendance-recheck-request.schema';

import {
  CreateAttendanceRecheckRequestDto,
} from 'src/dto/attendance/create-recheck-request.dto';

import {
  AttendanceRecheckAction,
  ReviewAttendanceRecheckRequestDto,
} from 'src/dto/attendance/review-recheck-request.dto';

@Injectable()
export class AttendanceRecheckLogic {
  constructor(
    private readonly recheckData: AttendanceRecheckData,
    private readonly attendanceData: AttendanceData,
  ) {}

  async createRequest(
    attendanceId: string,
    userId: string,
    dto: CreateAttendanceRecheckRequestDto,
  ) {
    if (!Types.ObjectId.isValid(attendanceId)) {
      throw new BadRequestException(
        'Invalid attendance id',
      );
    }

    const attendance =
      await this.attendanceData.findById(attendanceId);

    if (!attendance) {
      throw new NotFoundException(
        'Attendance not found',
      );
    }

    const attendanceUserId =
      attendance.userId?._id?.toString?.() ||
      attendance.userId?.toString?.();

    if (attendanceUserId !== userId) {
      throw new BadRequestException(
        'You can only request recheck for your own attendance',
      );
    }

    const existing =
      await this.recheckData.findPendingByAttendance(
        attendanceId,
        userId,
      );

    if (existing) {
      throw new ConflictException(
        'A recheck request is already pending for this attendance',
      );
    }

    if (
      String(attendance.status) ===
      String(dto.requestedStatus)
    ) {
      throw new BadRequestException(
        'Requested status is same as current attendance status',
      );
    }

    return this.recheckData.create({
      attendanceId:
        new Types.ObjectId(attendanceId),

      requestedBy:
        new Types.ObjectId(userId),

      requestedStatus:
        dto.requestedStatus,

      requestReason:
        dto.requestReason,

      status:
        AttendanceRecheckStatus.PENDING,
    });
  }

  getMyRequests(userId: string) {
    return this.recheckData.findByUser(userId);
  }

  getAllRequests(query: any = {}) {
    return this.recheckData.findAll(query);
  }

  async reviewRequest(
    requestId: string,
    reviewerId: string,
    dto: ReviewAttendanceRecheckRequestDto,
  ) {
    const request =
      await this.recheckData.findById(requestId);

    if (!request) {
      throw new NotFoundException(
        'Recheck request not found',
      );
    }

    if (
      request.status !==
      AttendanceRecheckStatus.PENDING
    ) {
      throw new BadRequestException(
        'This request has already been processed',
      );
    }

    if (
      dto.action ===
      AttendanceRecheckAction.REJECT &&
      !dto.remark?.trim()
    ) {
      throw new BadRequestException(
        'Rejection reason is required',
      );
    }

    if (
      dto.action ===
      AttendanceRecheckAction.APPROVE
    ) {
      const attendance =
        await this.attendanceData.findById(
          request.attendanceId.toString(),
        );

      if (!attendance) {
        throw new NotFoundException(
          'Attendance not found',
        );
      }

      await this.attendanceData.changeStatus(
        request.attendanceId.toString(),
        request.requestedStatus,
        dto.remark ||
          'Attendance changed after employee recheck request',
        reviewerId,
      );

      return this.recheckData.review(
        requestId,
        {
          status:
            AttendanceRecheckStatus.COMPLETED,

          reviewedBy:
            new Types.ObjectId(reviewerId),

          reviewedAt:
            new Date(),

          reviewRemark:
            dto.remark ||
            'Attendance updated successfully',

          rejectedReason:
            null,
        },
      );
    }

    return this.recheckData.review(
      requestId,
      {
        status:
          AttendanceRecheckStatus.REJECTED,

        reviewedBy:
          new Types.ObjectId(reviewerId),

        reviewedAt:
          new Date(),

        reviewRemark:
          dto.remark,

        rejectedReason:
          dto.remark,
      },
    );
  }
}