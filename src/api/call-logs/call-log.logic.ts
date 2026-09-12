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

private async getUserAndSubordinateIds(userId: string): Promise<string[]> {
    try {
      const users = await this.userLogic.getUsersUnder({
        userId,
        roleName: 'user',
      });

      const ids = users
        .map((user: any) => user?._id?.toString?.())
        .filter(Boolean);

      ids.push(userId);
      return [...new Set(ids)];
    } catch {
      return [userId];
    }
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

  let startDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
  );

  let endDate = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );

  if (query.dateFilter) {
    const filter =
      String(
        query.dateFilter,
      ).toLowerCase();

    if (filter === 'today') {
      startDate = new Date(now);
      startDate.setHours(
        0,
        0,
        0,
        0,
      );

      endDate = new Date(now);
      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    }
  }

  const fromProvided =
    Boolean(query.fromDate);

  const toProvided =
    Boolean(query.toDate);

  if (fromProvided) {
    const from =
      new Date(query.fromDate);

    if (
      !Number.isNaN(
        from.getTime(),
      )
    ) {
      startDate =
        new Date(from);

      startDate.setHours(
        0,
        0,
        0,
        0,
      );

      if (!toProvided) {
        endDate =
          new Date(from);

        endDate.setHours(
          23,
          59,
          59,
          999,
        );
      }
    }
  }

  if (toProvided) {
    const to =
      new Date(query.toDate);

    if (
      !Number.isNaN(
        to.getTime(),
      )
    ) {
      endDate =
        new Date(to);

      endDate.setHours(
        23,
        59,
        59,
        999,
      );

      if (!fromProvided) {
        startDate =
          new Date(to);

        startDate.setHours(
          0,
          0,
          0,
          0,
        );
      }
    }
  }

  if (startDate > endDate) {
    const temp =
      startDate;

    startDate =
      endDate;

    endDate =
      temp;
  }

  const diffDays =
    Math.ceil(
      Math.abs(
        endDate.getTime() -
          startDate.getTime(),
      ) /
        (
          1000 *
          60 *
          60 *
          24
        ),
    );

  if (diffDays > 5) {
    throw new BadRequestException(
      'Maximum 5 days allowed for daily utilization report',
    );
  }

  const levelNumber =
    this.resolveLevel(
      query.level,
    );

  if (levelNumber === null) {
    return {
      startDate,
      endDate,
      dateStrings: [],
      employees: [],
    };
  }

  let rootUserIds =
    await this.getUserIdsByRoleLevel(
      levelNumber,
    );

  if (!rootUserIds.length) {
    return {
      startDate,
      endDate,
      dateStrings: [],
      employees: [],
    };
  }

  if (query.counsellorId) {
    const counsellorId =
      String(
        query.counsellorId,
      );

    if (
      !rootUserIds.includes(
        counsellorId,
      )
    ) {
      return {
        startDate,
        endDate,
        dateStrings: [],
        employees: [],
      };
    }

    rootUserIds = [
      counsellorId,
    ];
  }

  const rootUsers =
    await this.userModel
      .find({
        _id: {
          $in: rootUserIds.map(
            (id) =>
              new Types.ObjectId(
                id,
              ),
          ),
        },

        status: 'active',
      })
      .select(
        'name email number employeeId role createdAt',
      )
      .lean();

  if (!rootUsers.length) {
    return {
      startDate,
      endDate,
      dateStrings: [],
      employees: [],
    };
  }

  const isTeam =
    query.team === true ||
    query.team === 'true';

  // =========================================================
  // BUILD TEAM MAP
  // =========================================================

  const teamMap =
    new Map<
      string,
      string[]
    >();

  for (
    const user of rootUsers
  ) {
    const rootId =
      user._id.toString();

    if (!isTeam) {
      teamMap.set(
        rootId,
        [rootId],
      );

      continue;
    }

    const subordinateIds =
      await this.getUserAndSubordinateIds(
        rootId,
      );

    const allIds = [
      rootId,
      ...subordinateIds.map(
        (id: any) =>
          id.toString(),
      ),
    ];

    const uniqueIds = [
      ...new Set(allIds),
    ];

    const activeUsers =
      await this.userModel
        .find({
          _id: {
            $in: uniqueIds.map(
              (id) =>
                new Types.ObjectId(
                  id,
                ),
            ),
          },

          status: 'active',
        })
        .select('_id')
        .lean();

    const activeIds =
      activeUsers.map(
        (user) =>
          user._id.toString(),
      );

    // Always include root user
    if (
      !activeIds.includes(
        rootId,
      )
    ) {
      activeIds.push(
        rootId,
      );
    }

    teamMap.set(
      rootId,
      [
        ...new Set(
          activeIds,
        ),
      ],
    );
  }

  const allAllowedUserIds = [
    ...new Set(
      Array.from(
        teamMap.values(),
      ).flat(),
    ),
  ];

  const buildAllowedMatch = (
    fieldPath: string,
  ) => ({
    $expr: {
      $in: [
        {
          $convert: {
            input:
              fieldPath,

            to: 'string',

            onError:
              null,

            onNull:
              null,
          },
        },

        allAllowedUserIds,
      ],
    },
  });

  // =========================================================
  // DATES
  // =========================================================

  const dates: Date[] = [];

  for (
    let d =
      new Date(startDate);
    d <= endDate;
    d.setDate(
      d.getDate() + 1,
    )
  ) {
    dates.push(
      new Date(d),
    );
  }

  // key:
  // date_employeeId
  const dailyMetrics =
    new Map<
      string,
      any
    >();

  // =========================================================
  // FETCH DAILY DATA
  // =========================================================

  for (
    const date of dates
  ) {
    const dayStart =
      new Date(date);

    dayStart.setHours(
      0,
      0,
      0,
      0,
    );

    const dayEnd =
      new Date(date);

    dayEnd.setHours(
      23,
      59,
      59,
      999,
    );

    const dateStr =
      this.formatLocalDate(
        date,
      );

    // =======================================================
    // CALLS
    // =======================================================

    const calls =
      await this.callLogModel.aggregate([
        {
          $match: {
            createdAt: {
              $gte:
                dayStart,
              $lte:
                dayEnd,
            },

            ...buildAllowedMatch(
              '$userId',
            ),
          },
        },

        {
          $group: {
            _id: {
              $convert: {
                input:
                  '$userId',

                to: 'string',

                onError:
                  null,

                onNull:
                  null,
              },
            },

            dial: {
              $sum: 1,
            },

            answered: {
              $sum: {
                $cond: [
                  {
                    $gt: [
                      '$duration',
                      0,
                    ],
                  },

                  1,

                  0,
                ],
              },
            },

            talkTime: {
              $sum: {
                $cond: [
                  {
                    $gt: [
                      '$duration',
                      0,
                    ],
                  },

                  '$duration',

                  0,
                ],
              },
            },
          },
        },
      ]);

    calls.forEach(
      (item) => {
        if (!item._id) {
          return;
        }

        const employeeId =
          item._id.toString();

        const key =
          `${dateStr}_${employeeId}`;

        const existing =
          dailyMetrics.get(
            key,
          ) || {};

        existing.dial =
          item.dial || 0;

        existing.answered =
          item.answered || 0;

        existing.talkTime =
          item.talkTime || 0;

        dailyMetrics.set(
          key,
          existing,
        );
      },
    );

    // =======================================================
    // LEADS
    // =======================================================

    const leads =
      await this.leadModel.aggregate([
        {
          $addFields: {
            normalizedAssignedTo: {
              $convert: {
                input:
                  '$assignedTo',

                to: 'string',

                onError:
                  null,

                onNull:
                  null,
              },
            },
          },
        },

        {
          $match: {
            assignedDate: {
              $gte:
                dayStart,
              $lte:
                dayEnd,
            },

            normalizedAssignedTo: {
              $in:
                allAllowedUserIds,
            },
          },
        },

        {
          $group: {
            _id:
              '$normalizedAssignedTo',

            lead: {
              $sum: 1,
            },
          },
        },
      ]);

    leads.forEach(
      (item) => {
        if (!item._id) {
          return;
        }

        const employeeId =
          item._id.toString();

        const key =
          `${dateStr}_${employeeId}`;

        const existing =
          dailyMetrics.get(
            key,
          ) || {};

        existing.lead =
          item.lead || 0;

        dailyMetrics.set(
          key,
          existing,
        );
      },
    );

    // =======================================================
    // PCAT SCHEDULED
    // =======================================================

    const pcatScheduled =
      await this.leadModel.aggregate([
        {
          $addFields: {
            normalizedAssignedTo: {
              $convert: {
                input:
                  '$assignedTo',

                to: 'string',

                onError:
                  null,

                onNull:
                  null,
              },
            },
          },
        },

        {
          $match: {
            pcatScheduledDate: {
              $gte:
                dayStart,
              $lte:
                dayEnd,
            },

            normalizedAssignedTo: {
              $in:
                allAllowedUserIds,
            },
          },
        },

        {
          $group: {
            _id:
              '$normalizedAssignedTo',

            pcatScheduled: {
              $sum: 1,
            },
          },
        },
      ]);

    pcatScheduled.forEach(
      (item) => {
        if (!item._id) {
          return;
        }

        const employeeId =
          item._id.toString();

        const key =
          `${dateStr}_${employeeId}`;

        const existing =
          dailyMetrics.get(
            key,
          ) || {};

        existing.pcatScheduled =
          item.pcatScheduled || 0;

        dailyMetrics.set(
          key,
          existing,
        );
      },
    );

    // =======================================================
    // PCAT DONE
    // =======================================================

    const pcatDone =
      await this.leadModel.aggregate([
        {
          $addFields: {
            normalizedAssignedTo: {
              $convert: {
                input:
                  '$assignedTo',

                to: 'string',

                onError:
                  null,

                onNull:
                  null,
              },
            },
          },
        },

        {
          $match: {
            pcatDoneDate: {
              $gte:
                dayStart,
              $lte:
                dayEnd,
            },

            normalizedAssignedTo: {
              $in:
                allAllowedUserIds,
            },
          },
        },

        {
          $group: {
            _id:
              '$normalizedAssignedTo',

            pcatDone: {
              $sum: 1,
            },
          },
        },
      ]);

    pcatDone.forEach(
      (item) => {
        if (!item._id) {
          return;
        }

        const employeeId =
          item._id.toString();

        const key =
          `${dateStr}_${employeeId}`;

        const existing =
          dailyMetrics.get(
            key,
          ) || {};

        existing.pcatDone =
          item.pcatDone || 0;

        dailyMetrics.set(
          key,
          existing,
        );
      },
    );

    // =======================================================
    // REGISTRATION
    // =======================================================

    const registrations =
      await this.orderModel.aggregate([
        {
          $addFields: {
            normalizedCounsellorId: {
              $convert: {
                input:
                  '$counsellorId',

                to: 'string',

                onError:
                  null,

                onNull:
                  null,
              },
            },
          },
        },

        {
          $match: {
            orderDate: {
              $gte:
                dayStart,
              $lte:
                dayEnd,
            },

            registrationAmount: {
              $gt: 0,
            },

            normalizedCounsellorId: {
              $in:
                allAllowedUserIds,
            },
          },
        },

        {
          $group: {
            _id:
              '$normalizedCounsellorId',

            registrationDone: {
              $sum: 1,
            },
          },
        },
      ]);

    registrations.forEach(
      (item) => {
        if (!item._id) {
          return;
        }

        const employeeId =
          item._id.toString();

        const key =
          `${dateStr}_${employeeId}`;

        const existing =
          dailyMetrics.get(
            key,
          ) || {};

        existing.registrationDone =
          item.registrationDone || 0;

        dailyMetrics.set(
          key,
          existing,
        );
      },
    );

    // =======================================================
    // ADMISSION
    // =======================================================

    const admissions =
      await this.orderModel.aggregate([
        {
          $addFields: {
            normalizedCounsellorId: {
              $convert: {
                input:
                  '$counsellorId',

                to: 'string',

                onError:
                  null,

                onNull:
                  null,
              },
            },
          },
        },

        {
          $match: {
            orderDate: {
              $gte:
                dayStart,
              $lte:
                dayEnd,
            },

            Approved: true,

            normalizedCounsellorId: {
              $in:
                allAllowedUserIds,
            },
          },
        },

        {
          $group: {
            _id:
              '$normalizedCounsellorId',

            admissionDone: {
              $sum: 1,
            },
          },
        },
      ]);

    admissions.forEach(
      (item) => {
        if (!item._id) {
          return;
        }

        const employeeId =
          item._id.toString();

        const key =
          `${dateStr}_${employeeId}`;

        const existing =
          dailyMetrics.get(
            key,
          ) || {};

        existing.admissionDone =
          item.admissionDone || 0;

        dailyMetrics.set(
          key,
          existing,
        );
      },
    );
  }

  // =========================================================
  // ROLES
  // =========================================================

  const roleIds = [
    ...new Set(
      rootUsers
        .map(
          (user) =>
            user.role?.toString(),
        )
        .filter(Boolean),
    ),
  ];

  const roles =
    roleIds.length
      ? await this.roleModel
          .find({
            _id: {
              $in:
                roleIds.map(
                  (id) =>
                    new Types.ObjectId(
                      id,
                    ),
                ),
            },
          })
          .select('name')
          .lean()
      : [];

  const rolesById =
    new Map(
      roles.map(
        (role) => [
          role._id.toString(),
          role.name,
        ],
      ),
    );

  // =========================================================
  // VINTAGE
  // =========================================================

  const calculateVintage = (
    createdAt?: Date,
  ) => {
    if (!createdAt) {
      return null;
    }

    const diff =
      now.getTime() -
      new Date(
        createdAt,
      ).getTime();

    const days =
      Math.floor(
        diff /
          (
            1000 *
            60 *
            60 *
            24
          ),
      );

    if (days >= 365) {
      const years =
        Math.floor(
          days / 365,
        );

      const remainingDays =
        days % 365;

      return remainingDays === 0
        ? `${years}Y`
        : `${years}Y ${remainingDays}D`;
    }

    return `${days}D`;
  };

  const dateStrings =
    dates
      .map(
        (date) =>
          this.formatLocalDate(
            date,
          ),
      )
      .reverse();

  // =========================================================
  // RESPONSE
  // =========================================================

  const employees =
    rootUsers
      .map((user) => {
        const rootId =
          user._id.toString();

        const memberIds =
          teamMap.get(
            rootId,
          ) || [rootId];

        const metrics =
          dateStrings.map(
            (dateStr) => {
              const combined = {
                date: dateStr,
                dial: 0,
                answered: 0,
                talkTime: 0,
                lead: 0,
                pcatScheduled: 0,
                pcatDone: 0,
                registrationDone: 0,
                admissionDone: 0,
              };

              memberIds.forEach(
                (memberId) => {
                  const key =
                    `${dateStr}_${memberId}`;

                  const metric =
                    dailyMetrics.get(
                      key,
                    ) || {};

                  combined.dial +=
                    metric.dial || 0;

                  combined.answered +=
                    metric.answered || 0;

                  combined.talkTime +=
                    metric.talkTime || 0;

                  combined.lead +=
                    metric.lead || 0;

                  combined.pcatScheduled +=
                    metric.pcatScheduled || 0;

                  combined.pcatDone +=
                    metric.pcatDone || 0;

                  combined.registrationDone +=
                    metric.registrationDone || 0;

                  combined.admissionDone +=
                    metric.admissionDone || 0;
                },
              );

              return combined;
            },
          );

        return {
          employeeId:
            rootId,

          employeeName:
            user.name ||
            'Unknown',

          designation:
            user.role
              ? rolesById.get(
                  user.role.toString(),
                ) || null
              : null,

          vintage:
            calculateVintage(
              user.createdAt,
            ),

          team:
            isTeam,

          teamSize:
            memberIds.length,

          dailyMetrics:
            metrics,
        };
      })
      .sort(
        (a, b) =>
          (
            a.employeeName ||
            ''
          ).localeCompare(
            b.employeeName ||
              '',
          ),
      );

  return {
    startDate,
    endDate,
    dateStrings,
    team: isTeam,
    employees,
  };
}
async employeePoolDailyUtilizationTeamReport(
  query: any,
) {
  const now = new Date();

  // =========================================================
  // DATE RANGE
  // =========================================================

  let startDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
  );

  let endDate = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );

  if (query.dateFilter) {
    const filter =
      String(
        query.dateFilter,
      ).toLowerCase();

    if (filter === 'today') {
      startDate = new Date(now);

      startDate.setHours(
        0,
        0,
        0,
        0,
      );

      endDate = new Date(now);

      endDate.setHours(
        23,
        59,
        59,
        999,
      );
    }
  }

  const fromProvided =
    Boolean(query.fromDate);

  const toProvided =
    Boolean(query.toDate);

  if (fromProvided) {
    const from =
      new Date(
        query.fromDate,
      );

    if (
      !Number.isNaN(
        from.getTime(),
      )
    ) {
      startDate =
        new Date(from);

      startDate.setHours(
        0,
        0,
        0,
        0,
      );

      if (!toProvided) {
        endDate =
          new Date(from);

        endDate.setHours(
          23,
          59,
          59,
          999,
        );
      }
    }
  }

  if (toProvided) {
    const to =
      new Date(
        query.toDate,
      );

    if (
      !Number.isNaN(
        to.getTime(),
      )
    ) {
      endDate =
        new Date(to);

      endDate.setHours(
        23,
        59,
        59,
        999,
      );

      if (!fromProvided) {
        startDate =
          new Date(to);

        startDate.setHours(
          0,
          0,
          0,
          0,
        );
      }
    }
  }

  if (startDate > endDate) {
    const temp =
      startDate;

    startDate =
      endDate;

    endDate =
      temp;
  }

  // =========================================================
  // MAX 5 DAYS
  // =========================================================

  const diffDays =
    Math.ceil(
      Math.abs(
        endDate.getTime() -
          startDate.getTime(),
      ) /
        (
          1000 *
          60 *
          60 *
          24
        ),
    );

  if (diffDays > 5) {
    throw new BadRequestException(
      'Maximum 5 days allowed for daily utilization report',
    );
  }

  // =========================================================
  // EMPLOYEE ID
  // =========================================================

  const employeeId =
    query.employeeId ||
    query.counsellorId;

  if (!employeeId) {
    throw new BadRequestException(
      'employeeId is required',
    );
  }

  if (
    !Types.ObjectId.isValid(
      employeeId,
    )
  ) {
    throw new BadRequestException(
      'Invalid employeeId',
    );
  }

  const selectedEmployeeId =
    String(employeeId);

  const selectedEmployeeObjectId =
    new Types.ObjectId(
      selectedEmployeeId,
    );

  // =========================================================
  // GET SELECTED EMPLOYEE
  // =========================================================

  const selectedEmployee =
    await this.userModel
      .findOne({
        _id:
          selectedEmployeeObjectId,

        status: 'active',
      })
      .select(
        'name email number employeeId role createdAt',
      )
      .lean();

  if (!selectedEmployee) {
    throw new BadRequestException(
      'Employee not found or inactive',
    );
  }

  const rootId =
    selectedEmployee._id.toString();

  // =========================================================
  // TEAM FILTER
  // =========================================================

  const isTeam =
    query.team === true ||
    query.team === 'true';

  // =========================================================
  // GET DIRECT TEAM
  // =========================================================

  let directTeam: any[] =
    [];

  if (isTeam) {
    directTeam =
      await this.userLogic.getUsersUnder(
        selectedEmployee,
      );
  }

  // =========================================================
  // IMPORTANT
  //
  // ONLY DIRECT TEAM MEMBERS
  //
  // NEVER RETURN SELECTED EMPLOYEE
  // INSIDE employees
  // =========================================================

  const directTeamMap =
    new Map<string, any>();

  for (
    const user of
    directTeam || []
  ) {
    const userId =
      user?._id?.toString?.() ||
      user?.id?.toString?.();

    if (!userId) {
      continue;
    }

    // Never return parent as child
    if (
      userId === rootId
    ) {
      continue;
    }

    directTeamMap.set(
      userId,
      {
        ...user,
        _id: userId,
      },
    );
  }

  const visibleUsers =
    Array.from(
      directTeamMap.values(),
    );

  console.log(
    'employeePoolDailyUtilizationTeamReport',
    {
      selectedEmployeeId:
        rootId,

      isTeam,

      directTeamCount:
        visibleUsers.length,

      directTeamIds:
        visibleUsers.map(
          (user: any) =>
            user._id.toString(),
        ),
    },
  );

  // =========================================================
  // TEAM MAP
  //
  // For every employee we return,
  // calculate their COMPLETE subtree.
  //
  // Response itself still shows ONLY direct children.
  // =========================================================

  const teamMap =
    new Map<
      string,
      string[]
    >();

  const teamSizeMap =
    new Map<
      string,
      number
    >();

  // =========================================================
  // SELECTED EMPLOYEE / PARENT
  // =========================================================

  if (isTeam) {
    const subordinateIds =
      await this.getUserAndSubordinateIds(
        rootId,
      );

    const uniqueSubordinateIds =
      [
        ...new Set(
          subordinateIds.map(
            (id: any) =>
              id.toString(),
          ),
        ),
      ].filter(
        (id) =>
          id !== rootId,
      );

    // Descendants only
    teamSizeMap.set(
      rootId,
      uniqueSubordinateIds.length,
    );

    const allIds = [
      rootId,
      ...uniqueSubordinateIds,
    ];

    const activeUsers =
      await this.userModel
        .find({
          _id: {
            $in: allIds
              .filter(
                (id) =>
                  Types.ObjectId.isValid(
                    id,
                  ),
              )
              .map(
                (id) =>
                  new Types.ObjectId(
                    id,
                  ),
              ),
          },

          status: 'active',
        })
        .select('_id')
        .lean();

    const activeIds =
      activeUsers.map(
        (user) =>
          user._id.toString(),
      );

    if (
      !activeIds.includes(
        rootId,
      )
    ) {
      activeIds.push(
        rootId,
      );
    }

    teamMap.set(
      rootId,
      [
        ...new Set(
          activeIds,
        ),
      ],
    );
  } else {
    teamSizeMap.set(
      rootId,
      0,
    );

    teamMap.set(
      rootId,
      [rootId],
    );
  }

  // =========================================================
  // DIRECT TEAM SUBTREES
  // =========================================================

  for (
    const user of
    visibleUsers
  ) {
    const userId =
      user._id.toString();

    if (!isTeam) {
      teamSizeMap.set(
        userId,
        0,
      );

      teamMap.set(
        userId,
        [userId],
      );

      continue;
    }

    const subordinateIds =
      await this.getUserAndSubordinateIds(
        userId,
      );

    const uniqueSubordinateIds =
      [
        ...new Set(
          subordinateIds.map(
            (id: any) =>
              id.toString(),
          ),
        ),
      ].filter(
        (id) =>
          id !== userId,
      );

    // Descendants only
    teamSizeMap.set(
      userId,
      uniqueSubordinateIds.length,
    );

    const allIds = [
      userId,
      ...uniqueSubordinateIds,
    ];

    const activeUsers =
      await this.userModel
        .find({
          _id: {
            $in: allIds
              .filter(
                (id) =>
                  Types.ObjectId.isValid(
                    id,
                  ),
              )
              .map(
                (id) =>
                  new Types.ObjectId(
                    id,
                  ),
              ),
          },

          status: 'active',
        })
        .select('_id')
        .lean();

    const activeIds =
      activeUsers.map(
        (member) =>
          member._id.toString(),
      );

    // Always include root
    if (
      !activeIds.includes(
        userId,
      )
    ) {
      activeIds.push(
        userId,
      );
    }

    teamMap.set(
      userId,
      [
        ...new Set(
          activeIds,
        ),
      ],
    );
  }

  // =========================================================
  // ALL USERS USED BY DAILY QUERIES
  // =========================================================

  const allAllowedUserIds = [
    ...new Set(
      Array.from(
        teamMap.values(),
      )
        .flat()
        .filter(
          (id) =>
            Types.ObjectId.isValid(
              id,
            ),
        ),
    ),
  ];

  console.log(
    'Daily hierarchy allowed users',
    {
      selectedEmployeeId:
        rootId,

      count:
        allAllowedUserIds.length,

      allAllowedUserIds,
    },
  );

  // =========================================================
  // ALLOWED MATCH HELPER
  // =========================================================

  const buildAllowedMatch = (
    fieldPath: string,
  ) => ({
    $expr: {
      $in: [
        {
          $convert: {
            input:
              fieldPath,

            to: 'string',

            onError: null,

            onNull: null,
          },
        },

        allAllowedUserIds,
      ],
    },
  });

  // =========================================================
  // DATES
  // =========================================================

  const dates: Date[] =
    [];

  for (
    let d =
      new Date(startDate);
    d <= endDate;
    d.setDate(
      d.getDate() + 1,
    )
  ) {
    dates.push(
      new Date(d),
    );
  }

  const dateStrings =
    dates.map(
      (date) =>
        this.formatLocalDate(
          date,
        ),
    ).reverse();

  // =========================================================
  // DAILY METRICS
  // =========================================================

  const dailyMetrics =
    new Map<
      string,
      any
    >();

  // =========================================================
  // FETCH DATA DAY BY DAY
  // =========================================================

  for (
    const date of dates
  ) {
    const dayStart =
      new Date(date);

    dayStart.setHours(
      0,
      0,
      0,
      0,
    );

    const dayEnd =
      new Date(date);

    dayEnd.setHours(
      23,
      59,
      59,
      999,
    );

    const dateStr =
      this.formatLocalDate(
        date,
      );

    // =======================================================
    // CALLS
    // =======================================================

    const calls =
      await this.callLogModel.aggregate([
        {
          $match: {
            createdAt: {
              $gte:
                dayStart,

              $lte:
                dayEnd,
            },

            ...buildAllowedMatch(
              '$userId',
            ),
          },
        },

        {
          $group: {
            _id: {
              $convert: {
                input:
                  '$userId',

                to: 'string',

                onError: null,

                onNull: null,
              },
            },

            dial: {
              $sum: 1,
            },

            answered: {
              $sum: {
                $cond: [
                  {
                    $gt: [
                      '$duration',
                      0,
                    ],
                  },

                  1,

                  0,
                ],
              },
            },

            talkTime: {
              $sum: {
                $cond: [
                  {
                    $gt: [
                      '$duration',
                      0,
                    ],
                  },

                  '$duration',

                  0,
                ],
              },
            },
          },
        },
      ]);

    calls.forEach(
      (item) => {
        if (!item._id) {
          return;
        }

        const employeeId =
          item._id.toString();

        const key =
          `${dateStr}_${employeeId}`;

        const existing =
          dailyMetrics.get(
            key,
          ) || {};

        existing.dial =
          item.dial || 0;

        existing.answered =
          item.answered || 0;

        existing.talkTime =
          item.talkTime || 0;

        dailyMetrics.set(
          key,
          existing,
        );
      },
    );

    // =======================================================
    // LEADS
    // =======================================================

    const leads =
      await this.leadModel.aggregate([
        {
          $addFields: {
            normalizedAssignedTo: {
              $convert: {
                input:
                  '$assignedTo',

                to: 'string',

                onError: null,

                onNull: null,
              },
            },
          },
        },

        {
          $match: {
            assignedDate: {
              $gte:
                dayStart,

              $lte:
                dayEnd,
            },

            normalizedAssignedTo: {
              $in:
                allAllowedUserIds,
            },
          },
        },

        {
          $group: {
            _id:
              '$normalizedAssignedTo',

            lead: {
              $sum: 1,
            },
          },
        },
      ]);

    leads.forEach(
      (item) => {
        if (!item._id) {
          return;
        }

        const employeeId =
          item._id.toString();

        const key =
          `${dateStr}_${employeeId}`;

        const existing =
          dailyMetrics.get(
            key,
          ) || {};

        existing.lead =
          item.lead || 0;

        dailyMetrics.set(
          key,
          existing,
        );
      },
    );

    // =======================================================
    // PCAT SCHEDULED
    // =======================================================

    const pcatScheduled =
      await this.leadModel.aggregate([
        {
          $addFields: {
            normalizedAssignedTo: {
              $convert: {
                input:
                  '$assignedTo',

                to: 'string',

                onError: null,

                onNull: null,
              },
            },
          },
        },

        {
          $match: {
            pcatScheduledDate: {
              $gte:
                dayStart,

              $lte:
                dayEnd,
            },

            normalizedAssignedTo: {
              $in:
                allAllowedUserIds,
            },
          },
        },

        {
          $group: {
            _id:
              '$normalizedAssignedTo',

            pcatScheduled: {
              $sum: 1,
            },
          },
        },
      ]);

    pcatScheduled.forEach(
      (item) => {
        if (!item._id) {
          return;
        }

        const employeeId =
          item._id.toString();

        const key =
          `${dateStr}_${employeeId}`;

        const existing =
          dailyMetrics.get(
            key,
          ) || {};

        existing.pcatScheduled =
          item.pcatScheduled || 0;

        dailyMetrics.set(
          key,
          existing,
        );
      },
    );

    // =======================================================
    // PCAT DONE
    // =======================================================

    const pcatDone =
      await this.leadModel.aggregate([
        {
          $addFields: {
            normalizedAssignedTo: {
              $convert: {
                input:
                  '$assignedTo',

                to: 'string',

                onError: null,

                onNull: null,
              },
            },
          },
        },

        {
          $match: {
            pcatDoneDate: {
              $gte:
                dayStart,

              $lte:
                dayEnd,
            },

            normalizedAssignedTo: {
              $in:
                allAllowedUserIds,
            },
          },
        },

        {
          $group: {
            _id:
              '$normalizedAssignedTo',

            pcatDone: {
              $sum: 1,
            },
          },
        },
      ]);

    pcatDone.forEach(
      (item) => {
        if (!item._id) {
          return;
        }

        const employeeId =
          item._id.toString();

        const key =
          `${dateStr}_${employeeId}`;

        const existing =
          dailyMetrics.get(
            key,
          ) || {};

        existing.pcatDone =
          item.pcatDone || 0;

        dailyMetrics.set(
          key,
          existing,
        );
      },
    );

    // =======================================================
    // REGISTRATION
    // =======================================================

    const registrations =
      await this.orderModel.aggregate([
        {
          $addFields: {
            normalizedCounsellorId: {
              $convert: {
                input:
                  '$counsellorId',

                to: 'string',

                onError: null,

                onNull: null,
              },
            },
          },
        },

        {
          $match: {
            orderDate: {
              $gte:
                dayStart,

              $lte:
                dayEnd,
            },

            registrationAmount: {
              $gt: 0,
            },

            normalizedCounsellorId: {
              $in:
                allAllowedUserIds,
            },
          },
        },

        {
          $group: {
            _id:
              '$normalizedCounsellorId',

            registrationDone: {
              $sum: 1,
            },
          },
        },
      ]);

    registrations.forEach(
      (item) => {
        if (!item._id) {
          return;
        }

        const employeeId =
          item._id.toString();

        const key =
          `${dateStr}_${employeeId}`;

        const existing =
          dailyMetrics.get(
            key,
          ) || {};

        existing.registrationDone =
          item.registrationDone || 0;

        dailyMetrics.set(
          key,
          existing,
        );
      },
    );

    // =======================================================
    // ADMISSION
    // =======================================================

    const admissions =
      await this.orderModel.aggregate([
        {
          $addFields: {
            normalizedCounsellorId: {
              $convert: {
                input:
                  '$counsellorId',

                to: 'string',

                onError: null,

                onNull: null,
              },
            },
          },
        },

        {
          $match: {
            orderDate: {
              $gte:
                dayStart,

              $lte:
                dayEnd,
            },

            Approved: true,

            normalizedCounsellorId: {
              $in:
                allAllowedUserIds,
            },
          },
        },

        {
          $group: {
            _id:
              '$normalizedCounsellorId',

            admissionDone: {
              $sum: 1,
            },
          },
        },
      ]);

    admissions.forEach(
      (item) => {
        if (!item._id) {
          return;
        }

        const employeeId =
          item._id.toString();

        const key =
          `${dateStr}_${employeeId}`;

        const existing =
          dailyMetrics.get(
            key,
          ) || {};

        existing.admissionDone =
          item.admissionDone || 0;

        dailyMetrics.set(
          key,
          existing,
        );
      },
    );
  }

  // =========================================================
  // GET ROLES FOR DIRECT TEAM + PARENT
  // =========================================================

  const allUsersForRoles = [
    {
      ...selectedEmployee,
      _id: rootId,
    },
    ...visibleUsers,
  ];

  const roleIds = [
    ...new Set(
      allUsersForRoles
        .map(
          (user: any) => {
            if (!user?.role) {
              return null;
            }

            if (
              typeof user.role ===
                'object' &&
              user.role._id
            ) {
              return user.role._id.toString();
            }

            return user.role.toString();
          },
        )
        .filter(
          (id: any) =>
            id &&
            Types.ObjectId.isValid(
              id,
            ),
        ),
    ),
  ];

  const roles =
    roleIds.length
      ? await this.roleModel
          .find({
            _id: {
              $in:
                roleIds.map(
                  (id) =>
                    new Types.ObjectId(
                      id,
                    ),
                ),
            },
          })
          .select('name')
          .lean()
      : [];

  const rolesById =
    new Map(
      roles.map(
        (role: any) => [
          role._id.toString(),
          role.name,
        ],
      ),
    );

  // =========================================================
  // VINTAGE
  // =========================================================

  const calculateVintage = (
    createdAt?: Date,
  ) => {
    if (!createdAt) {
      return null;
    }

    const created =
      new Date(
        createdAt,
      );

    if (
      Number.isNaN(
        created.getTime(),
      )
    ) {
      return null;
    }

    const diff =
      now.getTime() -
      created.getTime();

    const days =
      Math.floor(
        diff /
          (
            1000 *
            60 *
            60 *
            24
          ),
      );

    if (days < 0) {
      return '0D';
    }

    if (days >= 365) {
      const years =
        Math.floor(
          days / 365,
        );

      const remainingDays =
        days % 365;

      return remainingDays === 0
        ? `${years}Y`
        : `${years}Y ${remainingDays}D`;
    }

    return `${days}D`;
  };

  // =========================================================
  // DESIGNATION
  // =========================================================

  const getDesignation = (
    user: any,
  ) => {
    if (!user?.role) {
      return null;
    }

    if (
      typeof user.role ===
        'object' &&
      user.role._id
    ) {
      return (
        user.role.name ||
        rolesById.get(
          user.role._id.toString(),
        ) ||
        null
      );
    }

    const roleId =
      user.role.toString();

    return (
      rolesById.get(
        roleId,
      ) || null
    );
  };

  // =========================================================
  // BUILD ONE EMPLOYEE'S DAILY METRICS
  //
  // Metrics use the COMPLETE subtree.
  // =========================================================

  const buildEmployee =
    (user: any) => {
      const userId =
        user._id.toString();

      const memberIds =
        teamMap.get(
          userId,
        ) || [userId];

      const metrics =
        dateStrings.map(
          (dateStr) => {
            const combined = {
              date: dateStr,

              dial: 0,

              answered: 0,

              talkTime: 0,

              lead: 0,

              pcatScheduled: 0,

              pcatDone: 0,

              registrationDone: 0,

              admissionDone: 0,
            };

            memberIds.forEach(
              (memberId) => {
                const key =
                  `${dateStr}_${memberId}`;

                const metric =
                  dailyMetrics.get(
                    key,
                  ) || {};

                combined.dial +=
                  metric.dial || 0;

                combined.answered +=
                  metric.answered ||
                  0;

                combined.talkTime +=
                  metric.talkTime ||
                  0;

                combined.lead +=
                  metric.lead || 0;

                combined.pcatScheduled +=
                  metric.pcatScheduled ||
                  0;

                combined.pcatDone +=
                  metric.pcatDone ||
                  0;

                combined.registrationDone +=
                  metric.registrationDone ||
                  0;

                combined.admissionDone +=
                  metric.admissionDone ||
                  0;
              },
            );

            return combined;
          },
        );

      return {
        employeeId:
          userId,

        employeeName:
          user.name ||
          'Unknown',

        employeeEmail:
          user.email ||
          null,

        employeeNumber:
          user.number ||
          null,

        employeeEmployeeId:
          user.employeeId ||
          null,

        designation:
          getDesignation(
            user,
          ),

        vintage:
          calculateVintage(
            user.createdAt,
          ),

        team:
          isTeam,

        // Descendants only
        teamSize:
          teamSizeMap.get(
            userId,
          ) || 0,

        hasTeam:
          (
            teamSizeMap.get(
              userId,
            ) || 0
          ) > 0,

        dailyMetrics:
          metrics,
      };
    };

  // =========================================================
  // PARENT EMPLOYEE
  // =========================================================

  const parentEmployee =
    buildEmployee({
      ...selectedEmployee,
      _id: rootId,
    });

  // =========================================================
  // DIRECT TEAM ONLY
  //
  // Parent is NEVER returned here.
  // =========================================================

  const employees =
    visibleUsers
      .filter(
        (user: any) =>
          user._id.toString() !==
          rootId,
      )
      .map(
        (user: any) =>
          buildEmployee(
            user,
          ),
      )
      .sort(
        (a, b) =>
          (
            a.employeeName ||
            ''
          ).localeCompare(
            b.employeeName ||
              '',
          ),
      );

  // =========================================================
  // RESPONSE
  // =========================================================

  return {
    startDate,

    endDate,

    dateStrings,

    team:
      isTeam,

    employeeId:
      rootId,

    parentEmployee,

    employees,
  };
}

