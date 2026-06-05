import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LeaveData } from './leave.data';
import { LeavePolicyData } from './leave-policy.data';
import { LeavePolicy } from 'src/schema/leave-policy.schema';
import { LeaveStatus, LeaveType } from 'src/schema/leave.schema';
import { User } from 'src/schema/user.schema';
import { Profile } from 'src/schema/profile.schema';
import { Role } from 'src/schema/role.schema';
import { NotificationEngineService } from 'src/notifications/services/notification-engine.service';
import { NOTIFICATION_EVENT } from 'src/notifications/enums/notification-event.enum';
import { NOTIFICATION_ENTITY } from 'src/notifications/enums/notification-entity.enum';

type LeaveRangeInput = {
  leaveFrom?: string;
  leaveTo?: string;
  leaveDate?: string;
};

type LeavePolicyInput = {
  roleId?: string;
  casualLeavePerMonth?: number;
  earnedLeavePerYear?: number;
  earnedLeaveCarryForwardCap?: number;
  allowEarnedLeaveCarryForward?: boolean;
};

@Injectable()
export class LeaveLogic {
  constructor(
    private readonly data: LeaveData,
    private readonly policyData: LeavePolicyData,
    private readonly notificationEngine: NotificationEngineService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Profile.name) private readonly profileModel: Model<Profile>,
    @InjectModel(Role.name) private readonly roleModel: Model<Role>,
    @InjectModel(LeavePolicy.name) private readonly leavePolicyModel: Model<LeavePolicy>,
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

