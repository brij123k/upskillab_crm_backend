import { Injectable, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { OrderService } from '../order.service';
import { OrderStatus } from 'src/schema/order_Management/order.schema';

@Injectable()
export class PaymentService {
  constructor(
      private readonly orderService: OrderService,
    ) {}
   async createPaymentLink(data: {
    name: string;
    email: string;
    phone: string;
    amount: number;
    orderId?: string;
  }) {
    if(data.orderId){
      const order = await this.orderService.findById(data.orderId);
      if(!order) throw new BadRequestException('Invalid orderId');
      if(!order.Approved) throw new BadRequestException('Please Approve the order first');
      if(order.status == OrderStatus.FULLY_PAID) throw new BadRequestException('No pending amount for this order');
      if(order.finalFee - (order.lumpsumDetails?.totalReceived || 0) < data.amount) {
        throw new BadRequestException(`Amount should be ${order.finalFee - (order.lumpsumDetails?.totalReceived || 0)}`);
      }
    }
    try {
      const payload: any = {
        customer_details: {
          customer_name: data.name,
          customer_email: data.email,
          customer_phone: data.phone,
        },

        link_amount: data.amount,
        link_currency: 'INR',

        link_purpose: 'Order Payment',

        link_notify: {
          send_sms: true,
          send_email: true,
        },

        link_meta: {
          notify_url: 'https://1d92-106-0-58-189.ngrok-free.app/payment/webhook',
        },
      };

      // 🔥 Attach orderId
      if (data.orderId) {
        payload.link_notes = {
          orderId: data.orderId,
        };
      }
      console.log('Creating payment link with payload:', payload);
      const response = await axios.post(
        'https://sandbox.cashfree.com/pg/links',
        payload,
        {
          headers: {
            'x-client-id': process.env.CASHFREE_APP_ID,
            'x-client-secret': process.env.CASHFREE_SECRET_KEY,
            'x-api-version': '2022-09-01',
            'Content-Type': 'application/json',
          },
        },
      );

      return {
        linkId: response.data.link_id,
        paymentLink: response.data.link_url,
      };
    } catch (error) {
      console.error(error.response?.data || error.message);
      throw new BadRequestException('Payment link creation failed');
    }
  }
}