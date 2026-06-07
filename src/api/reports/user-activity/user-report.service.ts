import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Lead, LeadStatus } from 'src/schema/lead_management/lead.schema';
import { CallLog } from 'src/schema/call-log.schema';
import { Order, OrderStatus } from 'src/schema/order_Management/order.schema';
import { User } from 'src/schema/user.schema';
import { LeadHistory, LeadActionType } from 'src/schema/lead_management/lead-history.schema';

@Injectable()
export class UserReportService {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    @InjectModel(CallLog.name) private readonly callLogModel: Model<CallLog>,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(LeadHistory.name) private readonly leadHistoryModel: Model<LeadHistory>,
  ) {}

  private parseDateRange(query: any): { startDate: Date; endDate: Date } {
    const now = new Date();
    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (query.dateFilter) {
      const filter = query.dateFilter.toString().toLowerCase();
      if (filter === 'today') {
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
      } else if (filter === 'week') {
        startDate = new Date(now);
        startDate.setDate(startDate.getDate() - 6);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
      } else if (filter === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      } else if (filter === 'year') {
        startDate = new Date(now.getFullYear(), 0, 1);
        endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      }
    }

    if (query.fromDate) {
      const from = new Date(query.fromDate);
      if (!Number.isNaN(from.getTime())) {
        startDate = new Date(from);
        startDate.setHours(0, 0, 0, 0);
      }
    }

    if (query.toDate) {
      const to = new Date(query.toDate);
      if (!Number.isNaN(to.getTime())) {
        endDate = new Date(to);
        endDate.setHours(23, 59, 59, 999);
      }
    }

    if (!startDate || !endDate) {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    }

    if (startDate > endDate) {
      const temp = startDate;
      startDate = endDate;
      endDate = temp;
    }

    const diffDays = Math.ceil(
      Math.abs(endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    ) + 1;

    const customRangeProvided = Boolean(query.fromDate || query.toDate);
    if (customRangeProvided && diffDays > 30) {
      throw new BadRequestException('Custom date range cannot exceed 30 days');
    }

    return { startDate, endDate };
  }

  private normalizeObjectId(value: any): string | null {
    if (!value) return null;
    try {
      return new Types.ObjectId(value).toString();
    } catch {
      return null;
    }
  }

  private formatStageName(stageName: string | null): string {
    if (!stageName) return 'Unknown';
    return stageName.toString();
  }

  async userActivityReport(query: any) {
    const { startDate, endDate } = this.parseDateRange(query);
    const requestedUserId = query.userId ? this.normalizeObjectId(query.userId) : null;

    const userFilter = requestedUserId
      ? { $in: [new Types.ObjectId(requestedUserId)] }
      : undefined;

    const leadAssignedMatch: any = {
      assignedDate: { $gte: startDate, $lte: endDate },
    };
    if (userFilter) leadAssignedMatch.assignedTo = userFilter;

    const leadCreatedMatch: any = {
      createdAt: { $gte: startDate, $lte: endDate },
    };
    if (userFilter) leadCreatedMatch.assignedTo = userFilter;

    const callLogMatch: any = {
      createdAt: { $gte: startDate, $lte: endDate },
    };
    if (requestedUserId) callLogMatch.userId = requestedUserId;

    const orderMatch: any = {
      orderDate: { $gte: startDate, $lte: endDate },
      $or: [
        { status: OrderStatus.FULLY_PAID },
        { Approved: true },
      ],
    };
    if (userFilter) orderMatch.counsellorId = userFilter;

    const sourceMatch: any = {
      assignedDate: { $gte: startDate, $lte: endDate },
    };
    if (userFilter) sourceMatch.assignedTo = userFilter;

    const sourceCampaignMatch: any = {
      assignedDate: { $gte: startDate, $lte: endDate },
    };
    if (userFilter) sourceCampaignMatch.assignedTo = userFilter;

    const assignedLeads = await this.leadModel.aggregate([
      { $match: leadAssignedMatch },
      {
        $group: {
          _id: {
            assignedTo: {
              $convert: { input: '$assignedTo', to: 'string', onError: null, onNull: null },
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const newLeads = await this.leadModel.aggregate([
      { $match: leadCreatedMatch },
      {
        $group: {
          _id: {
            assignedTo: {
              $convert: { input: '$assignedTo', to: 'string', onError: null, onNull: null },
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const callStats = await this.callLogModel.aggregate([
      { $match: callLogMatch },
      {
        $group: {
          _id: '$userId',
          totalDialed: { $sum: 1 },
          totalAnswered: {
            $sum: {
              $cond: [{ $gt: ['$duration', 0] }, 1, 0],
            },
          },
          totalTalkTime: {
            $sum: {
              $cond: [{ $gt: ['$duration', 0] }, '$duration', 0],
            },
          },
        },
      },
    ]);

    const sourceCounts = await this.leadModel.aggregate([
      { $match: sourceMatch },
      {
        $group: {
          _id: {
            assignedTo: {
              $convert: { input: '$assignedTo', to: 'string', onError: null, onNull: null },
            },
            source: { $ifNull: ['$source', 'unknown'] },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const sourceCampaignCounts = await this.leadModel.aggregate([
      { $match: sourceCampaignMatch },
      {
        $group: {
          _id: {
            assignedTo: {
              $convert: { input: '$assignedTo', to: 'string', onError: null, onNull: null },
            },
            campaign: { $ifNull: ['$source_campaign', 'unknown'] },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const pcatRegisteredByUser = await this.leadModel.aggregate([
      {
        $match: {
          status: LeadStatus.PCAT_REGISTERED,
          modifiedAt: { $gte: startDate, $lte: endDate },
          ...(userFilter ? { assignedTo: userFilter } : {}),
        },
      },
      {
        $group: {
          _id: {
            assignedTo: {
              $convert: { input: '$assignedTo', to: 'string', onError: null, onNull: null },
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const pcatDoneByUser = await this.leadHistoryModel.aggregate([
      {
        $match: {
          actionType: { $in: [LeadActionType.STAGE_CHANGED, LeadActionType.STAGE_CHANGED_CallS] },
          'changes.status.to': { $regex: /pcat.*(done|complete)/i },
          createdAt: { $gte: startDate, $lte: endDate },
          ...(requestedUserId ? { actionBy: new Types.ObjectId(requestedUserId) } : {}),
        },
      },
      {
        $group: {
          _id: {
            actionBy: {
              $convert: { input: '$actionBy', to: 'string', onError: null, onNull: null },
            },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const stageChanges = await this.leadHistoryModel.aggregate([
      {
        $match: {
          actionType: { $in: [LeadActionType.STAGE_CHANGED, LeadActionType.STAGE_CHANGED_CallS] },
          'changes.status.to': { $exists: true, $ne: null },
          createdAt: { $gte: startDate, $lte: endDate },
          ...(requestedUserId ? { actionBy: new Types.ObjectId(requestedUserId) } : {}),
        },
      },
      {
        $project: {
          actionBy: 1,
          stage: '$changes.status.to',
        },
      },
      {
        $group: {
          _id: {
            actionBy: {
              $convert: { input: '$actionBy', to: 'string', onError: null, onNull: null },
            },
            stage: '$stage',
          },
          count: { $sum: 1 },
        },
      },
    ]);

    const orderCounts = await this.orderModel.aggregate([
      { $match: orderMatch },
      {
        $group: {
          _id: {
            counsellorId: {
              $convert: { input: '$counsellorId', to: 'string', onError: null, onNull: null },
            },
          },
          acceptedOrderCount: { $sum: 1 },
          acceptedRevenue: { $sum: '$finalFee' },
        },
      },
    ]);

    const userIds = new Set<string>();
    const collectId = (id: string | null | undefined) => {
      if (id) userIds.add(id.toString());
    };

    assignedLeads.forEach((entry) => collectId(entry._id?.assignedTo));
    newLeads.forEach((entry) => collectId(entry._id?.assignedTo));
    callStats.forEach((entry) => collectId(entry._id));
    sourceCounts.forEach((entry) => collectId(entry._id?.assignedTo));
    sourceCampaignCounts.forEach((entry) => collectId(entry._id?.assignedTo));
    pcatRegisteredByUser.forEach((entry) => collectId(entry._id?.assignedTo));
    pcatDoneByUser.forEach((entry) => collectId(entry._id?.actionBy));
    stageChanges.forEach((entry) => collectId(entry._id?.actionBy));
    orderCounts.forEach((entry) => collectId(entry._id?.counsellorId));

    const userIdArray = requestedUserId ? [requestedUserId] : Array.from(userIds);

    const users = userIdArray.length
      ? await this.userModel
          .find({ _id: { $in: userIdArray.map((id) => new Types.ObjectId(id)) } })
          .select('name email employeeId number')
          .lean()
      : [];

    const usersById = new Map(users.map((user) => [user._id.toString(), user]));

    const assignedLeadsMap = new Map<string, number>();
    assignedLeads.forEach((entry) => {
      const userId = entry._id?.assignedTo?.toString();
      if (!userId) return;
      assignedLeadsMap.set(userId, entry.count);
    });

    const newLeadsMap = new Map<string, number>();
    newLeads.forEach((entry) => {
      const userId = entry._id?.assignedTo?.toString();
      if (!userId) return;
      newLeadsMap.set(userId, entry.count);
    });

    const callStatsMap = new Map<string, any>();
    callStats.forEach((entry) => {
      if (!entry._id) return;
      callStatsMap.set(entry._id.toString(), {
        totalDialed: entry.totalDialed || 0,
        totalAnswered: entry.totalAnswered || 0,
        totalTalkTime: entry.totalTalkTime || 0,
      });
    });

    const orderStatsMap = new Map<string, any>();
    orderCounts.forEach((entry) => {
      const userId = entry._id?.counsellorId?.toString();
      if (!userId) return;
      orderStatsMap.set(userId, {
        acceptedOrderCount: entry.acceptedOrderCount || 0,
        acceptedRevenue: entry.acceptedRevenue || 0,
      });
    });

    const sourceMap = new Map<string, Map<string, number>>();
    sourceCounts.forEach((entry) => {
      const userId = entry._id?.assignedTo?.toString();
      const source = entry._id?.source || 'unknown';
      if (!userId) return;
      if (!sourceMap.has(userId)) sourceMap.set(userId, new Map());
      const userSourceMap = sourceMap.get(userId)!;
      userSourceMap.set(source, entry.count);
    });

    const campaignMap = new Map<string, Map<string, number>>();
    sourceCampaignCounts.forEach((entry) => {
      const userId = entry._id?.assignedTo?.toString();
      const campaign = entry._id?.campaign || 'unknown';
      if (!userId) return;
      if (!campaignMap.has(userId)) campaignMap.set(userId, new Map());
      const userCampaignMap = campaignMap.get(userId)!;
      userCampaignMap.set(campaign, entry.count);
    });

    const pcatRegisteredMap = new Map<string, number>();
    pcatRegisteredByUser.forEach((entry) => {
      const userId = entry._id?.assignedTo?.toString();
      if (!userId) return;
      pcatRegisteredMap.set(userId, entry.count);
    });

    const pcatDoneMap = new Map<string, number>();
    pcatDoneByUser.forEach((entry) => {
      const userId = entry._id?.actionBy?.toString();
      if (!userId) return;
      pcatDoneMap.set(userId, entry.count);
    });

    const stageChangesMap = new Map<string, Map<string, number>>();
    stageChanges.forEach((entry) => {
      const userId = entry._id?.actionBy?.toString();
      const stage = this.formatStageName(entry._id?.stage?.toString());
      if (!userId) return;
      if (!stageChangesMap.has(userId)) stageChangesMap.set(userId, new Map());
      const userStageMap = stageChangesMap.get(userId)!;
      const current = userStageMap.get(stage) || 0;
      userStageMap.set(stage, current + entry.count);
    });

    const rows = userIdArray.map((userId) => {
      const user = usersById.get(userId) || { name: 'Unknown', email: null, employeeId: null, number: null };
      const sourceEntries = sourceMap.get(userId) || new Map();
      const campaignEntries = campaignMap.get(userId) || new Map();
      const stageEntries = stageChangesMap.get(userId) || new Map();
      const callEntry = callStatsMap.get(userId) || { totalDialed: 0, totalAnswered: 0, totalTalkTime: 0 };
      const orderEntry = orderStatsMap.get(userId) || { acceptedOrderCount: 0, acceptedRevenue: 0 };

      return {
        userId,
        name: user.name || 'Unknown',
        email: user.email || null,
        employeeId: user.employeeId || null,
        mobile: user.number || null,
        totalLeadAssigned: assignedLeadsMap.get(userId) || 0,
        totalNewLeadsAssigned: newLeadsMap.get(userId) || 0,
        totalDialedCalls: callEntry.totalDialed,
        totalTalkTime: callEntry.totalTalkTime,
        totalAnsweredCalls: callEntry.totalAnswered,
        sourceCounts: Array.from(sourceEntries.entries()).map(([source, count]) => ({ source, count })),
        sourceCampaignCounts: Array.from(campaignEntries.entries()).map(([campaign, count]) => ({ campaign, count })),
        pcatRegistered: pcatRegisteredMap.get(userId) || 0,
        pcatDone: pcatDoneMap.get(userId) || 0,
        stageChanges: Array.from(stageEntries.entries()).map(([stage, count]) => ({ stage, count })),
        acceptedOrderCount: orderEntry.acceptedOrderCount,
        acceptedRevenue: orderEntry.acceptedRevenue,
      };
    });

    return {
      startDate,
      endDate,
      totalUsers: rows.length,
      users: rows,
    };
  }
}
