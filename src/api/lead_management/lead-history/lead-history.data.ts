import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LeadHistory } from 'src/schema/lead_management/lead-history.schema';

export class LeadHistoryData {
  constructor(
    @InjectModel(LeadHistory.name)
    private readonly historyModel: Model<LeadHistory>,
  ) {}

  create(data: any) {
    return this.historyModel.create(data);
  }

  findByLeadId(leadId: string) {
    return this.historyModel
      .find({ leadId })
      .populate('fromUser', 'name email')
      .populate('toUser', 'name email')
      .populate('actionBy', 'name email')
      .sort({ createdAt: 1 });
  }
}
