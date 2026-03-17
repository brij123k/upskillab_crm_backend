import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LeadInteractionLog } from 'src/schema/lead-interaction-log.schema';
import { PipelineStage } from "mongoose";
import { Lead } from 'src/schema/lead_management/lead.schema';
export class InteractionLogData {

  constructor(
    @InjectModel(LeadInteractionLog.name)
    private readonly model: Model<LeadInteractionLog>,

    @InjectModel(Lead.name)
    private readonly leadModel: Model<Lead>,
  ) { }

  create(data: any) {
    return this.model.create(data);
  }

  async findByLeadId(leadId: number) {
    // 1️⃣ Get logs
    const logs = await this.model
      .find({ leadId })
      .populate('userId', 'name email employeeId')
      .populate('stageId', 'name')
      .sort({ createdAt: -1 })
      .lean();

    // 2️⃣ Get lead details (single query)
    const lead = await this.leadModel.findOne(
      { leadId },
      { leadId: 1, name: 1, phone: 1 } // 👈 adjust if field is phone/mobile
    ).lean();

    // 3️⃣ Attach flat fields
    const data = logs.map(log => ({
      ...log,
      leadName: lead?.name || null,
      leadNumber: lead?.phone || null,
    }));

    return data;
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

  if (byUserId) match.userId = byUserId;
  else match.userId = { $in: accessibleUserIds };

  if (search) {
    const conditions: any[] = [
      { source: { $regex: search, $options: 'i' } },
      { outcome: { $regex: search, $options: 'i' } },
    ];

    if (!isNaN(Number(search))) {
      conditions.push({ leadId: Number(search) });
    }

    match.$or = conditions;
  }

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

  const sortOrder = sort === 'old' ? 1 : -1;
  const skip = (page - 1) * limit;

  const pipeline: PipelineStage[] = [
    { $match: match },

    // ✅ FIX: Convert string → ObjectId
    {
      $addFields: {
        userObjectId: {
          $cond: [
            { $ifNull: ["$userId", false] },
            { $toObjectId: "$userId" },
            null,
          ],
        },
        stageObjectId: {
          $cond: [
            { $ifNull: ["$stageId", false] },
            { $toObjectId: "$stageId" },
            null,
          ],
        },
      },
    },

    // 👤 USER LOOKUP
    {
      $lookup: {
        from: "users",
        let: { uid: "$userObjectId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$uid"] } } },
          { $project: { _id: 1, name: 1, employeeId: 1 } },
        ],
        as: "userId",
      },
    },
    { $unwind: { path: "$userId", preserveNullAndEmptyArrays: true } },

    // 🎯 STAGE LOOKUP
    {
      $lookup: {
        from: "leadstages",
        let: { sid: "$stageObjectId" },
        pipeline: [
          { $match: { $expr: { $eq: ["$_id", "$$sid"] } } },
          { $project: { _id: 1, name: 1 } },
        ],
        as: "stageId",
      },
    },
    { $unwind: { path: "$stageId", preserveNullAndEmptyArrays: true } },

    // 🎯 LEAD LOOKUP
    {
      $lookup: {
        from: "leads",
        let: { lead: "$leadId" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$leadId", "$$lead"] },
            },
          },
          {
            $project: {
              _id: 0,
              name: 1,
              phone: 1,
            },
          },
        ],
        as: "lead",
      },
    },
    { $unwind: { path: "$lead", preserveNullAndEmptyArrays: true } },

    // ✅ FLATTEN
    {
      $addFields: {
        leadName: "$lead.name",
        leadNumber: "$lead.phone",
      },
    },

    // ❌ CLEANUP
    {
      $project: {
        lead: 0,
        userObjectId: 0,
        stageObjectId: 0,
      },
    },

    { $sort: { createdAt: sortOrder } },

    {
      $facet: {
        data: [{ $skip: skip }, { $limit: Number(limit) }],
        total: [{ $count: "count" }],
      },
    },
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

    const leadIds = logs.map(l => l.leadId);

  const leads = await this.leadModel.find(
    { leadId: { $in: leadIds } },
    { leadId: 1, name: 1, phone: 1 } // 👈 adjust field if needed
  ).lean();

  // 🔄 CREATE MAP
  const leadMap = {};
  leads.forEach(l => {
    leadMap[l.leadId] = l;
  });

  const data = logs.map(log => ({
    ...log,
    leadName: leadMap[log.leadId]?.name || null,
    leadNumber: leadMap[log.leadId]?.phone || null,
  }));

    return {
      data,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    };
  }

}