async employeePoolDailyUtilizationCalls(
  query: any,
) {
  // =========================================================
  // PAGINATION
  // =========================================================

  const page = Math.max(
    1,
    Number(query.page) || 1,
  );

  const limit = Math.min(
    100,
    Math.max(
      1,
      Number(query.limit) || 20,
    ),
  );

  const skip =
    (page - 1) * limit;

  // =========================================================
  // EMPLOYEE ID
  // =========================================================

  const employeeId =
    query.employeeId ||
    query.counsellorId;

  if (!employeeId) {
    throw new BadRequestException(
      'employeeId is required',
    );
  }

  if (
    !Types.ObjectId.isValid(
      String(employeeId),
    )
  ) {
    throw new BadRequestException(
      'Invalid employeeId',
    );
  }

  const selectedEmployeeId =
    String(employeeId);

  const selectedEmployeeObjectId =
    new Types.ObjectId(
      selectedEmployeeId,
    );

  // =========================================================
  // EXACT DATE
  // =========================================================

  const date =
    query.date ||
    query.fromDate;

  if (!date) {
    throw new BadRequestException(
      'date is required. Example: 2026-09-05',
    );
  }

  const parsedDate =
    new Date(date);

  if (
    Number.isNaN(
      parsedDate.getTime(),
    )
  ) {
    throw new BadRequestException(
      'Invalid date. Expected format: YYYY-MM-DD',
    );
  }

  const startDate =
    new Date(parsedDate);

  startDate.setHours(
    0,
    0,
    0,
    0,
  );

  const endDate =
    new Date(parsedDate);

  endDate.setHours(
    23,
    59,
    59,
    999,
  );

  // =========================================================
  // GET SELECTED EMPLOYEE
  // =========================================================

  const selectedEmployee =
    await this.userModel
      .findOne({
        _id:
          selectedEmployeeObjectId,

        status: 'active',
      })
      .select(
        'name email number employeeId role createdAt',
      )
      .lean();

  if (!selectedEmployee) {
    throw new BadRequestException(
      'Employee not found or inactive',
    );
  }

  // =========================================================
  // TEAM FILTER
  // =========================================================

  const teamFilter =
    query.team === true ||
    query.team === 'true';

  // =========================================================
  // BUILD USER SCOPE
  //
  // team=false
  //   => selected employee only
  //
  // team=true
  //   => selected employee + complete subtree
  // =========================================================

  let allowedUserIds: string[] =
    [selectedEmployeeId];

  if (teamFilter) {
    const subordinateIds =
      await this.getUserAndSubordinateIds(
        selectedEmployeeId,
      );

    const allIds = [
      selectedEmployeeId,

      ...(subordinateIds || []).map(
        (id: any) =>
          id.toString(),
      ),
    ];

    const uniqueIds = [
      ...new Set(allIds),
    ];

    // Only active users
    const activeUsers =
      await this.userModel
        .find({
          _id: {
            $in: uniqueIds
              .filter(
                (id) =>
                  Types.ObjectId.isValid(
                    id,
                  ),
              )
              .map(
                (id) =>
                  new Types.ObjectId(
                    id,
                  ),
              ),
          },

          status: 'active',
        })
        .select('_id')
        .lean();

    allowedUserIds =
      activeUsers.map(
        (user) =>
          user._id.toString(),
      );

    // Always keep selected employee
    if (
      !allowedUserIds.includes(
        selectedEmployeeId,
      )
    ) {
      allowedUserIds.push(
        selectedEmployeeId,
      );
    }
  }

  allowedUserIds = [
    ...new Set(
      allowedUserIds.filter(
        (id) =>
          Types.ObjectId.isValid(
            id,
          ),
      ),
    ),
  ];

  console.log(
    'employeePoolDailyUtilizationCalls',
    {
      selectedEmployeeId,
      date,
      startDate,
      endDate,
      teamFilter,
      allowedUserCount:
        allowedUserIds.length,
      page,
      limit,
    },
  );

  // =========================================================
  // ANSWERED FILTER
  //
  // answered=true
  //   => duration > 0
  //
  // answered=false
  //   => duration <= 0 OR missing duration
  //
  // no answered filter
  //   => all calls
  // =========================================================

  const hasAnsweredFilter =
    query.answered !==
      undefined &&
    query.answered !== null &&
    query.answered !== '';

  let answeredFilter:
    | any[]
    | null = null;

  if (hasAnsweredFilter) {
    const answered =
      String(
        query.answered,
      ).toLowerCase();

    if (
      answered === 'true' ||
      answered === '1'
    ) {
      answeredFilter = [
        {
          $expr: {
            $gt: [
              {
                $convert: {
                  input:
                    '$duration',

                  to: 'double',

                  onError: 0,

                  onNull: 0,
                },
              },

              0,
            ],
          },
        },
      ];
    } else if (
      answered === 'false' ||
      answered === '0'
    ) {
      answeredFilter = [
        {
          $expr: {
            $lte: [
              {
                $convert: {
                  input:
                    '$duration',

                  to: 'double',

                  onError: 0,

                  onNull: 0,
                },
              },

              0,
            ],
          },
        },
      ];
    } else {
      throw new BadRequestException(
        'answered must be true or false',
      );
    }
  }

  // =========================================================
  // SEARCH
  //
  // Search customer number if supplied.
  // =========================================================

  const search =
    query.search
      ? String(
          query.search,
        ).trim()
      : null;

  const searchMatch =
    search
      ? [
          {
            $or: [
              {
                customerNumber: {
                  $regex: search,
                  $options: 'i',
                },
              },

              {
                phoneNumber: {
                  $regex: search,
                  $options: 'i',
                },
              },

              {
                mobile: {
                  $regex: search,
                  $options: 'i',
                },
              },
            ],
          },
        ]
      : [];

  // =========================================================
  // BASE MATCH
  // =========================================================

  const baseMatch: any = {
    createdAt: {
      $gte: startDate,

      $lte: endDate,
    },
  };

  // =========================================================
  // AGGREGATION
  //
  // Normalize userId because existing data may contain
  // ObjectId/string values.
  // =========================================================

  const pipeline: any[] = [
    {
      $addFields: {
        normalizedUserId: {
          $convert: {
            input:
              '$userId',

            to: 'string',

            onError: null,

            onNull: null,
          },
        },

        normalizedDuration: {
          $convert: {
            input:
              '$duration',

            to: 'double',

            onError: 0,

            onNull: 0,
          },
        },
      },
    },

    {
      $match: {
        ...baseMatch,

        normalizedUserId: {
          $in:
            allowedUserIds,
        },
      },
    },

    ...searchMatch,

    ...(answeredFilter || []),
  ];

  // =========================================================
  // TOTAL COUNT
  // =========================================================

  const countPipeline = [
    ...pipeline,

    {
      $count: 'total',
    },
  ];

  const countResult =
    await this.callLogModel.aggregate(
      countPipeline,
    );

  const total =
    countResult.length
      ? Number(
          countResult[0].total || 0,
        )
      : 0;

  // =========================================================
  // CALL RECORDS
  // =========================================================

  const calls =
    await this.callLogModel.aggregate([
      ...pipeline,

      {
        $sort: {
          createdAt: -1,
          _id: -1,
        },
      },

      {
        $skip: skip,
      },

      {
        $limit: limit,
      },

      // =====================================================
      // EMPLOYEE LOOKUP
      // =====================================================

      {
        $lookup: {
          from: 'users',

          let: {
            callUserId:
              '$normalizedUserId',
          },

          pipeline: [
            {
              $addFields: {
                normalizedId: {
                  $convert: {
                    input:
                      '$_id',

                    to: 'string',

                    onError:
                      null,

                    onNull:
                      null,
                  },
                },
              },
            },

            {
              $match: {
                $expr: {
                  $eq: [
                    '$normalizedId',

                    '$$callUserId',
                  ],
                },
              },
            },

            {
              $project: {
                _id: 1,

                name: 1,

                email: 1,

                employeeId: 1,
              },
            },
          ],

          as: 'employee',
        },
      },

      {
        $unwind: {
          path: '$employee',

          preserveNullAndEmptyArrays:
            true,
        },
      },

      // =====================================================
      // FINAL RESPONSE FIELDS
      // =====================================================

      {
        $project: {
          _id: 1,

          callId: '$_id',

          userId:
            '$normalizedUserId',

          employeeName:
            '$employee.name',

          employeeEmail:
            '$employee.email',

          employeeId:
            '$employee.employeeId',

          customerNumber: 1,

          duration:
            '$normalizedDuration',

          createdAt: 1,

          answered: {
            $gt: [
              '$normalizedDuration',
              0,
            ],
          },

          callStatus: {
            $cond: [
              {
                $gt: [
                  '$normalizedDuration',
                  0,
                ],
              },

              'answered',

              'not_answered',
            ],
          },

          // Keep commonly useful fields
          // if they exist in your CallLog document.
          direction: 1,

          status: 1,

          type: 1,

          recordingUrl: 1,
        },
      },
    ]);

  // =========================================================
  // PAGINATION
  // =========================================================

  const totalPages =
    Math.ceil(
      total / limit,
    );

  return {
    date:
      this.formatLocalDate(
        parsedDate,
      ),

    startDate,

    endDate,

    employeeId:
      selectedEmployeeId,

    employeeName:
      selectedEmployee.name ||
      'Unknown',

    team:
      teamFilter,

    answered:
      hasAnsweredFilter
        ? String(
            query.answered,
          ).toLowerCase()
        : null,

    search:
      search || null,

    page,

    limit,

    total,

    totalPages,

    hasNextPage:
      page < totalPages,

    hasPreviousPage:
      page > 1,

    calls,
  };
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
