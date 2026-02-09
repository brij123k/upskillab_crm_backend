import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CallLog } from 'src/schema/call-log.schema';
import { PipelineStage } from 'mongoose';
export class CallLogData {
  constructor(
    @InjectModel(CallLog.name)
    private readonly callLogModel: Model<CallLog>,
  ) {}

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
    byUserId,
    dateFilter,
      fromDate,
      toDate,
      sort = 'new',
    page = 1,
    limit = 10,
  } = filters;
  const query: any = {};

  // 🎯 Filters
  if (leadId) query.leadId = Number(leadId);
  if (stageId) query.stageId = stageId;
  if (outcome) query.outcome = outcome;

  if (durationMin || durationMax) {
    query.duration = {};
    if (durationMin) query.duration.$gte = Number(durationMin);
    if (durationMax) query.duration.$lte = Number(durationMax);
  }

  // 🎯 User filter (same logic as leads)
  if (byUserId) {
    query.userId = byUserId;
  } else if (userId) {
    query.userId = userId;
  }

  // 🔍 SEARCH (simple & predictable)
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

    searchConditions.push(
      { userId: search },
      { stageId: search }
    );

    query.$or = searchConditions;
  }

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

    // 📅 CUSTOM DATE RANGE
    if (fromDate && toDate) {
      query.createdAt = {
        $gte: new Date(fromDate),
        $lte: new Date(toDate),
      };
    }

    // 📊 SORTING
    const sortOrder = sort === 'old' ? 1 : -1;

  // 📄 Pagination
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    this.callLogModel
      .find(query)
      .populate('userId', 'name')
      .populate('stageId', 'name')
      .sort({ createdAt: sortOrder })
      .skip(skip)
      .limit(Number(limit)),

    this.callLogModel.countDocuments(query),
  ]);

  return {
    data,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
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
