import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CallLog } from 'src/schema/call-log.schema';
import { PipelineStage } from 'mongoose';
import { Lead } from 'src/schema/lead_management/lead.schema';
export class CallLogData {
  constructor(
    @InjectModel(CallLog.name)
    private readonly callLogModel: Model<CallLog>,

        @InjectModel(Lead.name)
        private readonly leadModel: Model<Lead>,
  ) { }

  create(data: any) {
    return this.callLogModel.create(data);
  }

  findByLeadId(leadId: number) {
    return this.callLogModel
      .find({ leadId })
      .populate('userId', 'name email')
      .populate('stageId', 'name')
      .sort({ createdAt: -1 });
  }

  async findWithPagination(filters: any, userId?: string) {
    const {
      leadId,
      outcome,
      page = 1,
      limit = 10,
    } = filters;

    const match: any = {};

    if (leadId) match.leadId = Number(leadId);
    if (outcome) match.outcome = outcome;
    if (userId) match.userId = userId;

    const skip = (page - 1) * limit;

    const pipeline: PipelineStage[] = [
      { $match: match },

      { $sort: { createdAt: -1 } },

      {
        $group: {
          _id: "$leadId",
          latestCall: { $first: "$$ROOT" },
        },
      },

      { $replaceRoot: { newRoot: "$latestCall" } },

      { $skip: skip },
      { $limit: Number(limit) },

      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userId",
        },
      },
      // { $unwind: { path: "$userId", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "stages",
          localField: "stageId",
          foreignField: "_id",
          as: "stageId",
        },
      },
      // { $unwind: { path: "$stageId", preserveNullAndEmptyArrays: true } },
    ];


    const countPipeline: PipelineStage[] = [
      { $match: match },
      { $group: { _id: "$leadId" } },
      { $count: "total" },
    ];


    const [data, countResult] = await Promise.all([
      this.callLogModel.aggregate(pipeline),
      this.callLogModel.aggregate(countPipeline),
    ]);

    const total = countResult[0]?.total || 0;

    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

async findCallLogWithPagination(filters: any, userId?: string) {
  const {
    search,
    leadId,
    stageId,
    outcome,
    durationMin,
    durationMax,
    answered,
    byUserId,
    dateFilter,
    fromDate,
    toDate,
    sort = 'new',
    page = 1,
    limit = 10,
  } = filters;

  const query: any = {};

  // 🎯 BASIC FILTERS
  if (leadId) query.leadId = Number(leadId);
  if (stageId) query.stageId = stageId;
  if (outcome) query.outcome = outcome;

  // 🎯 DURATION
  if (durationMin || durationMax) {
    query.duration = {};
    if (durationMin) query.duration.$gte = Number(durationMin);
    if (durationMax) query.duration.$lte = Number(durationMax);
  }

  // 🎯 ANSWERED
  if (answered !== undefined) {
    if (answered === true || answered === 'true') {
      query.duration = { ...(query.duration || {}), $gt: 0 };
    } else {
      query.duration = { ...(query.duration || {}), $eq: 0 };
    }
  }

  // 👤 USER FILTER
  if (byUserId) query.userId = byUserId;
  else if (userId) query.userId = userId;

  // 🔍 SEARCH
  if (search) {
    const searchConditions: any[] = [
      { outcome: { $regex: search, $options: 'i' } },
    ];

    if (!isNaN(Number(search))) {
      searchConditions.push(
        { leadId: Number(search) },
        { duration: Number(search) }
      );
    }

    searchConditions.push({ userId: search }, { stageId: search });
    query.$or = searchConditions;
  }

  // 📅 DATE FILTER (existing)
  const now = new Date();

  if (dateFilter) {
    let start: Date | null = null;

    if (dateFilter === 'today') start = new Date(now.setHours(0, 0, 0, 0));
    else if (dateFilter === 'week') {
      start = new Date();
      start.setDate(start.getDate() - 7);
    } else if (dateFilter === 'month') {
      start = new Date();
      start.setMonth(start.getMonth() - 1);
    } else if (dateFilter === 'year') {
      start = new Date();
      start.setFullYear(start.getFullYear() - 1);
    }

    if (start) query.createdAt = { $gte: start };
  }

  if (fromDate && toDate) {
    query.createdAt = {
      $gte: new Date(fromDate),
      $lte: new Date(toDate),
    };
  }

  const sortOrder = sort === 'old' ? 1 : -1;
  const skip = (page - 1) * limit;

  // ===========================
  // ✅ NEW: DATE RANGE FOR STATS (DEFAULT TODAY)
  // ===========================
  let startDate = new Date();
  startDate.setHours(0, 0, 0, 0);

  let endDate = new Date();
  endDate.setHours(23, 59, 59, 999);

  if (dateFilter) {
    const now = new Date();

    if (dateFilter === 'today') {
      startDate = new Date(now.setHours(0, 0, 0, 0));
      endDate = new Date();
    } else if (dateFilter === 'week') {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      endDate = new Date();
    } else if (dateFilter === 'month') {
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      endDate = new Date();
    } else if (dateFilter === 'year') {
      startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1);
      endDate = new Date();
    }
  }

  if (fromDate && toDate) {
    startDate = new Date(fromDate);
    endDate = new Date(toDate);
  }

  // 🚀 FETCH DATA
  const [logs, total] = await Promise.all([
    this.callLogModel
      .find(query)
      .populate('userId', 'name employeeId')
      .populate('stageId', 'name')
      .sort({ createdAt: sortOrder })
      .skip(skip)
      .limit(Number(limit))
      .lean(),

    this.callLogModel.countDocuments(query),
  ]);

  // 🧠 GET ALL LEADS
  const leadIds = logs.map(l => l.leadId);

  const leads = await this.leadModel.find(
    { leadId: { $in: leadIds } },
    { leadId: 1, name: 1, phone: 1 }
  ).lean();

  // 🔄 CREATE MAP
  const leadMap = {};
  leads.forEach(l => {
    leadMap[l.leadId] = l;
  });

  // 🧠 CALL COUNT (30 DAYS)
  const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const counts = await this.callLogModel.aggregate([
    {
      $match: {
        leadId: { $in: leadIds },
        createdAt: { $gte: last30Days },
      },
    },
    {
      $group: {
        _id: '$leadId',
        count: { $sum: 1 },
      },
    },
  ]);

  const countMap = {};
  counts.forEach(c => {
    countMap[c._id] = c.count;
  });

  // 🎯 FINAL DATA (FLAT ✅)
  const data = logs.map(log => ({
    ...log,
    leadName: leadMap[log.leadId]?.name || null,
    leadNumber: leadMap[log.leadId]?.phone || null,
    answered: log.duration > 0,
    callCount30Days: countMap[log.leadId] || 0,
  }));

  // ===========================
  // ✅ NEW: STATS QUERY
  // ===========================
  const statsMatch = {
    ...query,
    createdAt: { $gte: startDate, $lte: endDate },
  };

  const statsResult = await this.callLogModel.aggregate([
    { $match: statsMatch },
    {
      $group: {
        _id: null,
        totalDials: { $sum: 1 },
        totalAnswered: {
          $sum: {
            $cond: [{ $gt: ['$duration', 0] }, 1, 0],
          },
        },
        totalTalkTime: { $sum: '$duration' },
      },
    },
  ]);

  const stats = {
    totalDials: statsResult[0]?.totalDials || 0,
    totalAnswered: statsResult[0]?.totalAnswered || 0,
    totalTalkTime: statsResult[0]?.totalTalkTime || 0,
  };

  return {
    data,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),

    // ✅ NEW
    stats,
  };
}


