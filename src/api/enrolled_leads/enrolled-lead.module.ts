import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserModule } from '../user/user.module';
import { SmartfloModule } from '../smartflo/smartflo.module';
import { CallLog, CallLogSchema } from 'src/schema/call-log.schema';
import { User, UserSchema } from 'src/schema/user.schema';
import {
  EnrolledLead,
  EnrolledLeadSchema,
} from 'src/schema/enrolled_leads/enrolled-lead.schema';
import {
  EnrolledLeadHistory,
  EnrolledLeadHistorySchema,
  EnrolledLeadStage,
  EnrolledLeadStageSchema,
  EnrolledLeadSyncRun,
  EnrolledLeadSyncRunSchema,
} from 'src/schema/enrolled_leads/enrolled-lead-meta.schema';
import {
  UpskillabBatch,
  UpskillabBatchSchema,
  UpskillabCourse,
  UpskillabCourseSchema,
} from 'src/schema/enrolled_leads/upskillab-catalog.schema';
import { EnrolledLeadController } from './enrolled-lead.controller';
import { EnrolledLeadService } from './enrolled-lead.service';
import { EnrolledLeadSyncService } from './enrolled-lead-sync.service';
import { EnrolledLeadStageService } from './enrolled-lead-stage.service';
import { UpskillabClient } from './upskillab.client';

@Module({
  imports: [
    UserModule,
    SmartfloModule,
    MongooseModule.forFeature([
      { name: CallLog.name, schema: CallLogSchema },
      { name: EnrolledLead.name, schema: EnrolledLeadSchema },
      { name: EnrolledLeadHistory.name, schema: EnrolledLeadHistorySchema },
      { name: EnrolledLeadStage.name, schema: EnrolledLeadStageSchema },
      { name: EnrolledLeadSyncRun.name, schema: EnrolledLeadSyncRunSchema },
      { name: UpskillabCourse.name, schema: UpskillabCourseSchema },
      { name: UpskillabBatch.name, schema: UpskillabBatchSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [EnrolledLeadController],
  providers: [
    EnrolledLeadService,
    EnrolledLeadSyncService,
    EnrolledLeadStageService,
    UpskillabClient,
  ],
  exports: [EnrolledLeadSyncService],
})
export class EnrolledLeadModule {}
