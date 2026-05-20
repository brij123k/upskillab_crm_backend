import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
      .sort({ createdAt: -1 });
  }

  findById(id: string) {
    return this.sourceCampaignModel
      .findById(id)
      .populate('defaultStageId', 'name order')
      .populate('defaultPoolId', 'name');
  }

  update(id: string, data: any) {
    return this.sourceCampaignModel.findByIdAndUpdate(id, data, { new: true });
  }

  createLog(data: any) {
    return this.sourceCampaignLogModel.create(data);
  }

  aggregateLogs(match: any = {}) {
    return this.sourceCampaignLogModel.aggregate([
      { $match: match },
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
    ]);
  }
}
