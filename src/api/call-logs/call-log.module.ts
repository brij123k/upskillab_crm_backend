import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { CallLogController } from './call-log.controller';
import { CallLogLogic } from './call-log.logic';
import { CallLogData } from './call-log.data';
import { CallLogSchema,CallLog } from 'src/schema/call-log.schema';
import { LeadHistoryModule } from '../lead_management/lead-history/lead-history.module';
import { UserActivityModule } from '../user-activity/user-activity.module';
import { CallLogReview,CallLogReviewSchema } from 'src/schema/all-log-review.schema';
import { LeadModule } from '../lead_management/lead/lead.module';
import { UserModule } from '../user/user.module';
import { LeadStage, LeadStageSchema } from 'src/schema/lead_management/lead-stage.schema';
import { Order, OrderSchema } from 'src/schema/order_Management/order.schema';
import { Pool, PoolSchema } from 'src/schema/Pool.schema';
import { User, UserSchema } from 'src/schema/user.schema';
import { Role, RoleSchema } from 'src/schema/role.schema';
import {LeadInteractionLog,LeadInteractionLogSchema} from 'src/schema/lead-interaction-log.schema'
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CallLog.name, schema: CallLogSchema },
      { name: LeadInteractionLog.name, schema: LeadInteractionLogSchema },
      { name: CallLogReview.name, schema: CallLogReviewSchema },
      { name: Lead.name, schema: LeadSchema },
      {name:LeadStage.name, schema:LeadStageSchema},
      { name: Order.name, schema: OrderSchema },
      { name: Pool.name, schema: PoolSchema },
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
    LeadHistoryModule,
    UserActivityModule,
    LeadModule,
    UserModule,
  ],
  controllers: [CallLogController],
  providers: [CallLogLogic, CallLogData],
})
export class callLogModule {}
