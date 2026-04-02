import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { OrderModule } from '../order.module';
import { MongooseModule } from '@nestjs/mongoose';
import { Subscription, SubscriptionSchema } from 'src/schema/order_Management/subscription.schema';
import { SubscriptionsPlan, SubscriptionsPlanSchema } from 'src/schema/order_Management/subscriptions-plan.schema';
import { Payment, PaymentSchema } from 'src/schema/order_Management/payment.schema';
import { Order, OrderSchema } from 'src/schema/order_Management/order.schema';
import { Lead, LeadSchema } from 'src/schema/lead_management/lead.schema';
import { UserModule } from 'src/api/user/user.module';
import { UserActivityModule } from 'src/api/user-activity/user-activity.module';

@Module({
  imports: [
    MongooseModule.forFeature([
          { name: Subscription.name, schema: SubscriptionSchema },
          { name: SubscriptionsPlan.name, schema: SubscriptionsPlanSchema },
          { name: Payment.name, schema: PaymentSchema },
          { name: Order.name, schema: OrderSchema },
          { name: Lead.name, schema: LeadSchema },
        ])
        ,OrderModule,
        UserModule,
        UserActivityModule,
      ],
  providers: [PaymentService],
  controllers: [PaymentController],
})
export class PaymentModule {}