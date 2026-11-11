import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { OrderService } from '../order.service';
import { CreditStatus, Order, OrderStatus } from 'src/schema/order_Management/order.schema';
import {
  LUMPSUM_EXCLUDED_STATUSES,
  MONEY_EPSILON,
  moneyEquals,
  toMoney,
} from '../financial/order-financial.util';
import { Subscription } from 'src/schema/order_Management/subscription.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SubscriptionsPlan } from 'src/schema/order_Management/subscriptions-plan.schema';
import { Payment } from 'src/schema/order_Management/payment.schema';
import { Lead, LeadSource } from 'src/schema/lead_management/lead.schema';
import { UserLogic } from 'src/api/user/user.logic';
import { UserActivityLogic } from 'src/api/user-activity/user-activity.logic';
import { LeadHistoryLogic } from 'src/api/lead_management/lead-history/lead-history.logic';
import { LeadActionType } from 'src/schema/lead_management/lead-history.schema';

@Injectable()
export class PaymentService {
  constructor(
    private readonly orderService: OrderService,
    @InjectModel(Subscription.name) private subscriptionModel: Model<Subscription>,
    @InjectModel(SubscriptionsPlan.name) private subscriptionsPlanModel: Model<SubscriptionsPlan>,
    @InjectModel(Payment.name)
    private paymentModel: Model<Payment>,
    @InjectModel(Order.name)
    private orderModel: Model<Order>,
    @InjectModel(Lead.name)
    private leadModel: Model<Lead>,
    private readonly userLogic: UserLogic,
    private readonly userActivityLogic: UserActivityLogic,
    private readonly leadHistoryLogic: LeadHistoryLogic,

  ) { }
  private getCashfreeHeaders() {
    return {
      'x-client-id': process.env.CASHFREE_APP_ID,
      'x-client-secret': process.env.CASHFREE_SECRET_KEY,
      'x-api-version': '2025-01-01',
      'Content-Type': 'application/json',
    };
  }

  /**
   * Unique key of a payment-link payment: link id + Cashfree order /
   * transaction id. Stable across webhook retries of the same payment.
   */
  buildLinkPaymentKey(data: any): string {
    const linkId = data?.link_id || data?.cf_link_id || 'link';
    const paymentRef =
      data?.order?.transaction_id ?? data?.order?.order_id ?? data?.cf_payment_id;
    if (paymentRef === undefined || paymentRef === null || paymentRef === '') {
      return `${linkId}:no-ref`;
    }
    return `${linkId}:${paymentRef}`;
  }

  /**
   * Validates the amount of a payment link against its target:
   *  - creditId        → must equal the (unpaid) credit amount
   *  - lumpsumEntryId  → must not exceed that entry's outstanding balance
   *  - none            → must not exceed the total outstanding lumpsum balance
   */
  async validatePaymentLinkTarget(data: {
    orderId: string;
    amount: number;
    creditId?: string;
    lumpsumEntryId?: string;
  }) {
    const amount = toMoney(data.amount);
    if (!(amount > 0)) throw new BadRequestException('Amount must be greater than 0');
    const view = await this.orderService.getFinancialSummary(data.orderId);

    if (data.creditId) {
      const credit = (view.credits || []).find(
        (c: any) => c._id?.toString() === String(data.creditId),
      );
      if (!credit) throw new BadRequestException('Credit not found on this order');
      if (credit.status === CreditStatus.PAID) {
        throw new BadRequestException('This credit is already paid');
      }
      if (!moneyEquals(credit.amount, amount)) {
        throw new BadRequestException(`Amount should be ${toMoney(credit.amount)} for this credit`);
      }
      return;
    }

    const activeLumpsum = (view.lumpsumPayments || []).filter(
      (e: any) => !LUMPSUM_EXCLUDED_STATUSES.includes(e.status),
    );
    const entries = data.lumpsumEntryId
      ? activeLumpsum.filter((e: any) => e._id?.toString() === String(data.lumpsumEntryId))
      : activeLumpsum;
    if (data.lumpsumEntryId && !entries.length) {
      throw new BadRequestException('Lumpsum payment entry not found on this order');
    }
    const outstanding = toMoney(
      entries.reduce(
        (sum: number, e: any) => sum + Math.max(0, toMoney(e.amount) - toMoney(e.amountReceived)),
        0,
      ),
    );
    if (outstanding <= 0) {
      throw new BadRequestException(
        'No lumpsum balance is pending on this order. To collect a credit, create the link with creditId.',
      );
    }
    if (amount - outstanding > MONEY_EPSILON) {
      throw new BadRequestException(`Amount should be ${outstanding}`);
    }
  }

