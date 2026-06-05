import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LeadHistory, LeadActionType } from 'src/schema/lead_management/lead-history.schema';
import { CallLog } from 'src/schema/call-log.schema';
import { User } from 'src/schema/user.schema';
import { AttendanceStatus } from 'src/schema/attendance.schema';
import { KraData } from './kra.data';

type KraMetrics = {
  answeredCalls: number;
  talkTime: number;
  dialCalls: number;
  bookings: number;
  demoConducts: number;
};

@Injectable()
export class KraLogic {
  constructor(
    private readonly data: KraData,
    @InjectModel(CallLog.name) private readonly callLogModel: Model<CallLog>,
    @InjectModel(LeadHistory.name) private readonly leadHistoryModel: Model<LeadHistory>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  private startOfDay(input = new Date()) {
    const d = new Date(input);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private endOfDay(input = new Date()) {
    const d = new Date(input);
    d.setHours(23, 59, 59, 999);
    return d;
  }

  private normalizeText(value: any) {
    return String(value || '').trim().toLowerCase();
  }

  private buildReason(
    label: 'full_day' | 'half_day' | 'absent' | 'no_kra',
    thresholds: any,
    metrics: KraMetrics,
  ) {
    if (label === 'no_kra') {
      return 'KRA not configured for this role';
    }

    const parts: string[] = [];

    if (metrics.answeredCalls < thresholds.answeredCalls) {
      parts.push(`answered calls ${metrics.answeredCalls}/${thresholds.answeredCalls}`);
    }
    if (metrics.talkTime < thresholds.talkTime) {
      parts.push(`talk time ${metrics.talkTime}/${thresholds.talkTime}`);
    }
    if (metrics.dialCalls < thresholds.dialCalls) {
      parts.push(`dial calls ${metrics.dialCalls}/${thresholds.dialCalls}`);
    }
    if (metrics.bookings < thresholds.bookings) {
      parts.push(`bookings ${metrics.bookings}/${thresholds.bookings}`);
    }
    if (metrics.demoConducts < thresholds.demoConducts) {
      parts.push(`demo conducts ${metrics.demoConducts}/${thresholds.demoConducts}`);
    }

    if (!parts.length) {
      return `${label === 'full_day' ? 'Full day' : 'Half day'} criteria met`;
    }

    return `${label === 'full_day' ? 'Full day' : 'Half day'} criteria not met: ${parts.join(', ')}`;
  }

  private isMeetingThresholds(metrics: KraMetrics, thresholds: KraMetrics) {
    return (
      metrics.answeredCalls >= thresholds.answeredCalls &&
      metrics.talkTime >= thresholds.talkTime &&
      metrics.dialCalls >= thresholds.dialCalls &&
      metrics.bookings >= thresholds.bookings &&
      metrics.demoConducts >= thresholds.demoConducts
    );
  }

  async createOrUpdate(dto: any) {
    if (!dto?.roleId) {
      throw new BadRequestException('roleId is required');
    }

    return this.data.upsertByRoleId(dto.roleId, {
      fullDayAnsweredCalls: Number(dto.fullDayAnsweredCalls || 0),
      fullDayTalkTime: Number(dto.fullDayTalkTime || 0),
      fullDayDialCalls: Number(dto.fullDayDialCalls || 0),
      fullDayBookings: Number(dto.fullDayBookings || 0),
      fullDayDemoConducts: Number(dto.fullDayDemoConducts || 0),
      halfDayAnsweredCalls: Number(dto.halfDayAnsweredCalls || 0),
      halfDayTalkTime: Number(dto.halfDayTalkTime || 0),
      halfDayDialCalls: Number(dto.halfDayDialCalls || 0),
      halfDayBookings: Number(dto.halfDayBookings || 0),
      halfDayDemoConducts: Number(dto.halfDayDemoConducts || 0),
    });
  }

  findAll() {
    return this.data.findAll();
  }

  findById(id: string) {
    return this.data.findById(id);
  }

  findByRoleId(roleId: string) {
    return this.data.findByRoleId(roleId);
  }

  update(id: string, dto: any) {
    const payload: any = {};

    const fields = [
      'fullDayAnsweredCalls',
      'fullDayTalkTime',
      'fullDayDialCalls',
      'fullDayBookings',
      'fullDayDemoConducts',
      'halfDayAnsweredCalls',
      'halfDayTalkTime',
      'halfDayDialCalls',
      'halfDayBookings',
      'halfDayDemoConducts',
      'roleId',
    ];

    for (const field of fields) {
      if (dto[field] !== undefined) {
        payload[field] = field === 'roleId' ? dto[field] : Number(dto[field]);
      }
    }

    return this.data.update(id, payload);
  }

  delete(id: string) {
    return this.data.delete(id);
  }

  private async getMetrics(userId: string, startDate: Date, endDate: Date): Promise<KraMetrics> {
    const userObjectId = new Types.ObjectId(userId);

    const [dialLeadIds, answeredResult, talkTimeResult, bookings, demoConducts] =
      await Promise.all([
        this.callLogModel.distinct('leadId', {
          userId: userId,
          createdAt: { $gte: startDate, $lte: endDate },
        }),
        this.callLogModel.countDocuments({
          userId: userId,
          createdAt: { $gte: startDate, $lte: endDate },
          duration: { $gt: 0 },
        }),
        this.callLogModel.aggregate([
          {
            $match: {
              userId: userId,
              createdAt: { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: null,
              talkTime: { $sum: { $ifNull: ['$duration', 0] } },
            },
          },
        ]),
        this.leadHistoryModel.distinct('leadId', {
          actionBy: userObjectId,
          createdAt: { $gte: startDate, $lte: endDate },
          actionType: { $in: [LeadActionType.STAGE_CHANGED, LeadActionType.STAGE_CHANGED_CallS] },
          'changes.status.to': { $regex: /pcat.*sched/i },
        }),
        this.leadHistoryModel.distinct('leadId', {
          actionBy: userObjectId,
          createdAt: { $gte: startDate, $lte: endDate },
          actionType: { $in: [LeadActionType.STAGE_CHANGED, LeadActionType.STAGE_CHANGED_CallS] },
          'changes.status.to': { $regex: /pcat.*(comp|done)/i },
        }),
      ]);

    return {
      dialCalls: dialLeadIds.length,
      answeredCalls: answeredResult || 0,
      talkTime: talkTimeResult[0]?.talkTime || 0,
      bookings: bookings.length,
      demoConducts: demoConducts.length,
    };
  }

  async compareByRoleAndUser(roleId: string, userId: string, date = new Date()) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const user = await this.userModel.findById(userId).populate('role');

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const startDate = this.startOfDay(date);
    const endDate = this.endOfDay(date);
    const metrics = await this.getMetrics(userId, startDate, endDate);
    const kra = roleId ? await this.data.findByRoleId(roleId) : null;

    if (!roleId || !kra) {
      return {
        roleId: roleId || null,
        userId,
        status: AttendanceStatus.PRESENT,
        appliedCriteria: 'none',
        metrics,
        thresholds: null,
        reason: this.buildReason('no_kra', null, metrics),
        startDate,
        endDate,
      };
    }

    const fullThresholds: KraMetrics = {
      answeredCalls: Number(kra.fullDayAnsweredCalls || 0),
      talkTime: Number(kra.fullDayTalkTime || 0),
      dialCalls: Number(kra.fullDayDialCalls || 0),
      bookings: Number(kra.fullDayBookings || 0),
      demoConducts: Number(kra.fullDayDemoConducts || 0),
    };

    const halfThresholds: KraMetrics = {
      answeredCalls: Number(kra.halfDayAnsweredCalls || 0),
      talkTime: Number(kra.halfDayTalkTime || 0),
      dialCalls: Number(kra.halfDayDialCalls || 0),
      bookings: Number(kra.halfDayBookings || 0),
      demoConducts: Number(kra.halfDayDemoConducts || 0),
    };

    if (this.isMeetingThresholds(metrics, fullThresholds)) {
      return {
        roleId,
        userId,
        status: AttendanceStatus.PRESENT,
        appliedCriteria: 'full_day',
        metrics,
        thresholds: fullThresholds,
        reason: this.buildReason('full_day', fullThresholds, metrics),
        startDate,
        endDate,
      };
    }

    if (this.isMeetingThresholds(metrics, halfThresholds)) {
      return {
        roleId,
        userId,
        status: AttendanceStatus.HALF_DAY,
        appliedCriteria: 'half_day',
        metrics,
        thresholds: halfThresholds,
        reason: this.buildReason('half_day', halfThresholds, metrics),
        startDate,
        endDate,
      };
    }

    return {
      roleId,
      userId,
      status: AttendanceStatus.ABSENT,
      appliedCriteria: 'none',
      metrics,
      thresholds: halfThresholds,
      reason: this.buildReason('absent', halfThresholds, metrics),
      startDate,
      endDate,
    };
  }

  async compareByUser(userId: string, date = new Date()) {
    const user = await this.userModel.findById(userId).select('role');
    if (!user?.role) {
      return this.compareByRoleAndUser('', userId, date);
    }
    return this.compareByRoleAndUser(user.role.toString(), userId, date);
  }
}
