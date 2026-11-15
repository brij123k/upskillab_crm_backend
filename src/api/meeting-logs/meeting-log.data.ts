import { buildDateCondition, containsRegex, idInAnyForm, parsePagination } from 'src/common/utils/filter.util';
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
    userId: userIdParam,
    byUserId,
    meetingType,
    outcome,
    status,
    leadId,
    dateFilter,
    fromDate,
    toDate,
    sort = 'new',
    page = 1,
    limit = 10,
  } = filters;

  const and: any[] = [];

  if (leadId) and.push({ leadId: Number(leadId) });
  // aggregate pipelines don't cast – match ObjectId and string forms
  if (stageId) and.push({ stageId: { $in: idInAnyForm([stageId]) } });
  if (meetingType) and.push({ meetingType });
  if (outcome) and.push({ outcome: containsRegex(outcome) });
  // no stored status – derive it from the meeting time
  if (status === 'scheduled') and.push({ startedAt: { $gt: new Date() } });
  else if (status === 'completed') {
    and.push({ $or: [{ startedAt: { $lte: new Date() } }, { startedAt: { $exists: false } }, { startedAt: null }] });
  }

  // frontend sends byUserId (older callers: userId)
  const userId = byUserId || userIdParam;

  // 👥 USER FILTER – must stay inside the caller's scope
  if (userId) {
    const allowed = userIds.map(String).includes(String(userId));
    and.push({ userId: { $in: allowed ? idInAnyForm([userId]) : [] } });
  } else {
    and.push({ userId: { $in: idInAnyForm(userIds) } });
  }

  // 🔍 SEARCH
  if (search) {
    and.push({
      $or: [
        { meetingType: containsRegex(search) },
        { outcome: containsRegex(search) },
        { notes: containsRegex(search) },
      ],
    });
  }

  // 📅 DATE FILTER (custom range overrides preset; "to" is inclusive)
  const created = buildDateCondition(dateFilter, fromDate, toDate);
  if (created) and.push({ createdAt: created });

  const match: any = and.length ? { $and: and } : {};

  const sortOrder = sort === 'old' ? 1 : -1;
  const { skip } = parsePagination(page, limit);

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
