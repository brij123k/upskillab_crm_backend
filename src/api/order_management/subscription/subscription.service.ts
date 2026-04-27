import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import axios from 'axios';
import { Subscription } from 'src/schema/order_Management/subscription.schema';
import { CreateSubscriptionDto } from 'src/dto/order_management/createsubscription.dto';
import { Order } from 'src/schema/order_Management/order.schema';
import { SubscriptionsPlan } from 'src/schema/order_Management/subscriptions-plan.schema';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectModel('Subscription') private subModel: Model<Subscription>,
    @InjectModel('Order') private orderModel: Model<Order>,
    @InjectModel('SubscriptionsPlan')
    private planModel: Model<SubscriptionsPlan>,
  ) {}

  // 🔥 VALIDATION
  validatePayment(method: string, details: any) {
    if (['enach', 'pnach'].includes(method)) {
      if (!details.accountNumber || !details.ifsc) {
        throw new BadRequestException('Bank details required');
      }
    }

    if (method === 'upi') {
      if (!details.upiId) {
        throw new BadRequestException('UPI ID required');
      }
    }

    if (method === 'card') {
      if (!details.cardNumber) {
        throw new BadRequestException('Card details required');
      }
    }
  }

  // 🚀 CREATE SUBSCRIPTION
  async create(dto: CreateSubscriptionDto) {
    const order = await this.orderModel.findById(dto.orderId);
    if (!order) throw new BadRequestException('Order not found');

    const exist = await this.subModel.findOne({orderId:dto.orderId})
    if(exist){
      return exist
    }
    // 🔥 PLAN HANDLING
    let planDetails;

    if (dto.planId) {
      const plan = await this.planModel.findOne({ planId: dto.planId });
      if (!plan) throw new BadRequestException('Invalid plan');

      planDetails = {
        plan_name: plan.planName,
        plan_amount: plan.amount,
        plan_max_amount: plan.max_amount,
        plan_max_cycles: plan.max_cycles,
        plan_intervals: plan.interval,
        plan_interval_type: plan.plan_interval_type,
        plan_currency: 'INR',
      };
    } else {
      planDetails = {
        plan_name: `plan_${Date.now()}`,
        plan_amount: order.subscriptionDetails.installmentAmount,
        plan_max_amount: (order.subscriptionDetails.installmentAmount)*(order.subscriptionDetails.numberOfInstallments),
        plan_max_cycles: order.subscriptionDetails.numberOfInstallments,
        plan_intervals: 1,
        plan_interval_type: 'MONTH',
        plan_currency: 'INR',
      };
    }

    const subscriptionId = `sub_${Date.now()}`;
    const now = new Date();
      const firstChargeDate = new Date();
      firstChargeDate.setDate(firstChargeDate.getDate() + 1);
    // // 🔥 CASHFREE PAYLOAD
    const payload = {
      subscription_id: subscriptionId,
      customer_details: {
        customer_name: order.studentName,
        customer_email: order.email,
        customer_phone: order.mobile,
      },

      plan_details: {
        ...planDetails,
        plan_type: 'PERIODIC',
      },

      authorization_details: {
        authorization_amount: 1,
        authorization_amount_refund: true,
        payment_methods: ["upi","enach","pnach","card"]
      },

      // subscription_meta: {
      //   return_url: process.env.CASHFREE_NOTIFY_URL,
      //   notification_channel: ['EMAIL', 'SMS'],
      // },

      subscription_first_charge_time: firstChargeDate.toISOString(),
      subscription_expiry_time: '2100-01-01T23:00:08+05:30',
      subscription_note: 'Subscription',
      subscription_tags: {
          order_id: order._id.toString(),
        },
    };

    // // 🔥 CASHFREE CALL
    const res = await axios.post(
      `${process.env.CASHFREE_URL}`,
      payload,
      {
        headers: {
          'x-client-id': process.env.CASHFREE_APP_ID,
          'x-client-secret': process.env.CASHFREE_SECRET_KEY,
          'x-api-version': process.env.CASHFREE_API_VERSION,
          'Content-Type': 'application/json',
        },
      },
    );
    const data = res?.data;
    const cashfreeSubscriptionId = data?.subscription_session_id 
    // 🔥 INSTALLMENTS CREATE
    const installments: any[] = [];
    const start = new Date();
    for (let i = 0; i < planDetails.plan_max_cycles; i++) {
      const d = new Date(start);
      d.setMonth(d.getMonth() + i);

      installments.push({
        installmentNo: i + 1,
        dueDate: d,
        amount: planDetails.plan_amount,
      });
    }

    // 🔥 SAVE SUBSCRIPTION
    const subscription = await this.subModel.create({
      orderId: order._id,
      subscriptionId,
      cashfreeSubscriptionId: cashfreeSubscriptionId,
      studentName: order.studentName,
      mobile: order.mobile,
      email: order.email,
      counselorName: order.counsellorName,
      totalAmount: order.finalFee,
      installmentAmount: planDetails.plan_amount,
      numberOfInstallments: planDetails.plan_max_cycles,
      installments,
      status: 'PENDING_AUTH',
    });

    // 🔥 UPDATE ORDER
    order.subscriptionDetails = {
      cashfreeSubscriptionId,
      gateway: 'Cashfree',
      installmentAmount: planDetails.plan_amount,
    };
    await order.save();
    
   return {
  cashfreeSubscriptionId,
};
    // return { message: 'Subscription creation is currently disabled' };
  }

  // 🔁 WEBHOOK
  async webhook(body: any) {
    console.log(body)
    const subId = body?.data?.subscription?.subscription_id;

    const subscription = await this.subModel.findOne({
      subscriptionId: subId,
    });

    if (!subscription) return;

    const type = body.type;

    if (type === 'SUBSCRIPTION_ACTIVATED') {
      subscription.authStatus = 'SUCCESS';
      subscription.status = 'ACTIVE';
    }

    if (type === 'PAYMENT_SUCCESS') {
      const next = subscription.installments.find(
        (i) => !i.isPaid,
      );

      if (next) {
        next.isPaid = true;
        next.paidAt = new Date();
      }
    }

    if (type === 'PAYMENT_FAILED') {
      subscription.status = 'OVERDUE';
    }

    subscription.webhookLogs.push(body);

    await subscription.save();
  }

  async getSubscription(orderId:string){
    const exist = await this.orderModel.findById(orderId)
    if(!exist){throw new NotFoundException("Order Not Found")}
    return await this.subModel.findOne({orderId:new Types.ObjectId(orderId)})
  }
}
