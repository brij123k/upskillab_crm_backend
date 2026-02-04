import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CallLog } from 'src/schema/call-log.schema';

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

  async findWithPagination(
  filters: any,
  userId?: string,
) {
  const {
    leadId,
    outcome,
    page = 1,
    limit = 10,
  } = filters;

  const query: any = {};
  if (leadId) query.leadId = Number(leadId);
  if (outcome) query.outcome = outcome;
  if (userId) query.userId = userId;

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    this.callLogModel
      .find(query)
      .populate('userId', 'name email')
      .populate('stageId', 'name')
      .sort({ createdAt: -1 })
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
