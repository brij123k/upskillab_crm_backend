import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { MeetingFeedback } from 'src/schema/meeting-feedback.schema';
import { MeetingLog } from 'src/schema/meeting-log.schema';

export class MeetingLogData {
  constructor(
    @InjectModel(MeetingLog.name)
    private meetingModel: Model<MeetingLog>,

    @InjectModel(MeetingFeedback.name)
    private feedbackModel: Model<MeetingFeedback>,
  ) {}

  create(data: Partial<MeetingLog>) {
    return this.meetingModel.create(data);
  }

  update(id: string, data: any) {
    return this.meetingModel.findByIdAndUpdate(id, data, { new: true });
  }

  delete(id: string) {
    return this.meetingModel.findByIdAndDelete(id);
  }

  findByLeadId(leadId: number) {
    return this.meetingModel
      .find({ leadId })
      .populate('userId', 'name email')
      .populate('stageId', 'name')
      .sort({ startedAt: -1 });
  }

  findByUser(userId?: string) {
    const query = userId ? { userId } : {};
    return this.meetingModel
      .find(query)
      .populate('userId', 'name email')
      .populate('stageId', 'name')
      .sort({ startedAt: -1 });
  }

async meetingsWithFeedbacks(filters: any, userIds: string[]) {
  const {
    search,
    stageId,
    userId,
    leadId,
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

  // 👥 MULTI USER FILTER
  if (userId) {
    match.userId = userId;
  } else {
    match.userId = { $in: userIds };
  }

  // 🔍 SEARCH
  if (search) {
    match.$or = [
      { meetingType: { $regex: search, $options: 'i' } },
      { outcome: { $regex: search, $options: 'i' } },
      { notes: { $regex: search, $options: 'i' } },
    ];
  }

  // 📅 DATE FILTER
  const now = new Date();
  if (dateFilter) {
    let start: Date | null = null;

    if (dateFilter === 'today') start = new Date(now.setHours(0, 0, 0, 0));
    else if (dateFilter === 'week') start = new Date(now.setDate(now.getDate() - 7));
    else if (dateFilter === 'month') start = new Date(now.setMonth(now.getMonth() - 1));
    else if (dateFilter === 'year') start = new Date(now.setFullYear(now.getFullYear() - 1));

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

    // 🔁 CAST IDS
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

    { $sort: { createdAt: sortOrder } },

    // 🔗 FEEDBACKS
    {
      $lookup: {
        from: "meetingfeedbacks",
        localField: "_id",
        foreignField: "meetingId",
        as: "feedbacks"
      }
    },

    // 👤 USER (ONLY REQUIRED FIELDS)
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

    // 🎯 STAGE
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
      $project: {
        leadId: 1,
        meetingType: 1,
        outcome: 1,
        notes: 1,
        startedAt: 1,
        duration: 1,
        createdAt: 1,
        feedbacks: 1,
        userId: 1,
        stageId: 1
      }
    },

    {
      $facet: {
        data: [{ $skip: skip }, { $limit: Number(limit) }],
        total: [{ $count: "count" }]
      }
    }
  ];

  const result = await this.meetingModel.aggregate(pipeline);

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




}
