import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CampaignController } from './campaigns.controller';
import { CampaignLogic } from './campaigns.service';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';

import { User, UserSchema } from 'src/schema/user.schema';
import { WhatsappModule } from 'src/api/whatsapp/whatsapp.module';
import { QueueModule } from 'src/common/queue/queue.module';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: User.name, schema: UserSchema },
    ]),
    WhatsappModule,
    QueueModule,
  ],
  controllers: [CampaignController],
  providers: [CampaignLogic],
  exports:[CampaignLogic]
})
export class CampaignsModule {}
