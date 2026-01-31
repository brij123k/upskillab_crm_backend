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

  findByUserId(userId: string) {
    return this.callLogModel
      .find({ userId })
      .populate('stageId', 'name')
      .sort({ createdAt: -1 });
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
