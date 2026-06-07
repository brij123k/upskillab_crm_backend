import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserReportController } from './user-report.controller';
import { UserReportService } from './user-report.service';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { CallLog, CallLogSchema } from 'src/schema/call-log.schema';
import { Order, OrderSchema } from 'src/schema/order_Management/order.schema';
import { User, UserSchema } from 'src/schema/user.schema';
import { LeadHistory, LeadHistorySchema } from 'src/schema/lead_management/lead-history.schema';

import { LeadModule } from 'src/api/lead_management/lead/lead.module';
import { OrderModule } from 'src/api/order_management/order.module';
import { LeadHistoryModule } from 'src/api/lead_management/lead-history/lead-history.module';
import { UserModule } from 'src/api/user/user.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: CallLog.name, schema: CallLogSchema },
      { name: Order.name, schema: OrderSchema },
      { name: User.name, schema: UserSchema },
      { name: LeadHistory.name, schema: LeadHistorySchema },
    ]),
    UserModule,
    LeadModule,
    OrderModule,
    LeadHistoryModule,
  ],
  controllers: [UserReportController],
  providers: [UserReportService],
})
export class UserReportModule {}
