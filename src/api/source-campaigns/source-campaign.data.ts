import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SourceCampaign } from 'src/schema/source-campaign.schema';
import { SourceCampaignLog } from 'src/schema/source-campaign-log.schema';

export class SourceCampaignData {
  constructor(
    @InjectModel(SourceCampaign.name)
    private readonly sourceCampaignModel: Model<SourceCampaign>,
    @InjectModel(SourceCampaignLog.name)
    private readonly sourceCampaignLogModel: Model<SourceCampaignLog>,
  ) {}

  create(data: any) {
    return this.sourceCampaignModel.create(data);
  }

  findAll() {
    return this.sourceCampaignModel
      .find()
      .populate('defaultStageId', 'name order')
      .populate('defaultPoolId', 'name')
      .populate('createdBy', 'name employeeId email')
      .populate('updatedBy', 'name employeeId email')
      .sort({ createdAt: -1 });
  }

  findById(id: string) {
    return this.sourceCampaignModel
      .findById(id)
      .populate('defaultStageId', 'name order')
      .populate('defaultPoolId', 'name')
      .populate('createdBy', 'name employeeId email')
      .populate('updatedBy', 'name employeeId email');
  }

  findLogsByCampaignId(id: string) {
    return this.sourceCampaignLogModel
      .find({ sourceCampaignId: new Types.ObjectId(id) })
      .populate('leadId', 'leadId name phone email city state source source_campaign status createdAt')
      .sort({ createdAt: -1 });
  }

  update(id: string, data: any) {
    return this.sourceCampaignModel.findByIdAndUpdate(id, data, { new: true });
  }

  createLog(data: any) {
    return this.sourceCampaignLogModel.create(data);
  }

  aggregateLogs(match: any = {}) {
    const pipeline: any[] = [
      { $match: match },
    ];

    pipeline.push(
      {
        $group: {
          _id: {
            sourceCampaignId: '$sourceCampaignId',
            sourceCampaignName: '$sourceCampaignName',
            source: '$source',
          },
          totalLeads: { $sum: 1 },
          lastLeadAt: { $max: '$createdAt' },
        },
      },
      { $sort: { totalLeads: -1, '_id.sourceCampaignName': 1 } },
    );

    return this.sourceCampaignLogModel.aggregate(pipeline);
  }

  countLogsByCampaign() {
    return this.sourceCampaignLogModel.aggregate([
      {
        $group: {
          _id: '$sourceCampaignId',
          registeredCount: { $sum: 1 },
        },
      },
    ]);
  }
}
