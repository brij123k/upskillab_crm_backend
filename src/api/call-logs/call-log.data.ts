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
  { $unwind: { path: "$userId", preserveNullAndEmptyArrays: true } },

  {
    $lookup: {
      from: "stages",
      localField: "stageId",
      foreignField: "_id",
      as: "stageId",
    },
  },
  { $unwind: { path: "$stageId", preserveNullAndEmptyArrays: true } },
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
