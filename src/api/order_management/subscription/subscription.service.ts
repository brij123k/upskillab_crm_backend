import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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

    const paymentMethod = dto.payment_methods[0];
    this.validatePayment(paymentMethod, dto.payment_details);

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
      if (!dto.amount)
        throw new BadRequestException('Amount required without plan');

      planDetails = {
        plan_name: 'Custom Plan',
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

        customer_bank_account_number:
          dto.payment_details.accountNumber,
        customer_bank_ifsc: dto.payment_details.ifsc,
        customer_bank_code: dto.payment_details.bankCode,
        customer_bank_account_type:
          dto.payment_details.accountType,
        customer_bank_account_holder_name:
          dto.payment_details.accountHolderName,
      },

      plan_details: {
        ...planDetails,
        plan_type: 'PERIODIC',
      },

      authorization_details: {
        authorization_amount: planDetails.plan_amount,
        authorization_amount_refund: true,
        payment_methods: dto.payment_methods,
      },

      subscription_meta: {
        return_url: `https://c7ce-103-82-150-251.ngrok-free.app/subscription/webhook/cashfree`,
        notification_channel: ['EMAIL', 'SMS'],
      },

      subscription_first_charge_time: firstChargeDate.toISOString(),
      subscription_expiry_time: '2100-01-01T23:00:08+05:30',
      subscription_note: 'Subscription',
      subscription_tags: {
          order_id: order._id.toString(),
        },
    };


    // // 🔥 CASHFREE CALL
    const res = await axios.post(
      'https://sandbox.cashfree.com/pg/subscriptions',
      payload,
      {
        headers: {
          'x-client-id': process.env.CASHFREE_APP_ID,
          'x-client-secret': process.env.CASHFREE_SECRET_KEY,
          'x-api-version': '2025-01-01',
          'Content-Type': 'application/json',
        },
      },
    );
    
    const authRes = await axios.post(
  `https://sandbox.cashfree.com/pg/subscriptions/${subscriptionId}/authorize`,
  {
    subscription_session_id: res.data.subscription_session_id,
  },
  {
    headers: {
      'x-client-id': process.env.CASHFREE_APP_ID,
      'x-client-secret': process.env.CASHFREE_SECRET_KEY,
      'x-api-version': '2025-01-01',
      'Content-Type': 'application/json',
    },
  },
);

const authLink = authRes.data?.auth_link;

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
      cashfreeSubscriptionId: subscriptionId,
      studentName: order.studentName,
      mobile: order.mobile,
      email: order.email,
      counselorName: order.counsellorName,
      totalAmount: order.finalFee,
      installmentAmount: planDetails.plan_amount,
      numberOfInstallments: planDetails.plan_max_cycles,
      installments,
      paymentMethod,
      paymentDetails: dto.payment_details,
      authLink,
      status: 'PENDING_AUTH',
    });

    // 🔥 UPDATE ORDER
    // order.subscriptionDetails = {
    //   subscriptionId,
    //   gateway: 'Cashfree',
    //   installmentAmount: planDetails.plan_amount,
    // };
    // await order.save();
    
    return {
      authLink,
      subscription,
    };
    // return { message: 'Subscription creation is currently disabled' };
  }

  // 🔁 WEBHOOK
  async webhook(body: any) {
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
}