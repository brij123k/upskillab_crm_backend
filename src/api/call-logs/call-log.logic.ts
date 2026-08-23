import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { CallLogData } from './call-log.data';
import { LeadHistoryLogic } from '../lead_management/lead-history/lead-history.logic';
import { LeadActionType } from 'src/schema/lead_management/lead-history.schema';
import { UserActivityLogic } from '../user-activity/user-activity.logic';
import { CallLogReview } from 'src/schema/all-log-review.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LeadLogic } from '../lead_management/lead/lead.logic';
import { UserLogic } from '../user/user.logic';
import { CallLog } from 'src/schema/call-log.schema';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { Order } from 'src/schema/order_Management/order.schema';
import { Pool } from 'src/schema/Pool.schema';
import { User } from 'src/schema/user.schema';
import { Role } from 'src/schema/role.schema';

@Injectable()
export class CallLogLogic {
  constructor(
    private readonly callLogData: CallLogData,
    private readonly leadHistoryLogic: LeadHistoryLogic,
    private readonly userActivityLogic: UserActivityLogic,
    private readonly leadLogic:LeadLogic,
    private readonly userLogic: UserLogic,

    @InjectModel(CallLogReview.name)
    private readonly model: Model<CallLogReview>,
    @InjectModel(CallLog.name) private callLogModel: Model<CallLog>,
    @InjectModel(Lead.name) private leadModel: Model<Lead>,
    @InjectModel(Order.name) private orderModel: Model<Order>,
    @InjectModel(Pool.name) private poolModel: Model<Pool>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Role.name) private roleModel: Model<Role>,
  ) {}

  private resolveLevel(level: any): number | null {
    if (level === undefined || level === null || String(level).trim() === '') {
      return 1;
    }

    const levelNumber = Number(level);
    return Number.isNaN(levelNumber) ? null : levelNumber;
  }

  private async getRoleIdsByLevel(level: any): Promise<Types.ObjectId[]> {
    const levelNumber = this.resolveLevel(level);
    if (levelNumber === null) return [];

    const roles = await this.roleModel.find({ level: levelNumber }).select('_id').lean();
    return roles.map((role) => role._id);
  }

  private async getUserIdsByRoleLevel(level: any): Promise<string[]> {
    const roleIds = await this.getRoleIdsByLevel(level);
    if (!roleIds.length) return [];

    const roleIdStrings = roleIds.map((roleId) => roleId.toString());

    const users = await this.userModel.aggregate([
      {
        $addFields: {
          normalizedRoleId: {
            $convert: {
              input: '$role',
              to: 'string',
              onError: null,
              onNull: null,
            },
          },
        },
      },
      {
        $match: {
          $or: [
            { role: { $in: roleIds } },
            { normalizedRoleId: { $in: roleIdStrings } },
          ],
        },
      },
      {
        $project: {
          _id: 1,
        },
      },
    ]);

    return users.map((user) => user._id.toString());
  }

  private formatLocalDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private getDayRange(baseDate = new Date()) {
    const start = new Date(baseDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(baseDate);
    end.setHours(23, 59, 59, 999);

    return { start, end };
  }

  private parseDate(value: any) {
    if (!value) return null;

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private normalizeDateInput(date: Date, boundary: 'start' | 'end') {
    const normalized = new Date(date);
    if (boundary === 'start') {
      normalized.setHours(0, 0, 0, 0);
    } else {
      normalized.setHours(23, 59, 59, 999);
    }
    return normalized;
  }

  private getUsersCallLogWindow(query: any) {
    const requestedFilter = String(query?.dateFilter || '').trim().toLowerCase();
    const fromDate = this.parseDate(query?.fromDate);
    const toDate = this.parseDate(query?.toDate);

    if (fromDate || toDate) {
      const start = this.normalizeDateInput(fromDate || toDate!, 'start');
      const end = this.normalizeDateInput(toDate || fromDate!, 'end');
      const normalizedStart = start <= end ? start : end;
      const normalizedEnd = start <= end ? end : start;

      const daySpan =
        Math.floor(
          (this.normalizeDateInput(normalizedEnd, 'end').getTime() -
            this.normalizeDateInput(normalizedStart, 'start').getTime()) /
            (1000 * 60 * 60 * 24),
        ) + 1;

      if (daySpan > 30) {
        throw new BadRequestException('Call log date range cannot exceed 30 days');
      }

      return {
        ...query,
        dateFilter: 'custom',
        fromDate: normalizedStart.toISOString(),
        toDate: normalizedEnd.toISOString(),
      };
    }

    const allowedFilters = ['today', 'week', 'month'];

    if (
      !requestedFilter ||
      allowedFilters.includes(requestedFilter)
    ) {
      return {
        ...query,
        dateFilter: requestedFilter || 'today',
      };
    }

    const { start, end } = this.getDayRange();
    start.setDate(start.getDate() - 29);

    return {
      ...query,
      dateFilter: 'custom',
      fromDate: start.toISOString(),
      toDate: end.toISOString(),
    };
  }

  async create(dto: any, currentUserId: string) {
    const { remark, ...callLogData } = dto;
     const callLog = await this.callLogData.create({
    ...callLogData,
    userId: dto.userId || currentUserId,
    startedAt: dto.startedAt || new Date(),
  });
  if(dto.stageId){
    this.leadLogic.changeStagebyLeadId(dto.leadId,dto.stageId,currentUserId)
  }

  // 2️⃣ Lead History
  await this.leadHistoryLogic.log({
    leadId: callLog.leadId.toString(),
    actionType: LeadActionType.CALL_LOG,
    actionBy: callLog.userId.toString(),
    changes: callLogData,
    reason:remark
  });

  // 3️⃣ User Activity
  await this.userActivityLogic.log({
    userId: callLog.userId.toString(),
    action: 'CALL_LOGGED',
    referenceType: 'LEAD',
    referenceId: callLog.leadId.toString(),
    meta: {
      message:"Call Log created",
      callLogData},
  });

  // 4️⃣ Create Review IF provided
  if (remark) {
    await this.createreview({
      leadId: callLog.leadId,
      callLogId: callLog._id,
      userId: callLog.userId,
      remark,
    });
  }

  return {
    message: 'Call log created successfully',
    callLogId: callLog._id,
    reviewAdded: !!remark,
  };
  }

async getByLead(leadId: number, user: any) {
  // 1️⃣ Get call logs
  const callLogs = await this.callLogData.findByLeadId(leadId);

  if (!callLogs.length) return [];

  // 2️⃣ Get remarks for all callLogs
  const callLogIds = callLogs.map((c) => c._id);

  const remarks = await this.findByCallLogIds(callLogIds);
  const remarkMap = new Map(
    remarks.map((r) => [
      r.callLogId.toString(),
      r.remark,
    ]),
  );

  // 3️⃣ Get lead info (name + phone)
  const lead = await this.leadLogic.getLeadByLeadId(leadId, user);

  // 4️⃣ Attach everything
  return callLogs.map((log) => ({
    ...log.toObject(),
    remark: remarkMap.get(log._id.toString()) || null,
    leadName: lead?.name || null,
    leadNumber:lead?.phone || null,
  }));
}

  async getByUser(filter: any, userId: string, user: any) {
  const result = await this.callLogData.findWithPagination(
    filter,
    userId,
  );

  if (!result.data.length) {
    return result;
  }

  // 1️⃣ Collect unique leadIds
  const leadIds = [
    ...new Set(result.data.map((log) => log.leadId)),
  ];

  // 2️⃣ Fetch all leads in one query
  const leads = await this.leadLogic.getLeadsByLeadIds(
    leadIds,
    user,
  );

  // 3️⃣ Create lookup map
  const leadMap = new Map(
    leads.map((l) => [
      l.leadId,
      { name: l.name, phone: l.phone },
    ]),
  );

  // 4️⃣ Attach lead info (NO toObject)
  const enrichedData = result.data.map((log) => {
    const lead = leadMap.get(log.leadId);

    return {
      ...log, // ✅ aggregation result = plain object
      leadName: lead?.name || null,
      leadNumber: lead?.phone || null,
    };
  });

  return {
    ...result,
    data: enrichedData,
  };
}

async getByUsers(filter: any, user: any) {
  const normalizedFilter = this.getUsersCallLogWindow(filter);
  console.log(normalizedFilter)
  const loggedInUserId = (
    user._id || user.userId
  ).toString();

  const group =
    String(normalizedFilter.group).toLowerCase() === 'true';

  const team =
    String(normalizedFilter.team).toLowerCase() === 'true';

  // =========================================================
  // 1. GROUP = TRUE + TEAM = TRUE
  //
  // filter.userId is the ROOT USER
  //
  // Example:
  //
  // userId = Manager A
  // team   = true
  // group  = true
  //
  // Result:
  // Manager A
  //   ├── User 1
  //   ├── User 2
  //   └── User 3
  // =========================================================

  if (group && team) {
    const teamUserId = normalizedFilter.byUserId;

    if (!teamUserId) {
      return this.callLogData.findAllWithUserIds(
        normalizedFilter,
        [loggedInUserId],
      );
    }
    const user = await this.userLogic.findById(teamUserId)
    if(!user){
      throw new NotFoundException("User Not Found")
    }
    console.log(user)
    const users = await this.userLogic.getUsersUnder(
      user,
    );
    const accessibleUserIds = users.map(
      (u: any) => u._id.toString(),
    );

    // Include the selected/root user itself
    accessibleUserIds.push(
      teamUserId.toString(),
    );

    const uniqueUserIds = [
      ...new Set(accessibleUserIds),
    ];

    // IMPORTANT:
    // Do NOT let byUserId override the hierarchy.
    const hierarchyFilter = {
      ...normalizedFilter,
      byUserId: undefined,
    };

    return this.callLogData.findAllWithUserIds(
      hierarchyFilter,
      uniqueUserIds,
    );
  }

  // =========================================================
  // 2. GROUP = TRUE + TEAM = FALSE
  //
  // Current logged-in user is the ROOT USER
  //
  // Result:
  //
  // Current User
  //   ├── User 1
  //   ├── User 2
  //   └── User 3
  // =========================================================

  if (group) {
    const users = await this.userLogic.getUsersUnder(
      user,
    );

    const accessibleUserIds = users.map(
      (u: any) => u._id.toString(),
    );

    // Include current logged-in user
    accessibleUserIds.push(
      loggedInUserId,
    );

    const uniqueUserIds = [
      ...new Set(accessibleUserIds),
    ];

    return this.callLogData.findAllWithUserIds(
      normalizedFilter,
      uniqueUserIds,
    );
  }

  // =========================================================
  // 3. GROUP = FALSE
  //
  // Always return ONLY current logged-in user's data
  // =========================================================

  return this.callLogData.findAllWithUserIds(
    normalizedFilter,
    [loggedInUserId],
  );
}

async getreviewbycallId(callId: string, user: any): Promise<any> {
  const exist = await this.callLogData.findById(callId);
  if (!exist) {
    throw new NotFoundException("call Log not Found");
  }

  const log = await this.model.findOne({
    callLogId: new Types.ObjectId(callId),
  });

  if (!log) {
    throw new NotFoundException("Log review not found");
  }

  const leaddetail = await this.leadLogic.getLeadByLeadId(log.leadId, user);

  return {
    ...log.toObject(),   // 🔥 IMPORTANT
    leaddetail,
  };
}

  async update(id: string, dto: any, currentUserId: string) {
    const existing = await this.callLogData.findById(id);
    if (!existing) throw new NotFoundException('Call log not found');

    const updated = await this.callLogData.update(id, dto);
      if(dto.stageId){
    this.leadLogic.changeStagebyLeadId(dto.leadId,dto.stageId,currentUserId)
  }
    await this.userActivityLogic.log({
      userId: currentUserId,
      action: 'CALL_LOG_UPDATED',
      referenceType: 'CALL_LOG',
      referenceId: id,
      meta: { from: existing, to: updated },
    });


    return updated;
  }

  async delete(id: string, currentUserId: string) {
    const deleted = await this.callLogData.delete(id);
    if (!deleted) throw new NotFoundException('Call log not found');

    await this.userActivityLogic.log({
      userId: currentUserId,
      action: 'CALL_LOG_DELETED',
      referenceType: 'CALL_LOG',
      referenceId: id,
    });

    return { message: 'Call log deleted successfully' };
  }



  createreview(data: any) {
    return this.model.create(data);
  }

  findByCallLogIds(callLogIds: any) {
    return this.model.find({
      callLogId: { $in: callLogIds },
    });
  }

  async employeePoolDailyUtilizationReport(query: any) {
    const now = new Date();
    let startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    let endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    if (query.dateFilter) {
      const filter = query.dateFilter.toString().toLowerCase();
      if (filter === 'today') {
        startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
      }
    }

    const fromProvided = Boolean(query.fromDate);
    const toProvided = Boolean(query.toDate);

    if (fromProvided) {
      const from = new Date(query.fromDate);
      if (!Number.isNaN(from.getTime())) {
        startDate = new Date(from);
        startDate.setHours(0, 0, 0, 0);
        if (!toProvided) {
          endDate = new Date(from);
          endDate.setHours(23, 59, 59, 999);
        }
      }
    }

    if (toProvided) {
      const to = new Date(query.toDate);
      if (!Number.isNaN(to.getTime())) {
        endDate = new Date(to);
        endDate.setHours(23, 59, 59, 999);
        if (!fromProvided) {
          startDate = new Date(to);
          startDate.setHours(0, 0, 0, 0);
        }
      }
    }

    if (startDate > endDate) {
      const temp = startDate;
      startDate = endDate;
      endDate = temp;
    }

    const diffDays = Math.ceil(
      Math.abs(endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    ) + 1;
    if (diffDays > 5) {
      throw new BadRequestException('Maximum 5 days allowed for daily utilization report');
    }

    const levelNumber = this.resolveLevel(query.level);
    if (levelNumber === null) {
      return {
        startDate,
        endDate,
        dateStrings: [],
        employees: [],
      };
    }

    let allowedUserIds = await this.getUserIdsByRoleLevel(levelNumber);
    if (!allowedUserIds.length) {
      return {
        startDate,
        endDate,
        dateStrings: [],
        employees: [],
      };
    }

    if (query.counsellorId) {
      const counsellorId = String(query.counsellorId);
      if (!allowedUserIds.includes(counsellorId)) {
        return {
          startDate,
          endDate,
          dateStrings: [],
          employees: [],
        };
      }
      allowedUserIds = [counsellorId];
    }

    const allowedUserIdSet = new Set(allowedUserIds);
    const allowedUserIdStrings = Array.from(allowedUserIdSet);
    const buildAllowedMatch = (fieldPath: string) => ({
      $expr: {
        $in: [
          {
            $convert: {
              input: fieldPath,
              to: 'string',
              onError: null,
              onNull: null,
            },
          },
          allowedUserIdStrings,
        ],
      },
    });

    // Pool filter is optional
    let poolId: Types.ObjectId | null = null;
    let pool: any = null;

    if (query.poolId) {
      poolId = new Types.ObjectId(query.poolId);
      pool = await this.poolModel.findById(poolId).lean();
      if (!pool) {
        throw new BadRequestException('Pool not found');
      }
    }

    // Generate array of dates between startDate and endDate
    const dates: Date[] = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d));
    }

    const allEmployees = new Set<string>(allowedUserIdStrings);
    const dailyMetrics = new Map<string, any>(); // key: "dateString_employeeId"

    for (const date of dates) {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      // Call dials and talk time (always fetch)
      const callMatch: any = {
        createdAt: { $gte: dayStart, $lte: dayEnd },
        ...buildAllowedMatch('$userId'),
      };

      const calls = await this.callLogModel.aggregate([
        { $match: callMatch },
        {
          $group: {
            _id: {
              $convert: {
                input: '$userId',
                to: 'string',
                onError: null,
                onNull: null,
              },
            },
            dialCount: { $sum: 1 },
            answeredCount: {
              $sum: {
                $cond: [{ $gt: ['$duration', 0] }, 1, 0],
              },
            },
            talkTime: {
              $sum: {
                $cond: [{ $gt: ['$duration', 0] }, '$duration', 0],
              },
            },
          },
        },
      ]);

      calls.forEach((call) => {
        if (!call._id) return;
        const employeeId = call._id.toString();
        allEmployees.add(employeeId);
        const dateStr = this.formatLocalDate(date);
        const key = `${dateStr}_${employeeId}`;
        const existing = dailyMetrics.get(key) || {};
        existing.dial = call.dialCount;
        existing.answered = call.answeredCount;
        existing.talkTime = call.talkTime;
        dailyMetrics.set(key, existing);
      });

      // If poolId filter is provided, fetch pool-related data
      if (poolId) {
        // Lead assignments for this pool
        const leadMatch: any = {
          poolId: poolId,
          createdAt: { $gte: dayStart, $lte: dayEnd },
          ...buildAllowedMatch('$assignedTo'),
        }

        const leads = await this.leadModel.aggregate([
          { $match: leadMatch },
          {
            $group: {
              _id: {
                $convert: {
                  input: '$assignedTo',
                  to: 'string',
                  onError: null,
                  onNull: null,
                },
              },
              leadCount: { $sum: 1 },
            },
          },
        ]);

        leads.forEach((lead) => {
          const employeeId = lead._id?.toString();
          if (!employeeId) return;
          allEmployees.add(employeeId);
          const dateStr = this.formatLocalDate(date);
          const key = `${dateStr}_${employeeId}`;
          const existing = dailyMetrics.get(key) || {};
          existing.lead = lead.leadCount;
          dailyMetrics.set(key, existing);
        });

        // PCAT scheduled
        const pcatScheduledMatch: any = {
          poolId: poolId,
          createdAt: { $gte: dayStart, $lte: dayEnd },
          ...buildAllowedMatch('$assignedTo'),
          pcatScheduledDate: { $exists: true, $ne: null },
        };

        const pcatScheduled = await this.leadModel.aggregate([
          { $match: pcatScheduledMatch },
          {
            $group: {
              _id: {
                $convert: {
                  input: '$assignedTo',
                  to: 'string',
                  onError: null,
                  onNull: null,
                },
              },
              pcatScheduledCount: { $sum: 1 },
            },
          },
        ]);

        pcatScheduled.forEach((item) => {
          const employeeId = item._id?.toString();
          if (!employeeId) return;
          allEmployees.add(employeeId);
          const dateStr = this.formatLocalDate(date);
          const key = `${dateStr}_${employeeId}`;
          const existing = dailyMetrics.get(key) || {};
          existing.pcatScheduled = item.pcatScheduledCount;
          dailyMetrics.set(key, existing);
        });

        // PCAT done
        const pcatDoneMatch: any = {
          poolId: poolId,
          createdAt: { $gte: dayStart, $lte: dayEnd },
          ...buildAllowedMatch('$assignedTo'),
          pcatDoneDate: { $exists: true, $ne: null },
        };

        const pcatDone = await this.leadModel.aggregate([
          { $match: pcatDoneMatch },
          {
            $group: {
              _id: {
                $convert: {
                  input: '$assignedTo',
                  to: 'string',
                  onError: null,
                  onNull: null,
                },
              },
              pcatDoneCount: { $sum: 1 },
            },
          },
        ]);

        pcatDone.forEach((item) => {
          const employeeId = item._id?.toString();
          if (!employeeId) return;
          allEmployees.add(employeeId);
          const dateStr = this.formatLocalDate(date);
          const key = `${dateStr}_${employeeId}`;
          const existing = dailyMetrics.get(key) || {};
          existing.pcatDone = item.pcatDoneCount;
          dailyMetrics.set(key, existing);
        });

        // Registration done
        const registrationMatch: any = {
          courseVertical: poolId,
          orderDate: { $gte: dayStart, $lte: dayEnd },
          registrationAmount: { $gt: 0 },
          ...buildAllowedMatch('$counsellorId'),
        };

        const registrations = await this.orderModel.aggregate([
          { $match: registrationMatch },
          {
            $group: {
              _id: {
                $convert: {
                  input: '$counsellorId',
                  to: 'string',
                  onError: null,
                  onNull: null,
                },
              },
              registrationCount: { $sum: 1 },
            },
          },
        ]);

        registrations.forEach((item) => {
          const employeeId = item._id?.toString();
          if (!employeeId) return;
          allEmployees.add(employeeId);
          const dateStr = this.formatLocalDate(date);
          const key = `${dateStr}_${employeeId}`;
          const existing = dailyMetrics.get(key) || {};
          existing.registrationDone = item.registrationCount;
          dailyMetrics.set(key, existing);
        });

        // Admission done
        const admissionMatch: any = {
          courseVertical: poolId,
          orderDate: { $gte: dayStart, $lte: dayEnd },
          Approved: true,
          ...buildAllowedMatch('$counsellorId'),
        };

        const admissions = await this.orderModel.aggregate([
          { $match: admissionMatch },
          {
            $group: {
              _id: {
                $convert: {
                  input: '$counsellorId',
                  to: 'string',
                  onError: null,
                  onNull: null,
                },
              },
              admissionCount: { $sum: 1 },
            },
          },
        ]);

        admissions.forEach((item) => {
          const employeeId = item._id?.toString();
          if (!employeeId) return;
          allEmployees.add(employeeId);
          const dateStr = this.formatLocalDate(date);
          const key = `${dateStr}_${employeeId}`;
          const existing = dailyMetrics.get(key) || {};
          existing.admissionDone = item.admissionCount;
          dailyMetrics.set(key, existing);
        });
      }
    }

    // Fetch user data for all allowed employees
    const users = allowedUserIds.length
      ? await this.userModel
          .find({ _id: { $in: allowedUserIds.map((id) => new Types.ObjectId(id)) } })
          .select('name email number employeeId role createdAt')
          .lean()
      : [];

    const roleIds = Array.from(new Set(users.map((u) => u.role?.toString()).filter(Boolean)));
    const roles = roleIds.length
      ? await this.roleModel.find({ _id: { $in: roleIds.map((id) => new Types.ObjectId(id)) } }).select('name').lean()
      : [];

    const rolesById = new Map(roles.map((r) => [r._id.toString(), r.name]));
    const usersById = new Map(users.map((u) => [u._id.toString(), u]));

    const calculateVintage = (createdAt?: Date) => {
      if (!createdAt) return null;
      const start = new Date(createdAt);
      const diff = now.getTime() - start.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      if (days >= 365) {
        const years = Math.floor(days / 365);
        const remainingDays = days % 365;
        if (remainingDays === 0) return `${years}Y`;
        return `${years}Y ${remainingDays}D`;
      }
      return `${days}D`;
    };

    // Build rows with employees and columns with daily metrics
    const dateStrings = dates.map((d) => this.formatLocalDate(d)).reverse(); // Most recent first

    const employees = Array.from(allEmployees).map((employeeId) => {
      const user = usersById.get(employeeId);
      const roleName = user?.role ? rolesById.get(user.role.toString()) : null;
      const vintage = calculateVintage(user?.createdAt);

      const metrics = dateStrings.map((dateStr) => {
        const key = `${dateStr}_${employeeId}`;
        const metric = dailyMetrics.get(key) || {};
        const row: any = {
          date: dateStr,
          dial: metric.dial || 0,
          answered: metric.answered || 0,
          talkTime: metric.talkTime || 0,
        };

        // Add pool-related metrics if pool filter is applied
        if (poolId) {
          row.lead = metric.lead || 0;
          row.pcatScheduled = metric.pcatScheduled || 0;
          row.pcatDone = metric.pcatDone || 0;
          row.registrationDone = metric.registrationDone || 0;
          row.admissionDone = metric.admissionDone || 0;
        }

        return row;
      });

      const row: any = {
        employeeId,
        employeeName: user?.name || 'Unknown',
        designation: roleName || null,
        vintage,
        dailyMetrics: metrics,
      };

      return row;
    });

    const response: any = {
      startDate,
      endDate,
      dateStrings,
      employees: employees.sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || '')),
    };

    // Add pool info if filter is applied
    if (pool) {
      response.pool = {
        poolId: pool._id.toString(),
        poolName: pool.name,
      };
    }

    return response;
  }

//   async getWithReviews(filters: any, userId?: string) {
//   const result = await this.callLogData.findWithPagination(
//     filters,
//     userId,
//   );

//   const callLogIds = result.data.map((c) => c._id.toString());

//   const reviews =
//     await this.callLogReviewData.findByCallLogIds(
//       callLogIds,
//     );

//   const reviewMap = new Map(
//     reviews.map((r) => [
//       r.callLogId.toString(),
//       r,
//     ]),
//   );

//   const finalData = result.data.map((log) => ({
//     ...log.toObject(),
//     review: reviewMap.get(log._id.toString()) || null,
//   }));

//   return {
//     ...result,
//     data: finalData,
//   };
// }
}
