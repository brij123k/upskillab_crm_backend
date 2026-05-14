import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Order, OrderSchema } from "src/schema/order_Management/order.schema";
import { Subscription, SubscriptionSchema } from "src/schema/order_Management/subscription.schema";
import { SubscriptionPayment, SubscriptionPaymentSchema } from "src/schema/order_Management/subscription-payment.schema";
import { SubscriptionsPlan, SubscriptionsPlanSchema } from "src/schema/order_Management/subscriptions-plan.schema";
import { SubscriptionController } from "./subscription.controller";
import { SubscriptionService } from "./subscription.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: SubscriptionPayment.name, schema: SubscriptionPaymentSchema },
      { name: Order.name, schema: OrderSchema },
      { name: SubscriptionsPlan.name, schema: SubscriptionsPlanSchema },
    ]),
  ],
  controllers: [SubscriptionController],
  providers: [SubscriptionService],
})
export class SubscriptionModule {}
