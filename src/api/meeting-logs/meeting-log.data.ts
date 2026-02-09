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

async meetingsWithFeedbacks(filters: any,user:any) {
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

  // 🎯 BASIC FILTERS
  if (leadId) match.leadId = Number(leadId);
  if (userId) match.userId = userId;
  if (stageId) match.stageId = stageId;

  // 🔍 SEARCH
  if (search) {
    match.$or = [
      { meetingType: { $regex: search, $options: 'i' } },
      { outcome: { $regex: search, $options: 'i' } },
      { notes: { $regex: search, $options: 'i' } },
    ];
  }

  // 📅 DATE FILTERS
  const now = new Date();

  if (dateFilter) {
    let start: Date | null = null;

    if (dateFilter === 'today')
      start = new Date(now.setHours(0, 0, 0, 0));
    else if (dateFilter === 'week')
      start = new Date(now.setDate(now.getDate() - 7));
    else if (dateFilter === 'month')
      start = new Date(now.setMonth(now.getMonth() - 1));
    else if (dateFilter === 'year')
      start = new Date(now.setFullYear(now.getFullYear() - 1));

    if (start) match.createdAt = { $gte: start };
  }

  if (fromDate && toDate) {
    match.createdAt = {
      $gte: new Date(fromDate),
      $lte: new Date(toDate),
    };
  }

  // 📊 SORT & PAGINATION
  const sortOrder = sort === 'old' ? 1 : -1;
  const skip = (page - 1) * limit;

  const pipeline: PipelineStage[] = [
    { $match: match },

    // 🔁 CAST IDS (string → ObjectId safe)
    {
      $addFields: {
        userObjectId: {
          $cond: [
            { $eq: [{ $type: '$userId' }, 'objectId'] },
            '$userId',
            { $toObjectId: '$userId' },
          ],
        },
        stageObjectId: {
          $cond: [
            { $eq: [{ $type: '$stageId' }, 'objectId'] },
            '$stageId',
            { $toObjectId: '$stageId' },
          ],
        },
      },
    },

    { $sort: { createdAt: sortOrder } },

    // 🔗 FEEDBACKS
    {
      $lookup: {
        from: 'meetingfeedbacks',
        localField: '_id',
        foreignField: 'meetingId',
        as: 'feedbacks',
      },
    },

    // 👤 USER
    {
      $lookup: {
        from: 'users',
        localField: 'userObjectId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },

    // 🧭 STAGE
    {
      $lookup: {
        from: 'leadstages',
        localField: 'stageObjectId',
        foreignField: '_id',
        as: 'stage',
      },
    },
    { $unwind: { path: '$stage', preserveNullAndEmptyArrays: true } },

    // 🧹 FINAL SHAPE
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

        userId: {
          _id: '$user._id',
          name: '$user.name',
        },

        stageId: {
          _id: '$stage._id',
          name: '$stage.name',
        },
      },
    },

    { $skip: skip },
    { $limit: Number(limit) },
  ];

  const countPipeline: PipelineStage[] = [
    { $match: match },
    { $count: 'total' },
  ];

  const [data, countResult] = await Promise.all([
    this.meetingModel.aggregate(pipeline),
    this.meetingModel.aggregate(countPipeline),
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



}
