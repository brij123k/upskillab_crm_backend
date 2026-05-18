import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LeaveData } from './leave.data';
import { LeaveStatus } from 'src/schema/leave.schema';
import { User } from 'src/schema/user.schema';
import { Profile } from 'src/schema/profile.schema';
import { Kra } from 'src/schema/kra.schema';
import { NotificationEngineService } from 'src/notifications/services/notification-engine.service';
import { NOTIFICATION_EVENT } from 'src/notifications/enums/notification-event.enum';
import { NOTIFICATION_ENTITY } from 'src/notifications/enums/notification-entity.enum';

type LeaveRangeInput = {
  leaveFrom?: string;
  leaveTo?: string;
  leaveDate?: string;
};

@Injectable()
export class LeaveLogic {
  constructor(
    private readonly data: LeaveData,
    private readonly notificationEngine: NotificationEngineService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Profile.name) private readonly profileModel: Model<Profile>,
    @InjectModel(Kra.name) private readonly kraModel: Model<Kra>,
  ) {}

  private normalizeDate(value: any) {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private endOfDay(value: any) {
    const d = new Date(value);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private startOfMonth(input = new Date()) {
    const d = new Date(input);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private endOfMonth(input = new Date()) {
    const d = new Date(input);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private getLeaveBounds(dto: LeaveRangeInput) {
    const fromRaw = dto.leaveFrom || dto.leaveDate;
    const toRaw = dto.leaveTo || dto.leaveFrom || dto.leaveDate;

    if (!fromRaw) {
      throw new BadRequestException('leaveFrom is required');
    }

    const leaveFrom = this.normalizeDate(fromRaw);
    const leaveTo = this.normalizeDate(toRaw || fromRaw);

    if (leaveTo.getTime() < leaveFrom.getTime()) {
      throw new BadRequestException('leaveTo cannot be before leaveFrom');
    }

    return {
      leaveFrom,
      leaveTo,
      leaveDate: leaveFrom,
    };
  }

  private async getLimitForUser(userId: string) {
    const user = await this.userModel.findById(userId).select('role').populate('role');
    const roleId = user?.role?._id?.toString();
    if (!roleId) return null;
    const kra = await this.kraModel.findOne({ roleId });
    if (!kra || !kra.maxLeavePerMonth || kra.maxLeavePerMonth <= 0) return null;
    return kra.maxLeavePerMonth;
  }

  private async getApproverId(userId: string, dtoReportTo?: string) {
    if (dtoReportTo) return dtoReportTo;
    const profile = await this.profileModel.findOne({ userId: new Types.ObjectId(userId) }).select('reportingSeniorId');
    return profile?.reportingSeniorId?.toString() || null;
  }

  private async getApproverIds(userId: string, dto: any) {
    const rawIds = Array.isArray(dto.reportToUserIds) ? dto.reportToUserIds : [];
    if (rawIds.length) {
      return [...new Set(rawIds.map((id: any) => String(id)).filter(Boolean))];
    }

    const single = dto.reportToUserId ? String(dto.reportToUserId) : await this.getApproverId(userId, dto.reportToUserId);
    return single ? [String(single)] : [];
  }

  private getDaysInRange(leaveFrom: Date, leaveTo: Date, windowStart?: Date, windowEnd?: Date) {
    const start = windowStart ? new Date(Math.max(leaveFrom.getTime(), windowStart.getTime())) : new Date(leaveFrom);
    const end = windowEnd ? new Date(Math.min(leaveTo.getTime(), windowEnd.getTime())) : new Date(leaveTo);
    if (end.getTime() < start.getTime()) return 0;
    const millis = end.getTime() - start.getTime();
    return Math.floor(millis / (24 * 60 * 60 * 1000)) + 1;
  }

  private async countMonthlyLeaveDaysByUser(userId: string, date = new Date(), excludeId?: string) {
    const start = this.startOfMonth(date);
    const end = this.endOfMonth(date);
    const leaves = await this.data.findMonthlyByUser(userId, start, end, excludeId);

    return leaves.reduce((total, leave: any) => {
      const leaveFrom = this.normalizeDate(leave.leaveFrom || leave.leaveDate);
      const leaveTo = this.normalizeDate(leave.leaveTo || leave.leaveFrom || leave.leaveDate);
      return total + this.getDaysInRange(leaveFrom, leaveTo, start, end);
    }, 0);
  }

  private async notifyApprovalRequest(leave: any, context: { subject: string; userName: string; approverName: string; leaveFrom: Date; leaveTo: Date }) {
    const reportToIds = Array.isArray(leave.reportToUserIds) && leave.reportToUserIds.length
      ? leave.reportToUserIds
      : [leave.reportToUserId].filter(Boolean);

    if (!reportToIds.length) return;

    await this.notificationEngine.handleEvent({
      event: NOTIFICATION_EVENT.LEAVE_REQUEST,
      actorId: leave.createdBy?._id?.toString?.() || leave.createdBy?.toString?.() || undefined,
      recipients: {
        userIds: reportToIds.map((id: any) => id?._id?.toString?.() || id?.toString?.()).filter(Boolean),
      },
      title: `Leave request from ${context.userName || 'employee'}`,
      message: `${context.subject}: ${context.userName || 'Employee'} requested leave from ${context.leaveFrom.toLocaleDateString()}${context.leaveTo ? ` to ${context.leaveTo.toLocaleDateString()}` : ''}.`,
      entity: {
        type: NOTIFICATION_ENTITY.LEAVE,
        id: leave._id.toString(),
      },
      metadata: {
        redirectUrl: `/bd/leave-requests/${leave._id}`,
        leaveId: leave._id.toString(),
        kind: 'leave-request',
      },
    });
  }

  private async notifyLeaveDecision(leave: any) {
    const recipients = new Set<string>();
    const userId = leave.userId?._id?.toString?.() || leave.userId?.toString?.();
    const createdBy = leave.createdBy?._id?.toString?.() || leave.createdBy?.toString?.();
    if (userId) recipients.add(userId);
    if (createdBy) recipients.add(createdBy);

    if (!recipients.size) return;

    const approvedBy = leave.approvedBy?.name || 'Approver';
    const actionLabel = leave.status === LeaveStatus.APPROVED ? 'approved' : 'rejected';
    await this.notificationEngine.handleEvent({
      event: NOTIFICATION_EVENT.LEAVE_DECISION,
      actorId: leave.approvedBy?._id?.toString?.() || undefined,
      recipients: {
        userIds: Array.from(recipients),
      },
      title: `Your leave was ${actionLabel}`,
      message: `${leave.subject} was ${actionLabel} by ${approvedBy}${leave.approvalReason ? `: ${leave.approvalReason}` : ''}.`,
      entity: {
        type: NOTIFICATION_ENTITY.LEAVE,
        id: leave._id.toString(),
      },
      metadata: {
        redirectUrl: `/bd/leaves/${leave._id}`,
        leaveId: leave._id.toString(),
        kind: 'leave-decision',
        status: leave.status,
      },
    });
  }

  async create(dto: any, currentUserId: string) {
    if (!dto.reason) throw new BadRequestException('reason is required');
    if (!dto.subject) throw new BadRequestException('subject is required');

    const { leaveFrom, leaveTo, leaveDate } = this.getLeaveBounds(dto);
    const approverIds = await this.getApproverIds(currentUserId, dto);
    if (!approverIds.length) {
      throw new BadRequestException('reportToUserIds is required');
    }
    const approver = await this.userModel.findById(approverIds[0]).select('name');
    const currentUser = await this.userModel.findById(currentUserId).select('name role').populate('role');

    if (!currentUser) {
      throw new NotFoundException('User not found');
    }

    const limit = await this.getLimitForUser(currentUserId);
    if (limit !== null) {
      const currentCount = await this.countMonthlyLeaveDaysByUser(currentUserId, leaveFrom);
      const requestedDays = this.getDaysInRange(leaveFrom, leaveTo);
      if (currentCount + requestedDays > limit) {
        throw new BadRequestException(`Monthly leave limit reached for ${currentUser.name}`);
      }
    }

    const payload = {
      userId: new Types.ObjectId(currentUserId),
      createdBy: new Types.ObjectId(currentUserId),
      reportToUserId: new Types.ObjectId(String(approverIds[0])),
      reportToUserIds: approverIds.map((id) => new Types.ObjectId(String(id))),
      subject: dto.subject,
      leaveFrom,
      leaveTo,
      leaveDate,
      reason: dto.reason,
      status: LeaveStatus.PENDING,
    };

    const result = await this.data.create(payload);
    await this.notifyApprovalRequest(result, {
      subject: dto.subject,
      userName: currentUser.name,
      approverName: approver?.name || 'Approver',
      leaveFrom,
      leaveTo,
    });

    return {
      success: true,
      data: result,
    };
  }

  async updateMyLeave(id: string, userId: string, dto: any) {
    const existing = await this.data.findByUserAndId(userId, id);
    if (!existing) throw new NotFoundException('Leave request not found');
    if (existing.status !== LeaveStatus.PENDING && existing.status !== LeaveStatus.CANCELLED) {
      throw new BadRequestException('Only pending or cancelled leaves can be updated');
    }

    const payload: any = {};
    if (dto.subject !== undefined) payload.subject = dto.subject;
    if (dto.reason !== undefined) payload.reason = dto.reason;
    if (dto.leaveFrom !== undefined || dto.leaveTo !== undefined || dto.leaveDate !== undefined) {
      const bounds = this.getLeaveBounds({
        leaveFrom: dto.leaveFrom || dto.leaveDate || existing.leaveFrom,
        leaveTo: dto.leaveTo || dto.leaveFrom || existing.leaveTo || dto.leaveFrom || dto.leaveDate,
      });
      payload.leaveFrom = bounds.leaveFrom;
      payload.leaveTo = bounds.leaveTo;
      payload.leaveDate = bounds.leaveDate;

      const limit = await this.getLimitForUser(userId);
      if (limit !== null) {
        const currentCount = await this.countMonthlyLeaveDaysByUser(userId, payload.leaveFrom, id);
        const requestedDays = this.getDaysInRange(payload.leaveFrom, payload.leaveTo);
        if (currentCount + requestedDays > limit) {
          throw new BadRequestException('Monthly leave limit reached');
        }
      }
    }
    if (dto.reportToUserId !== undefined) payload.reportToUserId = new Types.ObjectId(dto.reportToUserId);
    if (dto.reportToUserIds !== undefined) {
      payload.reportToUserIds = Array.isArray(dto.reportToUserIds)
        ? dto.reportToUserIds.map((id: string) => new Types.ObjectId(id))
        : [];
    }

    const approverIds = [
      ...(payload.reportToUserIds ? payload.reportToUserIds.map((id: any) => String(id)) : []),
      payload.reportToUserId ? String(payload.reportToUserId) : null,
    ].filter(Boolean);

    if (approverIds.includes(String(userId))) {
      throw new BadRequestException('A user cannot approve their own leave');
    }

    const updated = await this.data.update(id, payload);
    return { success: true, data: updated };
  }

  async cancelMyLeave(id: string, userId: string) {
    const existing = await this.data.findByUserAndId(userId, id);
    if (!existing) throw new NotFoundException('Leave request not found');
    if (existing.status === LeaveStatus.APPROVED) {
      throw new BadRequestException('Approved leave cannot be cancelled');
    }
    const updated = await this.data.update(id, { status: LeaveStatus.CANCELLED });
    return { success: true, data: updated };
  }

  getMyLeaves(userId: string, filters: any = {}) {
    return this.data.findAllByUser(userId, filters);
  }

  getMyLeaveById(userId: string, id: string) {
    return this.data.findByUserAndId(userId, id);
  }

  getRequests(userId: string, filters: any = {}) {
    return this.data.findAllByApprover(userId, filters);
  }

  getRequestById(userId: string, id: string) {
    return this.data.findByApproverAndId(userId, id);
  }

  async decideLeave(id: string, approverId: string, dto: any) {
    const existing = await this.data.findByApproverAndId(approverId, id);
    if (!existing) throw new NotFoundException('Leave request not found');
    if (String(existing.userId?._id || existing.userId) === String(approverId)) {
      throw new BadRequestException('You cannot approve your own leave');
    }
    if (existing.status !== LeaveStatus.PENDING) {
      throw new BadRequestException('Only pending leave requests can be updated');
    }
    if (!dto.status || ![LeaveStatus.APPROVED, LeaveStatus.REJECTED].includes(dto.status)) {
      throw new BadRequestException('status must be approved or rejected');
    }
    if (dto.status === LeaveStatus.REJECTED && !dto.reason) {
      throw new BadRequestException('reason is required when rejecting a leave');
    }

    const updated = await this.data.update(id, {
      status: dto.status,
      approvalReason: dto.reason || null,
      approvedBy: new Types.ObjectId(approverId),
      approvedAt: new Date(),
    });

    await this.notifyLeaveDecision(updated);

    return { success: true, data: updated };
  }
}
