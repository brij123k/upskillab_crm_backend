import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from 'src/schema/order_Management/order.schema';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { Pool, PoolSchema } from 'src/schema/Pool.schema';
import { EmiCronService } from './emi-cron.service';
import {
  LoanEmi,
  LoanEmiSchema,
} from 'src/schema/order_Management/loan-emi.schema';
import {
  Subscription,
  SubscriptionSchema,
} from 'src/schema/order_Management/subscription.schema';
import { UserModule } from '../user/user.module';
import {
  SubscriptionsPlan,
  SubscriptionsPlanSchema,
} from 'src/schema/order_Management/subscriptions-plan.schema';
import { UserActivityModule } from '../user-activity/user-activity.module';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { User, UserSchema } from 'src/schema/user.schema';
import { CallLog, CallLogSchema } from 'src/schema/call-log.schema';
import { Role, RoleSchema } from 'src/schema/role.schema';
import {
  LeadStage,
  LeadStageSchema,
} from 'src/schema/lead_management/lead-stage.schema';
import {
  LeadStageHistory,
  LeadStageHistorySchema,
} from 'src/schema/lead_management/LeadStageHistory.schema';
import {
  CreditNotificationLog,
  CreditNotificationLogSchema,
  CreditNotificationRun,
  CreditNotificationRunSchema,
} from 'src/schema/order_Management/credit-notification.schema';
import { NotificationModule } from 'src/notifications/notification.module';
import { OrderFinancialModule } from './financial/order-financial.module';
import { PendingCreditService } from './credits/pending-credit.service';
import { PendingCreditNotificationService } from './credits/pending-credit-notification.service';
@Module({
  imports: [
    UserModule,
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Pool.name, schema: PoolSchema },
      { name: LoanEmi.name, schema: LoanEmiSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: SubscriptionsPlan.name, schema: SubscriptionsPlanSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: User.name, schema: UserSchema },
      { name: CallLog.name, schema: CallLogSchema },
      { name: Role.name, schema: RoleSchema },
      { name: LeadStage.name, schema: LeadStageSchema },
      { name: LeadStageHistory.name, schema: LeadStageHistorySchema },
      { name: CreditNotificationLog.name, schema: CreditNotificationLogSchema },
      { name: CreditNotificationRun.name, schema: CreditNotificationRunSchema },
    ]),
    UserActivityModule,
    NotificationModule,
    OrderFinancialModule,
  ],
  controllers: [OrderController],
  providers: [
    OrderService,
    EmiCronService,
    PendingCreditService,
    PendingCreditNotificationService,
  ],
  exports: [OrderService, EmiCronService, OrderFinancialModule],
})
export class OrderModule {}
