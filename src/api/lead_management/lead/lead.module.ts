import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadController } from './lead.controller';
import { LeadLogic } from './lead.logic';
import { LeadData } from './lead.data';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { LeadHistoryModule } from '../lead-history/lead-history.module';
import { ProfileModule } from 'src/api/profile/profile.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema }
    ]),
    LeadHistoryModule,
    ProfileModule,
  ],
  controllers: [LeadController],
  providers: [LeadLogic, LeadData],
})
export class LeadModule {}
