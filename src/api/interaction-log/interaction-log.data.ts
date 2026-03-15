import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LeadInteractionLog } from 'src/schema/lead-interaction-log.schema';
import { PipelineStage } from "mongoose";
export class InteractionLogData {

  constructor(
    @InjectModel(LeadInteractionLog.name)
    private readonly model: Model<LeadInteractionLog>,
  ) {}

  create(data: any) {
    return this.model.create(data);
  }

  findByLeadId(leadId: number) {
    return this.model
      .find({ leadId })
      .populate('userId', 'name email')
      .populate('stageId', 'name')
      .sort({ createdAt: -1 });
  }

  findById(id: string) {
    return this.model.findById(id);
  }

  update(id: string, data: any) {
    return this.model.findByIdAndUpdate(id, data, { new: true });
  }
  async findAllWithUserIds(
  filters: any,
  accessibleUserIds: string[],
) {

  const {
    search,
    leadId,
    stageId,
    source,
    byUserId,
    dateFilter,
    fromDate,
    toDate,
    sort = 'new',
    page = 1,
    limit = 10,
  } = filters;

  const match: any = {};

  if (leadId) match.leadId = Number(leadId);

  if (stageId) match.stageId = stageId;

  if (source) match.source = source;

  if (byUserId) {
    match.userId = byUserId;
  } else {
    match.userId = { $in: accessibleUserIds };
  }

  if (search) {
    const conditions: any[] = [
      { note: { $regex: search, $options: 'i' } },
      { source: { $regex: search, $options: 'i' } },
    ];

    if (!isNaN(Number(search))) {
      conditions.push({ leadId: Number(search) });
    }

    match.$or = conditions;
  }

  const now = new Date();

  if (dateFilter) {

    let start: Date | null = null;

    if (dateFilter === 'today')
      start = new Date(now.setHours(0,0,0,0));

    else if (dateFilter === 'week') {
      start = new Date();
      start.setDate(start.getDate() - 7);
    }

    else if (dateFilter === 'month') {
      start = new Date();
      start.setMonth(start.getMonth() - 1);
    }

    else if (dateFilter === 'year') {
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

  const sortOrder = sort === 'old' ? 1 : -1;
  const skip = (page - 1) * limit;

  const pipeline: PipelineStage[] = [

    { $match: match },

    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "userId"
      }
    },

    { $unwind: { path: "$userId", preserveNullAndEmptyArrays: true } },

    {
      $lookup: {
        from: "leadstages",
        localField: "stageId",
        foreignField: "_id",
        as: "stageId"
      }
    },

    { $unwind: { path: "$stageId", preserveNullAndEmptyArrays: true } },

    { $sort: { createdAt: sortOrder } },

    {
      $facet: {
        data: [{ $skip: skip }, { $limit: Number(limit) }],
        total: [{ $count: "count" }]
      }
    }
  ];

  const result = await this.model.aggregate(pipeline);

  const data = result[0].data;
  const total = result[0].total[0]?.count || 0;

  return {
    data,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
  };
}

  async findInteractionLogsWithPagination(filters: any, userId?: string) {

  const {
    search,
    leadId,
    stageId,
    source,
    byUserId,
    dateFilter,
    fromDate,
    toDate,
    sort = 'new',
    page = 1,
    limit = 10,
  } = filters;

  const query: any = {};

  // lead filter
  if (leadId) query.leadId = Number(leadId);

  if (stageId) query.stageId = stageId;

  if (source) query.source = source;

  // user filter
  if (byUserId) {
    query.userId = byUserId;
  } else if (userId) {
    query.userId = userId;
  }

  // search
  if (search) {

    const searchConditions: any[] = [
      { note: { $regex: search, $options: 'i' } },
      { source: { $regex: search, $options: 'i' } },
    ];

    if (!isNaN(Number(search))) {
      searchConditions.push({ leadId: Number(search) });
    }

    query.$or = searchConditions;
  }

  // date filter
  const now = new Date();

  if (dateFilter) {

    let start: Date | null = null;

    if (dateFilter === 'today')
      start = new Date(now.setHours(0, 0, 0, 0));

    else if (dateFilter === 'week') {
      start = new Date();
      start.setDate(start.getDate() - 7);
    }

    else if (dateFilter === 'month') {
      start = new Date();
      start.setMonth(start.getMonth() - 1);
    }

    else if (dateFilter === 'year') {
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

  const [logs, total] = await Promise.all([

    this.model
      .find(query)
      .populate('userId', 'name')
      .populate('stageId', 'name')
      .sort({ createdAt: sortOrder })
      .skip(skip)
      .limit(Number(limit))
      .lean(),

    this.model.countDocuments(query),

  ]);

  return {
    data: logs,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
  };
}

}