  private startOfYear(input = new Date()) {
    const d = new Date(input);
    d.setMonth(0, 1);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private endOfYear(input = new Date()) {
    const d = new Date(input);
    d.setMonth(11, 31);
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

  private getDaysInRange(leaveFrom: Date, leaveTo: Date, windowStart?: Date, windowEnd?: Date) {
    const start = windowStart ? new Date(Math.max(leaveFrom.getTime(), windowStart.getTime())) : new Date(leaveFrom);
    const end = windowEnd ? new Date(Math.min(leaveTo.getTime(), windowEnd.getTime())) : new Date(leaveTo);
    if (end.getTime() < start.getTime()) return 0;
    const millis = end.getTime() - start.getTime();
    return Math.floor(millis / (24 * 60 * 60 * 1000)) + 1;
  }

  private getMonthKey(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  private getYearKey(date: Date) {
    return date.getFullYear();
  }

  private splitByMonth(from: Date, to: Date) {
    const segments: Array<{ key: string; start: Date; end: Date }> = [];
    const cursor = new Date(from);
    while (cursor.getTime() <= to.getTime()) {
      const start = new Date(cursor);
      const monthEnd = this.endOfMonth(cursor);
      const end = new Date(Math.min(monthEnd.getTime(), to.getTime()));
      segments.push({ key: this.getMonthKey(start), start, end });
      cursor.setMonth(cursor.getMonth() + 1, 1);
      cursor.setHours(0, 0, 0, 0);
    }
    return segments;
  }

  private splitByYear(from: Date, to: Date) {
    const segments: Array<{ key: number; start: Date; end: Date }> = [];
    const cursor = new Date(from);
    while (cursor.getTime() <= to.getTime()) {
      const start = new Date(cursor);
      const yearEnd = this.endOfYear(cursor);
      const end = new Date(Math.min(yearEnd.getTime(), to.getTime()));
      segments.push({ key: this.getYearKey(start), start, end });
      cursor.setFullYear(cursor.getFullYear() + 1, 0, 1);
      cursor.setHours(0, 0, 0, 0);
    }
    return segments;
  }

  private async getCurrentUser(userId: string) {
    const user = await this.userModel.findById(userId).select('name role').populate('role', 'name level isSuperAdmin');
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private async getPolicyByRoleId(roleId: string) {
    return this.policyData.findByRoleId(roleId);
  }

  private async getPolicyForUser(userId: string) {
    const user = await this.userModel.findById(userId).select('role').populate('role', 'name level isSuperAdmin');
    const roleId = user?.role?._id?.toString?.() || user?.role?.toString?.();

    if (!roleId) {
      throw new BadRequestException('User role is required to apply leave');
    }

    const policy = await this.getPolicyByRoleId(roleId);
    if (!policy) {
      throw new BadRequestException('Leave policy not configured for this role');
    }

    return policy;
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

  private async getLeavesForPeriod(userId: string, start: Date, end: Date, options: { excludeId?: string; leaveType?: LeaveType } = {}) {
    return this.data.findByUserInRange(userId, start, end, {
      excludeId: options.excludeId,
      leaveType: options.leaveType,
      statuses: [LeaveStatus.PENDING, LeaveStatus.APPROVED],
    });
  }

  private calculateUsedDaysInWindow(leaves: any[], windowStart: Date, windowEnd: Date) {
    return leaves.reduce((total, leave: any) => {
      const leaveFrom = this.normalizeDate(leave.leaveFrom || leave.leaveDate);
      const leaveTo = this.normalizeDate(leave.leaveTo || leave.leaveFrom || leave.leaveDate);
      return total + this.getDaysInRange(leaveFrom, leaveTo, windowStart, windowEnd);
    }, 0);
  }

  private async getClUsageForMonth(userId: string, monthDate: Date, excludeId?: string) {
    const start = this.startOfMonth(monthDate);
    const end = this.endOfMonth(monthDate);
    const leaves = await this.getLeavesForPeriod(userId, start, end, { excludeId, leaveType: LeaveType.CL });
    return this.calculateUsedDaysInWindow(leaves, start, end);
  }

  private async getElUsageForYear(userId: string, yearDate: Date, excludeId?: string) {
    const start = this.startOfYear(yearDate);
    const end = this.endOfYear(yearDate);
    const leaves = await this.getLeavesForPeriod(userId, start, end, { excludeId, leaveType: LeaveType.EL });
    return this.calculateUsedDaysInWindow(leaves, start, end);
  }

  private async getFirstLeaveYear(userId: string) {
    const earliest = await this.data.findEarliestLeaveDate(userId);
    if (!earliest) return null;
    const raw = earliest.leaveFrom || earliest.leaveDate;
    if (!raw) return null;
    return new Date(raw).getFullYear();
  }

  private async getEarnedLeaveOpeningForYear(userId: string, policy: any, year: number): Promise<number> {
    const firstYear = await this.getFirstLeaveYear(userId);
    if (firstYear === null || year <= firstYear) {
      return Number(policy.earnedLeavePerYear || 0);
    }

    const previousOpening = await this.getEarnedLeaveOpeningForYear(userId, policy, year - 1);
    const previousUsed = await this.getElUsageForYear(userId, new Date(year - 1, 0, 1));
    const previousRemaining = Math.max(0, previousOpening - previousUsed);

    if (policy.allowEarnedLeaveCarryForward === false) {
      return Number(policy.earnedLeavePerYear || 0);
    }

    const carryCap = Number(policy.earnedLeaveCarryForwardCap || 0);
    const carryForward = carryCap > 0 ? Math.min(previousRemaining, carryCap) : previousRemaining;
    return Number(policy.earnedLeavePerYear || 0) + carryForward;
  }

  private async validateLeaveQuota(userId: string, policy: any, leaveFrom: Date, leaveTo: Date, leaveType: LeaveType, excludeId?: string) {
    if (leaveType === LeaveType.CL) {
      const segments = this.splitByMonth(leaveFrom, leaveTo);
      for (const segment of segments) {
        const requestedDays = this.getDaysInRange(leaveFrom, leaveTo, segment.start, segment.end);
        const usedDays = await this.getClUsageForMonth(userId, segment.start, excludeId);
        const limit = Number(policy.casualLeavePerMonth || 0);
        if (usedDays + requestedDays > limit) {
          const label = segment.start.toLocaleString('en-US', { month: 'long', year: 'numeric' });
          throw new BadRequestException(`No CL leave remaining for ${label}`);
        }
      }
      return;
    }

    if (leaveType === LeaveType.EL) {
      const segments = this.splitByYear(leaveFrom, leaveTo);
      for (const segment of segments) {
        const requestedDays = this.getDaysInRange(leaveFrom, leaveTo, segment.start, segment.end);
        const opening = await this.getEarnedLeaveOpeningForYear(userId, policy, segment.key);
        const usedDays = await this.getElUsageForYear(userId, segment.start, excludeId);
        if (usedDays + requestedDays > opening) {
          throw new BadRequestException(`No EL leave remaining for ${segment.key}`);
        }
      }
      return;
    }

    throw new BadRequestException('leaveType must be CL or EL');
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
      message: `${context.subject}: ${context.userName || 'Employee'} requested ${leave.leaveType || 'leave'} from ${context.leaveFrom.toLocaleDateString()}${context.leaveTo ? ` to ${context.leaveTo.toLocaleDateString()}` : ''}.`,
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

  async createPolicy(dto: LeavePolicyInput) {
    if (!dto.roleId) {
      throw new BadRequestException('roleId is required');
    }

    const role = await this.roleModel.findById(dto.roleId).select('_id name');
    if (!role) {
      throw new NotFoundException('Role not found');
    }

    const existing = await this.policyData.findByRoleId(dto.roleId);
    const payload = {
      roleId: new Types.ObjectId(dto.roleId),
      casualLeavePerMonth: Number(dto.casualLeavePerMonth || 0),
      earnedLeavePerYear: Number(dto.earnedLeavePerYear || 0),
      earnedLeaveCarryForwardCap: Number(dto.earnedLeaveCarryForwardCap || 0),
      allowEarnedLeaveCarryForward: dto.allowEarnedLeaveCarryForward !== false,
    };

    if (existing) {
      return { success: true, data: await this.policyData.update(existing._id.toString(), payload) };
    }

    return { success: true, data: await this.policyData.create(payload) };
  }

  async updatePolicy(id: string, dto: LeavePolicyInput) {
    const existing = await this.policyData.findById(id);
    if (!existing) {
      throw new NotFoundException('Leave policy not found');
    }

    const payload: any = {};
    if (dto.roleId !== undefined) {
      const role = await this.roleModel.findById(dto.roleId).select('_id name');
      if (!role) {
        throw new NotFoundException('Role not found');
      }
      payload.roleId = new Types.ObjectId(dto.roleId);
    }
    if (dto.casualLeavePerMonth !== undefined) payload.casualLeavePerMonth = Number(dto.casualLeavePerMonth);
    if (dto.earnedLeavePerYear !== undefined) payload.earnedLeavePerYear = Number(dto.earnedLeavePerYear);
    if (dto.earnedLeaveCarryForwardCap !== undefined) payload.earnedLeaveCarryForwardCap = Number(dto.earnedLeaveCarryForwardCap);
    if (dto.allowEarnedLeaveCarryForward !== undefined) payload.allowEarnedLeaveCarryForward = Boolean(dto.allowEarnedLeaveCarryForward);

    return { success: true, data: await this.policyData.update(id, payload) };
  }

  async deletePolicy(id: string) {
    const existing = await this.policyData.findById(id);
    if (!existing) {
      throw new NotFoundException('Leave policy not found');
    }
    return { success: true, data: await this.policyData.delete(id) };
  }

  getPolicies() {
    return this.policyData.findAll();
  }

  getPolicyById(id: string) {
    return this.policyData.findById(id);
  }

  getPolicyByRole(roleId: string) {
    return this.policyData.findByRoleId(roleId);
  }

  async create(dto: any, currentUserId: string) {
    if (!dto.reason) throw new BadRequestException('reason is required');
    if (!dto.subject) throw new BadRequestException('subject is required');

    const { leaveFrom, leaveTo, leaveDate } = this.getLeaveBounds(dto);
    const leaveType = String(dto.leaveType || LeaveType.CL).toUpperCase() as LeaveType;
    const policy = await this.getPolicyForUser(currentUserId);
    const approverIds = await this.getApproverIds(currentUserId, dto);

    if (!approverIds.length) {
      throw new BadRequestException('reportToUserIds is required');
    }

    await this.validateLeaveQuota(currentUserId, policy, leaveFrom, leaveTo, leaveType);

    const approver = await this.userModel.findById(approverIds[0]).select('name');
    const currentUser = await this.getCurrentUser(currentUserId);

    const payload = {
      userId: new Types.ObjectId(currentUserId),
      createdBy: new Types.ObjectId(currentUserId),
      reportToUserId: new Types.ObjectId(String(approverIds[0])),
      reportToUserIds: approverIds.map((id) => new Types.ObjectId(String(id))),
      subject: dto.subject,
      leaveFrom,
      leaveTo,
      leaveDate,
      leaveType,
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
    if (dto.leaveType !== undefined) payload.leaveType = String(dto.leaveType).toUpperCase();

    if (dto.leaveFrom !== undefined || dto.leaveTo !== undefined || dto.leaveDate !== undefined) {
      const bounds = this.getLeaveBounds({
        leaveFrom: dto.leaveFrom || dto.leaveDate || existing.leaveFrom,
        leaveTo: dto.leaveTo || dto.leaveFrom || existing.leaveTo || dto.leaveFrom || dto.leaveDate,
      });
      payload.leaveFrom = bounds.leaveFrom;
      payload.leaveTo = bounds.leaveTo;
      payload.leaveDate = bounds.leaveDate;
    }

    if (dto.reportToUserId !== undefined) payload.reportToUserId = new Types.ObjectId(dto.reportToUserId);
    if (dto.reportToUserIds !== undefined) {
      payload.reportToUserIds = Array.isArray(dto.reportToUserIds)
        ? dto.reportToUserIds.map((id: string) => new Types.ObjectId(id))
        : [];
    }

    const leaveType = String(payload.leaveType || existing.leaveType || LeaveType.CL).toUpperCase() as LeaveType;
    const finalLeaveFrom = payload.leaveFrom || existing.leaveFrom;
    const finalLeaveTo = payload.leaveTo || existing.leaveTo || finalLeaveFrom;
    const policy = await this.getPolicyForUser(userId);
    await this.validateLeaveQuota(userId, policy, finalLeaveFrom, finalLeaveTo, leaveType, id);
    payload.leaveType = leaveType;

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

  async getMyLeaveSummary(userId: string, date = new Date()) {
    const policy = await this.getPolicyForUser(userId);
    const monthStart = this.startOfMonth(date);
    const yearStart = this.startOfYear(date);
    const clUsed = await this.getClUsageForMonth(userId, date);
    const elUsed = await this.getElUsageForYear(userId, date);
    const elOpening = await this.getEarnedLeaveOpeningForYear(userId, policy, date.getFullYear());

    return {
      policy,
      month: {
        key: this.getMonthKey(date),
        casualLeaveLimit: Number(policy.casualLeavePerMonth || 0),
        casualLeaveUsed: clUsed,
        casualLeaveRemaining: Math.max(0, Number(policy.casualLeavePerMonth || 0) - clUsed),
        start: monthStart,
        end: this.endOfMonth(date),
      },
      year: {
        key: date.getFullYear(),
        earnedLeaveOpening: elOpening,
        earnedLeaveUsed: elUsed,
        earnedLeaveRemaining: Math.max(0, elOpening - elUsed),
        start: yearStart,
        end: this.endOfYear(date),
      },
    };
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