  async createPaymentLink(data: {
    name: string;
    email: string;
    phone: string;
    amount: number;
    orderId?: string;
    creditId?: string;
    lumpsumEntryId?: string;
  },userId: string) {
    if (data.orderId) {
      const order = await this.orderService.findById(data.orderId);
      if (!order) throw new BadRequestException('Invalid orderId');
      if (!order.Approved) throw new BadRequestException('Please Approve the order first');
      if (order.status == OrderStatus.FULLY_PAID) throw new BadRequestException('No pending amount for this order');
      await this.validatePaymentLinkTarget({
        orderId: data.orderId,
        amount: data.amount,
        creditId: data.creditId,
        lumpsumEntryId: data.lumpsumEntryId,
      });
    }
    const lead= await this.leadModel.findOne({email:data.email})
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
          notify_url: 'https://crm.upskillab.in/payment/webhook',
        },
      };

      // 🔥 Attach orderId
      if (data.orderId) {
        payload.link_notes = {
          orderId: data.orderId,
          userId,
          // Payment target used by the webhook to update the right entry
          ...(data.creditId ? { creditId: String(data.creditId) } : {}),
          ...(data.lumpsumEntryId ? { lumpsumEntryId: String(data.lumpsumEntryId) } : {}),
        };
      }
      const response = await axios.post(
        'https://api.cashfree.com/pg/links',
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
      if(!!lead){
        await this.leadHistoryLogic.log({
            leadId: lead?.leadId.toString(),
            actionType: LeadActionType.PAYMENTLOG,
            actionBy: userId,
            reason:`Payment link Comes`
          });
      }
      await this.userActivityLogic.log({
              userId: userId,
              action: 'Payment Link Created',
              referenceType: 'Payment Link',
              meta: {
                message:"Payment Link Created",
                payload: { ...payload, orderId: data?.orderId },
                paymentLink: response.data.link_url,},
            });
      return {
        linkId: response.data.link_id,
        paymentLink: response.data.link_url,
      };
    } catch (error:any) {
      console.error(error.response?.data || error.message);
      throw new BadRequestException('Payment link creation failed');
    }
  }

