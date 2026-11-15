import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { buildDateCondition, containsRegex, parsePagination } from 'src/common/utils/filter.util';
import { CallLogData } from 'src/api/call-logs/call-log.data';
import { UserLogic } from 'src/api/user/user.logic';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { User } from 'src/schema/user.schema';
import { LeadScheduleData } from '../lead-schedule/lead-schedule.data';
import { CallLog } from 'src/schema/call-log.schema';

export class LeadData {
  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,
    @InjectModel(CallLog.name)
    private readonly callLogModel: Model<CallLog>,
    private readonly userLogic: UserLogic,
    private readonly leadScheduleData: LeadScheduleData,
  ) { }

  async create(data: any) {
    const lastLead = await this.leadModel
      .findOne({}, { leadId: 1 })
      .sort({ leadId: -1 })
      .lean();

    const nextLeadId = lastLead?.leadId
      ? lastLead.leadId + 1
      : 1;

    return this.leadModel.create({
      ...data,
      leadId: nextLeadId,
    });
  }


  /**
   * Builds the lead list query. Every filter group is ANDed together so
   * combining filters always narrows results. `access` (team/pool scope for
   * non-admins) is its own $and clause so search/location can never widen it.
   */
  private async buildLeadListQuery(
    filters: any,
    access?: { userIds: string[]; pool?: string },
  ) {
    const {
      search,
      bulkSearch,
      status,
      source,
      source_compain,
      source_campaign,
      stageId,
      poolId,
      assignedTo,
      modifiedBy,
      isActive,
      dateFilter,
      fromDate,
      toDate,
      city,
      state,
      location,
      assignedDateFilter,
      assignedDateFrom,
      assignedDateTo,
    } = filters;

    const and: any[] = [];
    const toId = (id: any) =>
      Types.ObjectId.isValid(String(id)) ? new Types.ObjectId(String(id)) : id;

    /**
     * assignedTo may be stored as an ObjectId (current schema) or as a plain
     * string (older data). Mongoose casts query values to ObjectId, which never
     * matches string-stored ids – so match both forms explicitly. The string
     * branch uses $expr, which Mongoose does not cast.
     */
    const assignedToIn = (ids: any[]) => {
      const strings = ids.map((id) => String(id));
      return {
        $or: [
          { assignedTo: { $in: ids.map(toId) } },
          {
            $and: [
              { assignedTo: { $type: 'string' } },
              { $expr: { $in: ['$assignedTo', strings] } },
            ],
          },
        ],
      };
    };

    // 🔐 access scope
    if (access) {
      and.push(
        access.pool
          ? { $or: [assignedToIn(access.userIds), { poolId: toId(access.pool) }] }
          : assignedToIn(access.userIds),
      );
    }

    // 📋 bulk search (comma separated lead ids / phones)
    if (bulkSearch) {
      const values = String(bulkSearch).split(',').map((v) => v.trim()).filter(Boolean);
      const leadIds = values.filter((v) => !isNaN(Number(v))).map(Number);
      and.push({ $or: [{ leadId: { $in: leadIds } }, { phone: { $in: values } }] });
    }

    // 🔍 search
    if (search && String(search).trim()) {
      const term = String(search).trim();
      const rx = containsRegex(term);
      const searchConditions: any[] = [
        { name: rx },
        { phone: rx },
        { email: rx },
        { address: rx },
        { city: rx },
        { state: rx },
      ];
      if (!isNaN(Number(term))) {
        searchConditions.push({ leadId: Number(term) });
        const users = await this.userLogic.findbyEmpId(Number(term));
        let empUserIds = users.map((u: any) => u._id.toString());
        if (access) empUserIds = empUserIds.filter((id: string) => access.userIds.includes(id));
        if (empUserIds.length) {
          searchConditions.push(assignedToIn(empUserIds));
        }
      }
      and.push({ $or: searchConditions });
    }

    // 🎯 basic filters
    // multi-select filters: single value, CSV or array → $in
    const list = (v: any): any[] =>
      v === undefined || v === null || v === ''
        ? []
        : (Array.isArray(v) ? v : String(v).split(',')).map((x: any) => String(x).trim()).filter(Boolean);
    const statuses = list(status);
    const sources = list(source);
    const stageIds = list(stageId);
    const poolIds = list(poolId);
    const assignees = list(assignedTo);
    if (statuses.length) and.push({ status: { $in: statuses } });
    if (sources.length) and.push({ source: { $in: sources } });
    if (stageIds.length) and.push({ stageId: { $in: stageIds.map(toId) } });
    if (poolIds.length) and.push({ poolId: { $in: poolIds.map(toId) } });
    if (assignees.length) and.push(assignedToIn(assignees));
    if (modifiedBy) and.push({ modifiedBy: toId(modifiedBy) });
    if (isActive !== undefined && isActive !== '') {
      and.push({ isActive: isActive === true || isActive === 'true' });
    }

    // 🏙️ location
    if (city) and.push({ city: containsRegex(city) });
    if (state) and.push({ state: containsRegex(state) });
    if (location) {
      and.push({ $or: [{ city: containsRegex(location) }, { state: containsRegex(location) }] });
    }

    // 📣 source campaign
    const sourceCampaign = source_campaign ?? source_compain;
    if (sourceCampaign) and.push({ source_campaign: containsRegex(sourceCampaign) });

    // 📅 dates (custom range overrides preset; "to" is inclusive)
    const created = buildDateCondition(dateFilter, fromDate, toDate);
    if (created) and.push({ createdAt: created });
    const assigned = buildDateCondition(assignedDateFilter, assignedDateFrom, assignedDateTo);
    if (assigned) and.push({ assignedDate: assigned });

    return and.length ? { $and: and } : {};
  }

  async findAllWithFilters(filters: any) {
    const { sort = 'new' } = filters;
    const { page, limit, skip } = parsePagination(filters.page, filters.limit);
    const query: any = await this.buildLeadListQuery(filters);

    // 📊 SORTING
    const sortOrder = sort === 'old' ? 1 : -1;

    const [data, total] = await Promise.all([
      this.leadModel
        .find(query)
        .populate('assignedTo', 'name email employeeId')
        .populate('stageId', 'name order')
        .populate('poolId', 'name')
        .sort({ createdAt: sortOrder })
        .skip(skip)
        .limit(Number(limit)),

      this.leadModel.countDocuments(query),
    ]);
    const leadIds = data.map((lead) => lead.leadId);
    const lastCalls = await this.callLogModel.aggregate([
  {
    $match: {
      leadId: { $in: leadIds },
    },
  },
  {
    $sort: {
      createdAt: -1,
    },
  },
  {
    $group: {
      _id: '$leadId',
      lastCallDate: { $first: '$createdAt' },
      lastCallId: { $first: '$_id' },
      duration: { $first: '$duration' },
      outcome: { $first: '$outcome' },
    },
  },
]);
const callMap = new Map(
  lastCalls.map((call) => [
    call._id,
    {
      lastCallDate: call.lastCallDate,
      duration: call.duration,
      outcome: call.outcome,
    },
  ]),
);
const leadsWithCallInfo = data.map((lead: any) => {
  const callInfo = callMap.get(lead.leadId);

  return {
    ...lead.toObject(),
    lastCallDate: callInfo?.lastCallDate || null,
    lastCallDuration: callInfo?.duration || null,
    lastCallOutcome: callInfo?.outcome || null,
  };
});
    return {
      data:leadsWithCallInfo,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findAllWithFiltersUserIds(filters: any, userIds: string[], pool?: string,) {
    const { connected, scheduler, sort = 'new' } = filters;
    const { page, limit, skip } = parsePagination(filters.page, filters.limit);

    // 🔐 access scope + all filters, ANDed together
    const query: any = await this.buildLeadListQuery(filters, { userIds, pool });

    /* ================= DERIVED FILTERS ================= */

    // Step 1: get all leadIds matching base query (before connected/scheduler)
    // Only needed for the derived filters – skip the full scan otherwise.
    const needsDerived = connected !== undefined || scheduler !== undefined;
    let filteredLeadIds: number[] = needsDerived
      ? (await this.leadModel.find(query).select('leadId').lean()).map((l: any) => l.leadId)
      : [];

    // 🔌 CONNECTED FILTER
    if (connected !== undefined) {
      const connectedLeadIds =
        await this.getLeadIdsByConnection(
          filteredLeadIds,
          connected === 'true',
        );

      filteredLeadIds = filteredLeadIds.filter((id) =>
        connectedLeadIds.includes(id),
      );
    }

    // ⏰ SCHEDULER FILTER
    if (scheduler !== undefined) {
      const scheduledLeadIds =
        await this.leadScheduleData.getScheduledLeadIds(filteredLeadIds);

      if (scheduler === 'true') {
        filteredLeadIds = filteredLeadIds.filter((id) =>
          scheduledLeadIds.includes(id),
        );
      } else {
        filteredLeadIds = filteredLeadIds.filter(
          (id) => !scheduledLeadIds.includes(id),
        );
      }
    }

    // Apply final leadId filter
    if (connected !== undefined || scheduler !== undefined) {
      query.leadId = { $in: filteredLeadIds };
    }

    /* ================= PAGINATION ================= */
    const sortOrder = sort === 'old' ? 1 : -1;

    const [data, total] = await Promise.all([
      this.leadModel
        .find(query)
        .populate('assignedTo', 'name email employeeId')
        .populate('stageId', 'name order')
        .populate('poolId', 'name')
        .sort({ createdAt: sortOrder })
        .skip(skip)
        .limit(Number(limit)),

      this.leadModel.countDocuments(query),
    ]);

    const leadIds = data.map((lead) => lead.leadId);
    const lastCalls = await this.callLogModel.aggregate([
  {
    $match: {
      leadId: { $in: leadIds },
    },
  },
  {
    $sort: {
      createdAt: -1,
    },
  },
  {
    $group: {
      _id: '$leadId',
      lastCallDate: { $first: '$createdAt' },
      lastCallId: { $first: '$_id' },
      duration: { $first: '$duration' },
      outcome: { $first: '$outcome' },
    },
  },
]);

const callMap = new Map(
  lastCalls.map((call) => [
    call._id,
    {
      lastCallDate: call.lastCallDate,
      duration: call.duration,
      outcome: call.outcome,
    },
  ]),
);

const leadsWithCallInfo = data.map((lead: any) => {
  const callInfo = callMap.get(lead.leadId);

  return {
    ...lead.toObject(),
    lastCallDate: callInfo?.lastCallDate || null,
    lastCallDuration: callInfo?.duration || null,
    lastCallOutcome: callInfo?.outcome || null,
  };
});
    return {
  data: leadsWithCallInfo,
  meta: {
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
  },
};
  }


async findOne(filters: any) {
    return this.leadModel.findOne(filters);
  }


  async findAllWithFiltersUserId(filters: any, userId: string) {
    const {
      search,
      status,
      source,
      source_compain,
      source_campaign,
      stageId,
      poolId,
      assignedTo,
      modifiedBy,
      isActive,
      dateFilter,
      fromDate,
      toDate,
      city,
      state,
      location,
      assignedDateFilter,
      assignedDateFrom,
      assignedDateTo,
      sort = 'new',
      page = 1,
      limit = 10,
    } = filters;

    const query: any = {};
    const sourceCampaign = source_campaign ?? source_compain;

    // 🔍 SEARCH
    if (search) {
      const searchConditions: any[] = [
        { name: containsRegex(search) },
        { phone: containsRegex(search) },
        { email: containsRegex(search) },
        { city: containsRegex(search) },
        { state: containsRegex(search) },
      ];
      // ✅ Add leadId search
      if (!isNaN(Number(search))) {
        searchConditions.push({ leadId: Number(search) });
      }

      query.$and = query.$and || [];
      query.$and.push({ $or: searchConditions });
    }

    // 🎯 FILTERS
    if (status) query.status = status;
    if (source) query.source = source;
    if (stageId) query.stageId = stageId;
    if (poolId) query.poolId = poolId;
    if (assignedTo) query.assignedTo = assignedTo;
    if (modifiedBy) query.modifiedBy = modifiedBy;
    if (isActive !== undefined)
      query.isActive = isActive === 'true';

    // 🏙️ LOCATION FILTERS
    if (city) query.city = containsRegex(city);
    if (state) query.state = containsRegex(state);
    if (location) {
      query.$or = query.$or || [];
      query.$or.push(
        { city: containsRegex(location) },
        { state: containsRegex(location) },
      );
    }
    if (sourceCampaign) {
      query.$or = query.$or || [];
      query.$or.push(
        { source_campaign: containsRegex(sourceCampaign) }
      );
    }

    // 📅 DATE FILTERS
    const now = new Date();
    if (dateFilter) {
      let start: Date | null = null;

      if (dateFilter === 'today') {
        start = new Date(now.setHours(0, 0, 0, 0));
      } else if (dateFilter === 'week') {
        start = new Date();
        start.setDate(start.getDate() - 7);
      } else if (dateFilter === 'month') {
        start = new Date();
        start.setMonth(start.getMonth() - 1);
      } else if (dateFilter === 'year') {
        start = new Date();
        start.setFullYear(start.getFullYear() - 1);
      }

      if (start) {
        query.createdAt = { $gte: start };
      }
    }

    if (assignedDateFilter) {
      let assignedDatestart: Date | null = null;

      if (assignedDateFilter === 'today') {
        assignedDatestart = new Date(now.setHours(0, 0, 0, 0));
      } else if (assignedDateFilter === 'week') {
        assignedDatestart = new Date();
        assignedDatestart.setDate(assignedDatestart.getDate() - 7);
      } else if (assignedDateFilter === 'month') {
        assignedDatestart = new Date();
        assignedDatestart.setMonth(assignedDatestart.getMonth() - 1);
      } else if (assignedDateFilter === 'year') {
        assignedDatestart = new Date();
        assignedDatestart.setFullYear(assignedDatestart.getFullYear() - 1);
      }

      if (assignedDatestart) {
        query.assignedDate = { $gte: assignedDatestart };
      }
    }

    // 📅 CUSTOM DATE RANGE
    if (fromDate && toDate) {
      query.createdAt = {
        $gte: new Date(fromDate),
        $lte: new Date(toDate),
      };
    }

    // 📅 ASSIGNED DATE RANGE
    if (assignedDateFrom || assignedDateTo) {
      query.assignedDate = {};
      if (assignedDateFrom) query.assignedDate.$gte = new Date(assignedDateFrom);
      if (assignedDateTo) query.assignedDate.$lte = new Date(assignedDateTo);
    }

    // 📊 SORTING
    const sortOrder = sort === 'old' ? 1 : -1;

    // 📄 PAGINATION
    const skip = (page - 1) * limit;
    const finalQuery = {
      ...query,
      assignedTo: userId,
    };
    const [data, total] = await Promise.all([
      this.leadModel
        .find(finalQuery)
        .populate('assignedTo', 'name email employeeId')
        .populate('stageId', 'name order')
        .populate('poolId', 'name')
        .sort({ createdAt: sortOrder })
        .skip(skip)
        .limit(Number(limit)),

      this.leadModel.countDocuments(finalQuery),
    ]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit),
      },
    };
  }
  async getLeadsByLeadIds(leadIds: number[]) {
    return this.leadModel.find(
      { leadId: { $in: leadIds } },
      { leadId: 1, name: 1, phone: 1 },
    );
  }
  getByLeadId(leadId: number) {
    return this.leadModel.findOne({ leadId: leadId }).populate('stageId').populate('assignedTo', 'name email employeeId').populate('poolId', 'name').lean();
  }

  findById(id: string) {
    return this.leadModel.findById(id).populate('stageId').populate('assignedTo', 'name email employeeId').populate('poolId', 'name');;
  }
  findByIds(ids: string[]) {
    return this.leadModel.find({ _id: { $in: ids } });
  }

  update(id: string, data: any) {
    return this.leadModel.findByIdAndUpdate(id, data, {
      new: true,
    });
  }

  delete(id: string) {
    return this.leadModel.findByIdAndDelete(id);
  }

  // findIdsByDepartment(departmentId: string) {
  //   return this.leadModel
  //     .find({ departmentId, isActive: true })
  //     .select('_id assignedTo');
  // }

  assignLeadsByIds(
    leadIds: string[],
    modifiedBy: string,
    assignedTo?: string,
  ) {
    return this.leadModel.updateMany(
      { _id: { $in: leadIds } },
      {
        $set: {
          assignedTo,
          assignedDate: new Date(),
          modifiedBy,
          modifiedAt: new Date(),
        },
      },
    );
  }


  bulkUpdate(
    leadIds: string[],
    updateData: any,
  ) {
    return this.leadModel.updateMany(
      { _id: { $in: leadIds } },
      {
        $set: {
          ...updateData,
          modifiedAt: new Date(),
        },
      },
    );
  }

  pullBackAndReassign(
    leadIds: string[],
    newAssignedTo: string,
    modifiedBy: string,
  ) {
    return this.leadModel.updateMany(
      { _id: { $in: leadIds } },
      {
        $set: {
          assignedTo: newAssignedTo,
          assignedDate: new Date(),
          modifiedBy,
          modifiedAt: new Date(),
        },
      },
    );
  }

  findByUserId(userId: string) {
    return this.leadModel
      .find({ assignedTo: userId })
      .populate('assignedTo', 'name email employeeId')
      .populate('stageId', 'name order')
      .populate('poolId', 'name')
      .sort({ createdAt: -1 });
  }

  async findDuplicateLeads() {
    return this.leadModel.aggregate([
      {
        $match: {
          $or: [
            { phone: { $ne: null } },
            { email: { $ne: null } },
          ],
        },
      },

      {
        $group: {
          _id: {
            phone: "$phone",
            email: "$email",
          },
          leads: { $push: "$$ROOT" },
          count: { $sum: 1 },
        },
      },

      {
        $match: {
          count: { $gt: 1 },
        },
      },

      {
        $project: {
          _id: 0,
          phone: "$_id.phone",
          email: "$_id.email",
          count: 1,
          leads: 1,
        },
      },
    ]);
  }


  // findByDepartmentId(departmentId: string) {
  //   return this.leadModel
  //     .find({ departmentId })
  //     .populate('departmentId', 'name')
  //     .populate('assignedTo', 'name email')
  //     .populate('stageId', 'name order')
  //     .sort({ createdAt: -1 });
  // }


  async getLeadIdsByConnection(
    leadIds: number[],
    connected: boolean,
  ) {
    const pipeline: any[] = [
      { $match: { leadId: { $in: leadIds } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$leadId",
          latestCall: { $first: "$$ROOT" },
        },
      },
      {
        $match: connected
          ? { "latestCall.duration": { $gt: 0 } }
          : { "latestCall.duration": 0 },
      },
      { $project: { _id: 1 } },
    ];

    const result = await this.callLogModel.aggregate(pipeline);
    return result.map((r) => r._id);
  }

}
