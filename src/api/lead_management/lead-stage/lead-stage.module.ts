import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadStageController } from './lead-stage.controller';
import { LeadStageLogic } from './lead-stage.logic';
import { LeadStageData } from './lead-stage.data';
import {
  LeadStage,
  LeadStageSchema,
} from 'src/schema/lead_management/lead-stage.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LeadStage.name, schema: LeadStageSchema },
    ]),
  ],
  controllers: [LeadStageController],
  providers: [LeadStageLogic, LeadStageData],
})
export class LeadStageModule {}
