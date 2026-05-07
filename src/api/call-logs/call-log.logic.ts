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

async getByLead(leadId: number) {
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
  const lead = await this.leadLogic.getLeadByLeadId(leadId);

  // 4️⃣ Attach everything
  return callLogs.map((log) => ({
    ...log.toObject(),
    remark: remarkMap.get(log._id.toString()) || null,
    leadName: lead?.name || null,
    leadNumber:lead?.phone || null,
  }));
}

  async getByUser(filter: any, userId: string) {
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

async getByUsers(filter: any, user: any){
  const userId = user._id || user.userId;
  if(filter.group=='true'){
    let users: any[] = [];
    users = await this.userLogic.getUsersUnder(user);
    const accessibleUserIds = users.map((u) => u._id.toString());
    accessibleUserIds.push(userId)
    if (!accessibleUserIds || !accessibleUserIds.length) {
      return this.callLogData.findAllWithUserIds(
        filter,
        [userId],
      );
    }
    // 🔥 Apply hierarchy filter
    return this.callLogData.findAllWithUserIds(
      filter,
      accessibleUserIds,
    );
  }else{
  const result = await this.callLogData.findCallLogWithPagination(
    filter,
    userId,
  );
  return result
  }
}

async getreviewbycallId(callId: string): Promise<any> {
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

  const leaddetail = await this.leadLogic.getLeadByLeadId(log.leadId);

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
      } else if (filter === 'week') {
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 6);
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

    const allEmployees = new Set<string>();
    const dailyMetrics = new Map<string, any>(); // key: "dateString_employeeId"

    for (const date of dates) {
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      // Call dials and talk time (always fetch)
      const callMatch: any = {
        createdAt: { $gte: dayStart, $lte: dayEnd },
        userId: { $exists: true, $ne: null },
      };
      if (query.counsellorId) {
        callMatch.userId = query.counsellorId;
      }

      const calls = await this.callLogModel.aggregate([
        { $match: callMatch },
        {
          $group: {
            _id: '$userId',
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
        const dateStr = date.toISOString().split('T')[0];
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
          assignedTo: { $ne: null },
        };
        if (query.counsellorId) {
          leadMatch.assignedTo = query.counsellorId;
        }

        const leads = await this.leadModel.aggregate([
          { $match: leadMatch },
          {
            $group: {
              _id: '$assignedTo',
              leadCount: { $sum: 1 },
            },
          },
        ]);

        leads.forEach((lead) => {
          const employeeId = lead._id?.toString();
          if (!employeeId) return;
          allEmployees.add(employeeId);
          const dateStr = date.toISOString().split('T')[0];
          const key = `${dateStr}_${employeeId}`;
          const existing = dailyMetrics.get(key) || {};
          existing.lead = lead.leadCount;
          dailyMetrics.set(key, existing);
        });

        // PCAT scheduled
        const pcatScheduledMatch: any = {
          poolId: poolId,
          createdAt: { $gte: dayStart, $lte: dayEnd },
          assignedTo: { $ne: null },
          pcatScheduledDate: { $exists: true, $ne: null },
        };
        if (query.counsellorId) {
          pcatScheduledMatch.assignedTo = query.counsellorId;
        }

        const pcatScheduled = await this.leadModel.aggregate([
          { $match: pcatScheduledMatch },
          {
            $group: {
              _id: '$assignedTo',
              pcatScheduledCount: { $sum: 1 },
            },
          },
        ]);

        pcatScheduled.forEach((item) => {
          const employeeId = item._id?.toString();
          if (!employeeId) return;
          allEmployees.add(employeeId);
          const dateStr = date.toISOString().split('T')[0];
          const key = `${dateStr}_${employeeId}`;
          const existing = dailyMetrics.get(key) || {};
          existing.pcatScheduled = item.pcatScheduledCount;
          dailyMetrics.set(key, existing);
        });

        // PCAT done
        const pcatDoneMatch: any = {
          poolId: poolId,
          createdAt: { $gte: dayStart, $lte: dayEnd },
          assignedTo: { $ne: null },
          pcatDoneDate: { $exists: true, $ne: null },
        };
        if (query.counsellorId) {
          pcatDoneMatch.assignedTo = query.counsellorId;
        }

        const pcatDone = await this.leadModel.aggregate([
          { $match: pcatDoneMatch },
          {
            $group: {
              _id: '$assignedTo',
              pcatDoneCount: { $sum: 1 },
            },
          },
        ]);

        pcatDone.forEach((item) => {
          const employeeId = item._id?.toString();
          if (!employeeId) return;
          allEmployees.add(employeeId);
          const dateStr = date.toISOString().split('T')[0];
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
        };
        if (query.counsellorId) {
          registrationMatch.counsellorId = query.counsellorId;
        }

        const registrations = await this.orderModel.aggregate([
          { $match: registrationMatch },
          {
            $group: {
              _id: '$counsellorId',
              registrationCount: { $sum: 1 },
            },
          },
        ]);

        registrations.forEach((item) => {
          const employeeId = item._id?.toString();
          if (!employeeId) return;
          allEmployees.add(employeeId);
          const dateStr = date.toISOString().split('T')[0];
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
        };
        if (query.counsellorId) {
          admissionMatch.counsellorId = query.counsellorId;
        }

        const admissions = await this.orderModel.aggregate([
          { $match: admissionMatch },
          {
            $group: {
              _id: '$counsellorId',
              admissionCount: { $sum: 1 },
            },
          },
        ]);

        admissions.forEach((item) => {
          const employeeId = item._id?.toString();
          if (!employeeId) return;
          allEmployees.add(employeeId);
          const dateStr = date.toISOString().split('T')[0];
          const key = `${dateStr}_${employeeId}`;
          const existing = dailyMetrics.get(key) || {};
          existing.admissionDone = item.admissionCount;
          dailyMetrics.set(key, existing);
        });
      }
    }

    // Fetch user data for all employees
    const userIds = Array.from(allEmployees).map((id) => new Types.ObjectId(id));
    const users = userIds.length
      ? await this.userModel
          .find({ _id: { $in: userIds } })
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
    const dateStrings = dates.map((d) => d.toISOString().split('T')[0]).reverse(); // Most recent first

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