async findAllWithUserIds(filters: any, accessibleUserIds: string[]) {
  const {
    search,
    leadId,
    stageId,
    outcome,
    durationMin,
    durationMax,
    answered,
    byUserId,
    dateFilter,
    fromDate,
    toDate,
    sort = 'new',
    page = 1,
    limit = 10,
  } = filters;

  const match: any = {};

  // 🎯 BASIC FILTERS
  if (leadId) match.leadId = Number(leadId);
  if (stageId) match.stageId = stageId;
  if (outcome) match.outcome = outcome;

  if (durationMin || durationMax) {
    match.duration = {};
    if (durationMin) match.duration.$gte = Number(durationMin);
    if (durationMax) match.duration.$lte = Number(durationMax);
  }

  // 👥 MULTIPLE USER FILTER
  if (byUserId) {
    match.userId = byUserId;
  } else {
    match.userId = { $in: accessibleUserIds };
  }

  // 🔍 SEARCH
  if (search) {
    const searchConditions: any[] = [
      { outcome: { $regex: search, $options: 'i' } },
    ];

    if (!isNaN(Number(search))) {
      searchConditions.push(
        { leadId: Number(search) },
        { duration: Number(search) }
      );
    }

    searchConditions.push({ userId: search }, { stageId: search });
    match.$or = searchConditions;
  }

  // 📅 DATE FILTER (existing - DO NOT REMOVE)
  const now = new Date();

  if (dateFilter) {
    let start: Date | null = null;

    if (dateFilter === 'today') start = new Date(now.setHours(0, 0, 0, 0));
    else if (dateFilter === 'week') {
      start = new Date();
      start.setDate(start.getDate() - 7);
    } else if (dateFilter === 'month') {
      start = new Date();
      start.setMonth(start.getMonth() - 1);
    } else if (dateFilter === 'year') {
      start = new Date();
      start.setFullYear(start.getFullYear() - 1);
    }

    if (start) match.createdAt = { $gte: start };
  }

  if (fromDate && toDate) {
    match.createdAt = {
      $gte: new Date(fromDate),
      $lte: new Date(toDate),
    };
  }

  // 📊 ANSWERED FILTER
  if (answered !== undefined) {
    if (answered === true || answered === 'true') {
      match.duration = { ...(match.duration || {}), $gt: 0 };
    } else if (answered === false || answered === 'false') {
      match.duration = { ...(match.duration || {}), $eq: 0 };
    }
  }

  const sortOrder = sort === 'old' ? 1 : -1;
  const skip = (page - 1) * limit;

  // ===========================
  // ✅ NEW: DATE RANGE FOR STATS (DEFAULT TODAY)
  // ===========================
  let startDate = new Date();
  startDate.setHours(0, 0, 0, 0);

  let endDate = new Date();
  endDate.setHours(23, 59, 59, 999);

  if (dateFilter) {
    const now = new Date();

    if (dateFilter === 'today') {
      startDate = new Date(now.setHours(0, 0, 0, 0));
      endDate = new Date();
    } else if (dateFilter === 'week') {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      endDate = new Date();
    } else if (dateFilter === 'month') {
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      endDate = new Date();
    } else if (dateFilter === 'year') {
      startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1);
      endDate = new Date();
    }
  }

  if (fromDate && toDate) {
    startDate = new Date(fromDate);
    endDate = new Date(toDate);
  }

  // ===========================
  // 🚀 AGGREGATION PIPELINE (UNCHANGED)
  // ===========================
  const pipeline: any[] = [
    { $match: match },

    {
      $addFields: {
        answered: {
          $cond: [{ $gt: ['$duration', 0] }, true, false],
        },
      },
    },

    {
      $lookup: {
        from: 'calllogs',
        let: { lead: '$leadId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$leadId', '$$lead'] },
                  {
                    $gte: [
                      '$createdAt',
                      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                    ],
                  },
                ],
              },
            },
          },
          { $count: 'count' },
        ],
        as: 'callCount30Days',
      },
    },

    {
      $addFields: {
        callCount30Days: {
          $ifNull: [{ $arrayElemAt: ['$callCount30Days.count', 0] }, 0],
        },
      },
    },

    {
      $addFields: {
        userObjectId: { $toObjectId: "$userId" },
        stageObjectId: {
          $cond: [
            { $ifNull: ["$stageId", false] },
            { $toObjectId: "$stageId" },
            null
          ]
        }
      }
    },

    {
      $lookup: {
        from: "users",
        let: { uid: "$userObjectId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$uid"] } } },
          { $project: { _id: 1, name: 1, employeeId: 1 } }
        ],
        as: "userId"
      }
    },
    { $unwind: { path: "$userId", preserveNullAndEmptyArrays: true } },

    {
      $lookup: {
        from: "leadstages",
        let: { sid: "$stageObjectId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$sid"] } } },
          { $project: { _id: 1, name: 1 } }
        ],
        as: "stageId"
      }
    },
    { $unwind: { path: "$stageId", preserveNullAndEmptyArrays: true } },

    {
      $lookup: {
        from: "leads",
        let: { lead: "$leadId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$leadId", "$$lead"] }
            }
          },
          {
            $project: {
              _id: 0,
              leadId: 1,
              name: 1,
              phone: 1
            }
          }
        ],
        as: "lead"
      }
    },
    {
      $unwind: {
        path: "$lead",
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $addFields: {
        leadName: "$lead.name",
        leadNumber: "$lead.phone"
      }
    },
    {
      $project: {
        lead: 0
      }
    },

    { $sort: { createdAt: sortOrder } },

    {
      $facet: {
        data: [{ $skip: skip }, { $limit: Number(limit) }],
        total: [{ $count: 'count' }],
      },
    },
  ];

  const result = await this.callLogModel.aggregate(pipeline);

  const data = result[0].data;
  const total = result[0].total[0]?.count || 0;

  // ===========================
  // ✅ NEW: STATS QUERY
  // ===========================
  const statsMatch = {
    ...match,
    createdAt: { $gte: startDate, $lte: endDate },
  };

  const statsResult = await this.callLogModel.aggregate([
    { $match: statsMatch },
    {
      $group: {
        _id: null,
        totalDials: { $sum: 1 },
        totalAnswered: {
          $sum: {
            $cond: [{ $gt: ['$duration', 0] }, 1, 0],
          },
        },
        totalTalkTime: { $sum: '$duration' },
      },
    },
  ]);

  const stats = {
    totalDials: statsResult[0]?.totalDials || 0,
    totalAnswered: statsResult[0]?.totalAnswered || 0,
    totalTalkTime: statsResult[0]?.totalTalkTime || 0,
  };

  // reports from here
  return {
    data,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),

    // ✅ NEW RESPONSE
    stats,
  };
}







  findById(id: string) {
    return this.callLogModel.findById(id);
  }

  update(id: string, data: any) {
    return this.callLogModel.findByIdAndUpdate(id, data, { new: true });
  }

  delete(id: string) {
    return this.callLogModel.findByIdAndDelete(id);
  }
}
