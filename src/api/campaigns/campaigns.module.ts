import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CampaignController } from './campaigns.controller';
import { CampaignLogic } from './campaigns.service';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';

import { User, UserSchema } from 'src/schema/user.schema';
import { WhatsappModule } from 'src/api/whatsapp/whatsapp.module';
import { QueueModule } from 'src/common/queue/queue.module';
import { WhatsappCampaign,WhatsappCampaignSchema } from './schema/campaign.schema';
import { CampaignRecipientLog,CampaignRecipientLogSchema } from './schema/campaign-recipient-log.schema';
import { SocketModule } from 'src/api/socket/socket.module';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: User.name, schema: UserSchema },
       { name: WhatsappCampaign.name, schema: WhatsappCampaignSchema },
      { name: CampaignRecipientLog.name, schema: CampaignRecipientLogSchema },
    ]),
    WhatsappModule,
    QueueModule,
    SocketModule
  ],
  controllers: [CampaignController],
  providers: [CampaignLogic],
  exports:[CampaignLogic]
})
export class CampaignsModule {}
