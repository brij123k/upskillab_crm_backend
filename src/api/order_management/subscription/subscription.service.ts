import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import axios from 'axios';
import crypto from 'crypto';
import { Subscription } from 'src/schema/order_Management/subscription.schema';
import { CreateSubscriptionDto } from 'src/dto/order_management/createsubscription.dto';
import { Order, OrderStatus } from 'src/schema/order_Management/order.schema';
import { SubscriptionsPlan } from 'src/schema/order_Management/subscriptions-plan.schema';
import {
  SubscriptionPayment,
} from 'src/schema/order_Management/subscription-payment.schema';

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectModel('Subscription') private subModel: Model<Subscription>,
    @InjectModel('SubscriptionPayment')
    private paymentModel: Model<SubscriptionPayment>,
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

  private getWebhookSecret() {
    return process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_SECRET_KEY;
  }

  private verifyWebhookSignature(rawBody: string, timestamp?: string, signature?: string) {
    if (!timestamp || !signature) {
      throw new BadRequestException('Missing webhook signature headers');
    }

    const secret = this.getWebhookSecret();
    if (!secret) {
      throw new BadRequestException('Cashfree webhook secret is not configured');
    }

    const generatedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}${rawBody}`)
      .digest('base64');

    if (generatedSignature !== signature) {
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  private safeJsonParse(rawBody: any) {
    if (!rawBody) return {};
    if (typeof rawBody === 'object') return rawBody;
    try {
      return JSON.parse(rawBody);
    } catch {
      return {};
    }
  }

  private toDate(value: any) {
    if (!value) return undefined;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private sameDay(first?: Date, second?: Date) {
    if (!first || !second) return false;
    return first.toDateString() === second.toDateString();
  }

  private getWebhookIdentifiers(body: any) {
    const data = body?.data || {};
    const subscriptionDetails = data?.subscription_details || {};
    const paymentGatewayDetails = data?.payment_gateway_details || {};

    return {
      subscriptionId:
        subscriptionDetails.subscription_id ||
        data?.subscription_id ||
        body?.subscription_id ||
        paymentGatewayDetails.gateway_subscription_id,
      cashfreeSubscriptionId:
        subscriptionDetails.cf_subscription_id ||
        data?.cf_subscription_id ||
        paymentGatewayDetails.gateway_subscription_id,
      orderId:
        subscriptionDetails?.subscription_tags?.order_id ||
        data?.subscription_tags?.order_id ||
        data?.cf_order_id ||
        body?.order_id,
    };
  }

  private getInstallmentTarget(subscription: Subscription, body: any) {
    const data = body?.data || {};
    const paymentScheduleDate = this.toDate(data?.payment_schedule_date);

    if (paymentScheduleDate) {
      const scheduledInstallment = subscription.installments.find((inst) =>
        this.sameDay(new Date(inst.dueDate), paymentScheduleDate),
      );

      if (scheduledInstallment) {
        return scheduledInstallment;
      }
    }

    return subscription.installments.find((inst) => !inst.isPaid);
  }

  private async createPaymentRecord(
    subscription: Subscription,
    body: any,
    eventType: string,
    installment?: any,
  ) {
    const data = body?.data || {};
    const identifiers = this.getWebhookIdentifiers(body);
    const order = await this.orderModel.findById(subscription.orderId).lean();

    const record = await this.paymentModel.create({
      subscriptionRef: (subscription as any)._id,
      orderId: subscription.orderId,
      orderName: order?.studentName,
      subscriptionId: identifiers.subscriptionId || subscription.subscriptionId,
      cashfreeSubscriptionId:
        identifiers.cashfreeSubscriptionId || subscription.cashfreeSubscriptionId,
      eventType,
      studentName: subscription.studentName,
      mobile: subscription.mobile,
      email: subscription.email,
      counselorName: subscription.counselorName,
      installmentNo: installment?.installmentNo,
      installmentDueDate: installment?.dueDate,
      installmentStatus: installment?.isPaid
        ? 'PAID'
        : installment?.failedAt
          ? 'FAILED'
          : eventType,
      installmentAmount: installment?.amount || subscription.installmentAmount,
      subscriptionStatus: subscription.status,

      paymentId: data?.payment_id,
      cfPaymentId: data?.cf_payment_id,
      cfTxnId: data?.cf_txn_id,
      cfOrderId: data?.cf_order_id,
      paymentType: data?.payment_type,
      paymentStatus: data?.payment_status,
      authorizationStatus:
        data?.authorization_details?.authorization_status || data?.payment_status,
      paymentAmount: data?.payment_amount ? Number(data.payment_amount) : undefined,
      paymentCurrency: data?.payment_currency,
      paymentScheduleDate: this.toDate(data?.payment_schedule_date),
      paymentInitiatedDate: this.toDate(data?.payment_initiated_date),
      paymentRemarks: data?.payment_remarks,
      retryAttempts: data?.retry_attempts,
      failureDetails: data?.failure_details || data?.failureDetails,
      authorizationDetails: data?.authorization_details,
      paymentGatewayDetails: data?.payment_gateway_details,
      rawPayload: body,
      eventTime: this.toDate(body?.event_time),
    });

    subscription.paymentRecords = subscription.paymentRecords || [];
    subscription.paymentRecords.push(record._id as Types.ObjectId);

    return record;
  }

  // 🚀 CREATE SUBSCRIPTION
  async create(dto: CreateSubscriptionDto) {
    const order = await this.orderModel.findById(dto.orderId);
    if (!order) throw new BadRequestException('Order not found');

    const exist = await this.subModel.findOne({ orderId: dto.orderId });
    if (exist) {
      return exist;
    }

    // 🔥 PLAN HANDLING
    let planDetails: any;

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
      if (
        !order.subscriptionDetails?.installmentAmount ||
        !order.subscriptionDetails?.numberOfInstallments
      ) {
        throw new BadRequestException(
          'Subscription installment details are missing on the order',
        );
      }

      planDetails = {
        plan_name: `plan_${Date.now()}`,
        plan_amount: order.subscriptionDetails?.installmentAmount,
        plan_max_amount:
          order.subscriptionDetails?.installmentAmount *
          order.subscriptionDetails?.numberOfInstallments,
        plan_max_cycles: order.subscriptionDetails?.numberOfInstallments,
        plan_intervals: 1,
        plan_interval_type: 'MONTH',
        plan_currency: 'INR',
      };
    }

    const subscriptionId = `sub_${Date.now()}`;
    const firstChargeDate = new Date();
    firstChargeDate.setDate(firstChargeDate.getDate() + 1);

    // 🔥 CASHFREE PAYLOAD
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
        payment_methods: ['upi', 'enach', 'pnach', 'card'],
      },

      // subscription_meta: {
      //   return_url: process.env.CASHFREE_NOTIFY_URL,
      // },

      subscription_first_charge_time: firstChargeDate.toISOString(),
      subscription_expiry_time: '2100-01-01T23:00:08+05:30',
      subscription_note: 'Subscription',
      subscription_tags: {
        order_id: order._id.toString(),
      },
    };

    // 🔥 CASHFREE CALL
    const res = await axios.post(`${process.env.CASHFREE_URL}`, payload, {
      headers: {
        'x-client-id': process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'x-api-version': process.env.CASHFREE_API_VERSION,
        'Content-Type': 'application/json',
      },
    });

    const data = res?.data;
    const cashfreeSubscriptionId = data?.subscription_session_id;

    // 🔥 INSTALLMENTS CREATE
    const installments: any[] = [];
    const start = new Date(firstChargeDate);

    for (let i = 0; i < Number(planDetails.plan_max_cycles || 0); i++) {
      const dueDate = new Date(start);
      dueDate.setMonth(dueDate.getMonth() + i);

      installments.push({
        installmentNo: i + 1,
        dueDate,
        amount: planDetails.plan_amount,
        isPaid: false,
        reminderSent: false,
      });
    }

    // 🔥 SAVE SUBSCRIPTION
    const subscription = await this.subModel.create({
      orderId: order._id,
      subscriptionId,
      cashfreeSubscriptionId,
      studentName: order.studentName,
      mobile: order.mobile,
      email: order.email,
      counselorName: order.counsellorName,
      totalAmount: order.finalFee,
      installmentAmount: planDetails.plan_amount,
      numberOfInstallments: planDetails.plan_max_cycles,
      firstInstallmentDate: firstChargeDate,
      lastInstallmentDate: installments.length
        ? installments[installments.length - 1].dueDate
        : undefined,
      installments,
      authStatus: 'PENDING',
      status: 'PENDING_AUTH',
      paymentRecords: [],
      webhookLogs: [],
    });

    // 🔥 UPDATE ORDER
    order.subscriptionDetails = {
      cashfreeSubscriptionId,
      gateway: 'Cashfree',
      installmentAmount: planDetails.plan_amount,
      firstInstallmentDate: firstChargeDate,
      lastInstallmentDate: installments.length
        ? installments[installments.length - 1].dueDate
        : undefined,
      numberOfInstallments: planDetails.plan_max_cycles,
      status: 'PENDING_AUTH',
    };
    await order.save();

    return {
      cashfreeSubscriptionId,
      subscriptionId,
    };
  }

  // 🔁 WEBHOOK
  async webhook(req: any) {
    const rawBody =
      typeof req?.rawBody === 'string'
        ? req.rawBody
        : Buffer.isBuffer(req?.rawBody)
          ? req.rawBody.toString('utf8')
          : typeof req?.body === 'string'
            ? req.body
            : JSON.stringify(req?.body || {});

    const body = this.safeJsonParse(req?.body || rawBody);
    console.log(body,"1")
    this.verifyWebhookSignature(
      rawBody,
      req?.headers?.['x-webhook-timestamp'],
      req?.headers?.['x-webhook-signature'],
    );

    const eventType = body?.type;
    if (!eventType) {
      throw new BadRequestException('Invalid webhook payload');
    }

    const identifiers = this.getWebhookIdentifiers(body);
    const orderObjectId =
      identifiers.orderId && Types.ObjectId.isValid(identifiers.orderId)
        ? new Types.ObjectId(identifiers.orderId)
        : null;
    const subscriptionFilter: any = {};

    if (identifiers.subscriptionId) {
      subscriptionFilter.subscriptionId = identifiers.subscriptionId;
    }

    if (identifiers.cashfreeSubscriptionId) {
      subscriptionFilter.cashfreeSubscriptionId = identifiers.cashfreeSubscriptionId;
    }

    if (orderObjectId) {
      subscriptionFilter.orderId = orderObjectId;
    }

    if (!Object.keys(subscriptionFilter).length) {
      throw new BadRequestException('Unable to identify subscription from webhook');
    }

    const subscription = await this.subModel.findOne(subscriptionFilter);

    if (!subscription) {
      return { message: 'Subscription not found, event ignored' };
    }

    const data = body?.data || {};
    const subscriptionDetails = data?.subscription_details || {};
    const authorizationDetails = data?.authorization_details || {};

    let order = await this.orderModel.findById(subscription.orderId);

    if (eventType === 'SUBSCRIPTION_STATUS_CHANGED') {
      const paymentRecord = await this.createPaymentRecord(subscription, body, eventType);
      subscription.status =
        subscriptionDetails.subscription_status || subscription.status;
      subscription.paymentMethod =
        authorizationDetails?.payment_group ||
        authorizationDetails?.payment_method ||
        subscription.paymentMethod;
      subscription.paymentDetails = {
        ...(subscription.paymentDetails || {}),
        subscriptionDetails,
        authorizationDetails,
        paymentGatewayDetails: data?.payment_gateway_details,
        statusEvent: paymentRecord.toObject(),
      };
      paymentRecord.subscriptionStatus = subscription.status;
      paymentRecord.installmentStatus = subscription.status;
      await (paymentRecord as any).save();
    }

    if (eventType === 'SUBSCRIPTION_AUTH_STATUS') {
      const authStatus =
        authorizationDetails.authorization_status ||
        data?.payment_status ||
        'PENDING';
      const paymentRecord = await this.createPaymentRecord(subscription, body, eventType);

      subscription.authStatus = authStatus;
      subscription.status = authStatus === 'ACTIVE' || authStatus === 'SUCCESS'
        ? 'ACTIVE'
        : subscription.status === 'PENDING_AUTH'
          ? 'ON_HOLD'
          : subscription.status;
      subscription.paymentMethod =
        authorizationDetails?.payment_group ||
        authorizationDetails?.payment_method ||
        subscription.paymentMethod;
      subscription.paymentDetails = {
        ...(subscription.paymentDetails || {}),
        authStatus,
        authorizationDetails,
        paymentGatewayDetails: data?.payment_gateway_details,
        authEvent: paymentRecord.toObject(),
      };
      paymentRecord.subscriptionStatus = subscription.status;
      paymentRecord.installmentStatus = authStatus;
      await (paymentRecord as any).save();
    }

    if (eventType === 'SUBSCRIPTION_PAYMENT_SUCCESS') {
      const target = this.getInstallmentTarget(subscription, body);
      const paymentRecord = await this.createPaymentRecord(subscription, body, eventType, target);

      if (target) {
        target.isPaid = true;
        target.paidAt = this.toDate(body?.event_time) || new Date();
        target.paymentRecordId = paymentRecord._id;
        target.paymentStatus = data?.payment_status || 'SUCCESS';
        target.lastEventType = eventType;
        target.failedAt = undefined;
        target.failureReason = undefined;
      }

      const allPaid = subscription.installments.every((inst) => inst.isPaid);
      subscription.status = allPaid ? 'COMPLETED' : 'ACTIVE';
      subscription.paymentDetails = {
        ...(subscription.paymentDetails || {}),
        lastSuccessfulPayment: paymentRecord.toObject(),
        paymentGatewayDetails: data?.payment_gateway_details,
      };
      paymentRecord.subscriptionStatus = subscription.status;
      paymentRecord.installmentStatus = target?.isPaid ? 'PAID' : 'SUCCESS';
      await (paymentRecord as any).save();

      if (order) {
        order.subscriptionDetails = {
          ...(order.subscriptionDetails || {}),
          cashfreeSubscriptionId:
            subscription.cashfreeSubscriptionId ||
            order.subscriptionDetails?.cashfreeSubscriptionId,
          gateway: 'Cashfree',
          installmentAmount: subscription.installmentAmount,
          numberOfInstallments: subscription.numberOfInstallments,
          firstInstallmentDate: subscription.firstInstallmentDate,
          lastInstallmentDate: subscription.lastInstallmentDate,
          status: subscription.status,
          lastPaymentAt: paymentRecord.eventTime || new Date(),
        };
        order.status = allPaid
          ? OrderStatus.FULLY_PAID
          : OrderStatus.PARTIALLY_PAID;
      }
    }

    if (eventType === 'SUBSCRIPTION_PAYMENT_FAILED') {
      const target = this.getInstallmentTarget(subscription, body);
      const paymentRecord = await this.createPaymentRecord(subscription, body, eventType, target);
      const failureReason =
        data?.failure_details?.failure_reason ||
        data?.failureDetails?.failureReason ||
        data?.payment_remarks ||
        'Payment failed';

      if (target) {
        target.failedAt = this.toDate(body?.event_time) || new Date();
        target.failureReason = failureReason;
        target.paymentStatus = data?.payment_status || 'FAILED';
        target.lastEventType = eventType;
      }

      subscription.status = data?.payment_status || subscription.status || 'ON_HOLD';
      subscription.paymentDetails = {
        ...(subscription.paymentDetails || {}),
        lastFailedPayment: paymentRecord.toObject(),
        paymentGatewayDetails: data?.payment_gateway_details,
        failureReason,
      };
      paymentRecord.subscriptionStatus = subscription.status;
      paymentRecord.installmentStatus = 'FAILED';
      await (paymentRecord as any).save();
    }

    if (eventType === 'SUBSCRIPTION_PAYMENT_CANCELLED') {
      const target = this.getInstallmentTarget(subscription, body);
      const paymentRecord = await this.createPaymentRecord(subscription, body, eventType, target);
      const failureReason =
        data?.failure_details?.failure_reason ||
        data?.failureDetails?.failureReason ||
        data?.payment_remarks ||
        'Payment cancelled';

      if (target) {
        target.failedAt = this.toDate(body?.event_time) || new Date();
        target.failureReason = failureReason;
        target.paymentStatus = data?.payment_status || 'CANCELLED';
        target.lastEventType = eventType;
      }

      subscription.status = data?.payment_status || subscription.status || 'ON_HOLD';
      subscription.paymentDetails = {
        ...(subscription.paymentDetails || {}),
        lastCancelledPayment: paymentRecord.toObject(),
        paymentGatewayDetails: data?.payment_gateway_details,
        failureReason,
      };
      paymentRecord.subscriptionStatus = subscription.status;
      paymentRecord.installmentStatus = 'CANCELLED';
      await (paymentRecord as any).save();
    }

    if (eventType === 'SUBSCRIPTION_REFUND_STATUS') {
      const target = this.getInstallmentTarget(subscription, body);
      const paymentRecord = await this.createPaymentRecord(subscription, body, eventType, target);
      subscription.paymentDetails = {
        ...(subscription.paymentDetails || {}),
        lastRefundEvent: paymentRecord.toObject(),
        paymentGatewayDetails: data?.payment_gateway_details,
      };
      paymentRecord.subscriptionStatus = subscription.status;
      paymentRecord.installmentStatus = 'REFUNDED';
      await (paymentRecord as any).save();
    }

    if (eventType === 'SUBSCRIPTION_CARD_EXPIRY_REMINDER') {
      const target = this.getInstallmentTarget(subscription, body);
      const paymentRecord = await this.createPaymentRecord(subscription, body, eventType, target);
      subscription.paymentDetails = {
        ...(subscription.paymentDetails || {}),
        cardExpiryReminder: paymentRecord.toObject(),
      };
      paymentRecord.subscriptionStatus = subscription.status;
      paymentRecord.installmentStatus = 'CARD_EXPIRY_REMINDER';
      await (paymentRecord as any).save();
    }

    subscription.webhookLogs = subscription.webhookLogs || [];
    subscription.webhookLogs.push(body);

    await (subscription as any).save();

    if (order) {
      await (order as any).save();
    }

    return {
      message: 'Webhook processed',
      eventType,
      subscriptionId: subscription.subscriptionId,
    };
  }

  async getSubscription(orderId: string) {
    const exist = await this.orderModel.findById(orderId);
    if (!exist) {
      throw new NotFoundException('Order Not Found');
    }

    return this.subModel
      .findOne({ orderId: new Types.ObjectId(orderId) })
      .populate('paymentRecords')
      .lean();
  }

  async getPaymentHistory(orderId: string) {
    const subscription = await this.subModel.findOne({
      orderId: new Types.ObjectId(orderId),
    });

    if (!subscription) {
      throw new NotFoundException('Subscription Not Found');
    }

    return this.paymentModel
      .find({ subscriptionRef: subscription._id })
      .sort({ createdAt: -1 })
      .lean();
  }

  async getPaymentReport(query: any) {
    const {
      orderId,
      subscriptionId,
      eventType,
      paymentStatus,
      status,
      page = 1,
      limit = 20,
    } = query;

    const filter: any = {};

    if (orderId) {
      filter.orderId = Types.ObjectId.isValid(orderId)
        ? new Types.ObjectId(orderId)
        : orderId;
    }

    if (subscriptionId) {
      filter.subscriptionId = subscriptionId;
    }

    if (eventType) {
      filter.eventType = eventType;
    }

    if (paymentStatus) {
      filter.paymentStatus = paymentStatus;
    }

    if (status) {
      filter.installmentStatus = status;
    }

    const pageNumber = Number(page);
    const limitNumber = Number(limit);
    const skip = (pageNumber - 1) * limitNumber;

    const [data, total] = await Promise.all([
      this.paymentModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      this.paymentModel.countDocuments(filter),
    ]);

    return {
      data,
      total,
      page: pageNumber,
      limit: limitNumber,
      totalPages: Math.ceil(total / limitNumber),
    };
  }
}
