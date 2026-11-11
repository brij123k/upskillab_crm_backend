import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from 'src/schema/order_Management/order.schema';
import {
  LoanEmi,
  LoanEmiSchema,
} from 'src/schema/order_Management/loan-emi.schema';
import {
  ProcessedPaymentEvent,
  ProcessedPaymentEventSchema,
} from 'src/schema/order_Management/processed-payment-event.schema';
import {
  Subscription,
  SubscriptionSchema,
} from 'src/schema/order_Management/subscription.schema';
import {
  SubscriptionPayment,
  SubscriptionPaymentSchema,
} from 'src/schema/order_Management/subscription-payment.schema';
import { OrderFinancialService } from './order-financial.service';

/**
 * Centralised order financial logic, shared by the Order, Payment and
 * Subscription modules so that every write path uses the same rules.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: LoanEmi.name, schema: LoanEmiSchema },
      { name: ProcessedPaymentEvent.name, schema: ProcessedPaymentEventSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: SubscriptionPayment.name, schema: SubscriptionPaymentSchema },
    ]),
  ],
  providers: [OrderFinancialService],
  exports: [OrderFinancialService],
})
export class OrderFinancialModule {}
