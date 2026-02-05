import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadController } from './lead.controller';
import { LeadLogic } from './lead.logic';
import { LeadData } from './lead.data';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { LeadHistoryModule } from '../lead-history/lead-history.module';
import { ProfileModule } from 'src/api/profile/profile.module';
import { MeetingLog,MeetingLogSchema } from 'src/schema/meeting-log.schema';
import { CallLog,CallLogSchema } from 'src/schema/call-log.schema';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: MeetingLog.name, schema: MeetingLogSchema },
      { name: CallLog.name, schema: CallLogSchema }
    ]),
    LeadHistoryModule,
    ProfileModule,
  ],
  controllers: [LeadController],
  providers: [LeadLogic, LeadData],
  exports:[LeadLogic]
})
export class LeadModule {}
