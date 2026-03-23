import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { OrderService } from '../order.service';

@ApiTags('Payment')
@Controller('payment')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly orderService: OrderService,
  ) {}

  // 1️⃣ Generate Payment Link
  @Post('create-link')
  async createPaymentLink(@Body() body: any) {
    return this.paymentService.createPaymentLink(body);
  }

  // 2️⃣ Webhook (AUTO UPDATE ORDER)
@Post('webhook')
async webhook(@Body() body: any) {
  try {
    // console.log('Webhook Body:', JSON.stringify(body, null, 2));

    // ✅ Check correct event
    if (body?.type !== 'PAYMENT_SUCCESS_WEBHOOK') {
      return { message: 'Ignored non-success event' };
    }

    const payment = body?.data?.payment;

    const paymentStatus = payment?.payment_status;
    const amount = payment?.payment_amount;

    // 🔥 IMPORTANT FIX (Payment Link structure)
    const orderId = body?.data?.order?.order_tags?.orderId;

    if (paymentStatus === 'SUCCESS') {
      if (orderId) {
        await this.orderService.applyPayment(orderId, amount);
      } else {
        console.log('⚠️ No orderId found (standalone payment)');
      }
    }

    return { message: 'Webhook processed successfully' };
  } catch (err) {
    console.error('Webhook Error:', err);
    return { message: 'Webhook error' };
  }
}
}