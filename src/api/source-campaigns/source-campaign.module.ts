import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SourceCampaignController } from './source-campaign.controller';
import { SourceCampaignLogic } from './source-campaign.logic';
import { SourceCampaignData } from './source-campaign.data';
import { SourceCampaign, SourceCampaignSchema } from 'src/schema/source-campaign.schema';
import { SourceCampaignLog, SourceCampaignLogSchema } from 'src/schema/source-campaign-log.schema';
import { LeadModule } from '../lead_management/lead/lead.module';

@Module({
  imports: [
    LeadModule,
    MongooseModule.forFeature([
      { name: SourceCampaign.name, schema: SourceCampaignSchema },
      { name: SourceCampaignLog.name, schema: SourceCampaignLogSchema },
    ]),
  ],
  controllers: [SourceCampaignController],
  providers: [SourceCampaignLogic, SourceCampaignData],
})
export class SourceCampaignModule {}