async createleadPaymentLink(data: {
  course:string;
    amount: number;
    leadId: string;
  },userId: string) {
      const lead = await this.leadModel.findOne({leadId:Number(data.leadId)})
      if(!lead){
        throw new NotFoundException("Lead Not Found")
      }
    try {
      const payload: any = {
        customer_details: {
          customer_name: lead.name,
          customer_email: lead.email,
          customer_phone: lead.phone,
        },

        link_amount: data.amount,
        link_currency: 'INR',

        link_purpose: 'Registration Payment',

        link_notify: {
          send_sms: true,
          send_email: true,
        },

        link_meta: {
          notify_url: 'https://crm.upskillab.in/payment/webhook',
        },
      };
        payload.link_notes = {
          leadId: data.leadId,
          userId
        }
        try {
      const response = await axios.post(
        'https://api.cashfree.com/pg/links',
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
      console.log("Link Response:",response)
   

      await this.leadHistoryLogic.log({
            leadId: lead?.leadId.toString(),
            actionType: LeadActionType.PAYMENTLOG,
            actionBy: userId,
            reason:`Registration payment link in ${data.course} generated`
          });
      // await this.leadHistory
      await this.userActivityLogic.log({
              userId: userId,
              action: 'Payment Link Created',
              referenceType: 'Payment Link',
              referenceId: data?.leadId,
              meta: {
                message:"Payment Link Created",
                payload: { ...payload, leadId: data?.leadId },
                paymentLink: response.data.link_url,},
            });
      return {
        linkId: response.data.link_id,
        paymentLink: response.data.link_url,
      };
       }catch(err:any){
      console.log(err.response?.status);
  console.log(err.response?.data);
  console.log(err.message);
    }
    } catch (error:any) {
      console.error(error.response?.data || error.message);
      throw new BadRequestException('Payment link creation failed');
    }
  }
async createBootcampPaymentLink(data: {
  leadId: number;
  amount: number;
}) {
  const lead = await this.leadModel.findOne({
    leadId: Number(data.leadId),
    source: LeadSource.BOOTCAMP,
    isActive: true,
  });

  if (!lead) {
    throw new NotFoundException('Bootcamp lead not found');
  }

  try {
    const payload: any = {
      customer_details: {
        customer_name: lead.name,
        customer_email: lead.email || '',
        customer_phone: lead.phone,
      },

      link_amount: data.amount,
      link_currency: 'INR',
      link_expiry_time: "2026-10-09T21:00:00+05:30",
      link_purpose: 'Webinar The Generation Nobody Prepared Us For: Understanding Gen Z & Gen Alpha Date: October 10, 2026 Time: 8 pm to 9 pm',

      link_notify: {
        send_sms: !!lead.phone,
        send_email: !!lead.email,
      },

      link_meta: {
        notify_url:
          'https://crm.upskillab.in/bootcamp/payment/webhook',
      },

      link_notes: {
        leadId: data.leadId.toString(),
        type: 'BOOTCAMP',
      },
    };

    const response = await axios.post(
      'https://api.cashfree.com/pg/links',
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

    console.log(
      'Bootcamp Payment Link Response:',
      response.data,
    );

    return {
      linkId: response.data.link_id,
      paymentLink: response.data.link_url,
    };
  } catch (error: any) {
    console.error(
      'Cashfree Error:',
      error.response?.data || error.message,
    );

    throw new BadRequestException(
      error.response?.data?.message ||
        'Bootcamp payment link creation failed',
    );
  }
}


async getAllPayments(filters: any, user: any) {
  const {
    search,
    group,
    orderId,
    leadId,
    counsellorId,
    dateFilter,
    fromDate,
    toDate,
    page = 1,
    limit = 10,
  } = filters;

  const query: any = {};

  /* ================= GET ACCESSIBLE COUNSELLORS ================= */

  let accessibleUserIds: any[] = [];

  if (group === true || group === 'true') {
    const users = await this.userLogic.getUsersUnder(user);
    accessibleUserIds = users.map((u) => new Types.ObjectId(u._id));
    accessibleUserIds.push(user.userId);
  } else if (user.roleName === 'bd') {
    accessibleUserIds = [new Types.ObjectId(user.userId)];
    console.log(accessibleUserIds)
  }

  // If counsellorId explicitly passed → override everything
  if (counsellorId) {
    accessibleUserIds = [new Types.ObjectId(counsellorId)];
  }

  /* ================= GET ORDERS FIRST ================= */


  if (orderId) {
    query.link_notes.orderId = orderId;
  }

  // If no orders → return empty
  if (!accessibleUserIds.length) {
    return {
      data: [],
      total: 0,
      page: Number(page),
      limit: Number(limit),
      totalPages: 0,
    };
  }
  query['counsellorId'] = {$in:accessibleUserIds}
  if (leadId) query.leadId = leadId;

  /* ================= SEARCH ================= */

  if (search) {
    query.$or = [
      { 'customer_details.customer_name': { $regex: search, $options: 'i' } },
      { 'customer_details.customer_email': { $regex: search, $options: 'i' } },
      { 'customer_details.customer_phone': { $regex: search, $options: 'i' } },
    ];
  }

  /* ================= DATE FILTER ================= */

  if (dateFilter) {
    let start: Date | null = null;

    if (dateFilter === 'today') {
      start = new Date();
      start.setHours(0, 0, 0, 0);
    } else if (dateFilter === 'week') {
      start = new Date();
      start.setDate(start.getDate() - 7);
    } else if (dateFilter === 'month') {
      start = new Date();
      start.setMonth(start.getMonth() - 1);
    } else if (dateFilter === 'year') {
      start = new Date();
      start.setFullYear(start.getFullYear() - 1);
    }

    if (start) query.createdAt = { $gte: start };
  }

  if (fromDate && toDate) {
    query.createdAt = {
      $gte: new Date(fromDate),
      $lte: new Date(toDate),
    };
  }

  /* ================= PAGINATION ================= */

  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    this.paymentModel
      .find(query)
      .populate('orderRef')
      .populate('counsellorId', 'name email')
      .populate('leadId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),

    this.paymentModel.countDocuments(query),
  ]);

  return {
    data,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
  };
}

async getPaymentById(orderId: string) {
  const payment = await this.paymentModel
    .find({'link_notes.orderId': orderId})
    .populate('counsellorId', 'name email')
    .populate('leadId');
  if (!payment) {
    throw new BadRequestException('Payment not found');
  }
  return payment;
}

  async createPlan(data: {
    amount: number;
    interval: number;
    name?: string;
    plan_interval_type?: string;
    max_cycles?: number;
    max_amount?: number;
  }) {
    try {
      const response = await axios.post(
        'https://sandbox.cashfree.com/pg/plans',
        {
          plan_id: `plan_${Date.now()}`,
          plan_name: data.name || `plan_${Date.now()}`,
          plan_type: 'PERIODIC',
          plan_max_cycles: data.max_cycles,
          plan_recurring_amount: data.amount,
          plan_interval_type: data.plan_interval_type || 'MONTH',
          plan_max_amount: data.max_amount || data.amount * (data.max_cycles || 1),
          plan_currency: 'INR',
          plan_interval: data.interval,
        },
        {
          headers: this.getCashfreeHeaders(),
        },
      );
      await this.subscriptionsPlanModel.create({
        planId: response.data.plan_id,
        planName: response.data.plan_name,
        amount: data.amount,
        interval: data.interval,
        plan_interval_type: data.plan_interval_type || 'MONTH',
        max_cycles: data.max_cycles,
        max_amount: data.max_amount || data.amount * (data.max_cycles || 1),
      });

      return response.data;
    } catch (err) {
      console.error(err.response?.data);
      throw new BadRequestException('Plan creation failed');
    }
  }

  async getPlans(planId?: string) {
    try {
      const response = await axios.get(
        `https://sandbox.cashfree.com/pg/plans/${planId}`,
        {
          headers: this.getCashfreeHeaders(),
        },
      );

      return response.data;
    } catch (err) {
      console.error(err.response?.data);
      throw new BadRequestException('Failed to fetch plans');
    }
  }


  async togglePlanStatus(planId: string) {
    const existingPlan = await this.subscriptionsPlanModel.findOne({ planId });
    if (!existingPlan) {
      throw new BadRequestException('Plan not found in database');
    }
    try {
      const response = await axios.patch(
        `https://sandbox.cashfree.com/pg/subscriptions/plans/${planId}`,
        {
          plan_status: existingPlan.isActive ? 'INACTIVE' : 'ACTIVE',
        },
        {
          headers: this.getCashfreeHeaders(),
        },
      );
      existingPlan.isActive = !existingPlan.isActive;
      await existingPlan.save();
      return response.data;
    } catch (err) {
      console.error(err.response?.data);
      throw new BadRequestException(
        err.response?.data || 'Failed to toggle plan status',
      );
    }
  }

  // async createSubscription(data: any) {
  //   try {
  //     const {
  //       name,
  //       email,
  //       phone,
  //       orderId,
  //       planId, // optional if using existing plan
  //       amount,
  //     } = data;

  //     // 🔹 Validate Order mapping
  //     const subscription = await this.subscriptionModel.findOne({
  //       orderId: new Types.ObjectId(orderId),
  //     });

  //     if (!subscription) {
  //       throw new BadRequestException('Subscription not found');
  //     }

  //     const subscriptionId = `sub_${Date.now()}`;
  //     const now = new Date();
  //     now.setHours(now.getHours() + 1);

  //     const firstChargeTime = now.toISOString();
  //     const payload: any = {
  //       subscription_id: subscriptionId,

  //       customer_details: {
  //         customer_name: name,
  //         customer_email: email,
  //         customer_phone: phone,
  //       },

  //       // ✅ If using existing plan
  //       ...(planId && { plan_id: planId }),

  //       // ✅ If creating dynamic plan (optional)
  //       ...(!planId && {
  //         plan_details: {
  //           plan_name: `Plan_${Date.now()}`,
  //           plan_type: 'PERIODIC',
  //           plan_amount: subscription.installmentAmount || 100,
  //           plan_currency: 'INR',
  //           plan_interval_type: 'MONTH',
  //           plan_intervals: 1,
  //           plan_max_amount: subscription.totalAmount,
  //         },
  //       }),

  //       authorization_details: {
  //         authorization_amount: amount || 100,
  //         authorization_amount_refund: true,
  //         payment_methods: ['upi', 'card', 'netbanking', 'enach'],
  //       },

  //       subscription_meta: {
  //         // return_url: `https://your-frontend.com/payment-success?order_id=${orderId}`,
  //         notify_url: `https://6d8d-106-0-57-26.ngrok-free.app/payment/webhook`,
  //         notification_channel: ['EMAIL', 'SMS'],
  //       },

  //       subscription_expiry_time: '2100-01-01T23:00:08+05:30',
  //       subscription_first_charge_time: firstChargeTime,

  //       subscription_tags: {
  //         order_id: orderId,
  //       },
  //     };

  //     const response = await axios.post(
  //       'https://sandbox.cashfree.com/pg/subscriptions',
  //       payload,
  //       { headers: this.getCashfreeHeaders() },
  //     );

  //     const sessionId = response.data.subscription_session_id;

  //     const authLink = `https://sandbox.cashfree.com/api/v1/${sessionId}`;
  //     // 🔥 Save in DB
  //     subscription.subscriptionId = response.data.subscription_id;
  //     subscription.planId = planId || null;
  //     subscription.authLink = authLink;

  //     await subscription.save();

  //     return {
  //       authLink: authLink,
  //       subscriptionId: response.data.subscription_id,
  //     };
  //   } catch (err) {
  //     console.error(err.response?.data);
  //     throw new BadRequestException(
  //       err.response?.data || 'Subscription creation failed',
  //     );
  //   }
  // }

}