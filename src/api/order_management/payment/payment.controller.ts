import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { OrderService } from '../order.service';
import { InjectModel } from '@nestjs/mongoose';
import { Subscription } from 'src/schema/order_Management/subscription.schema';
import { Model, Types } from 'mongoose';
import { CreateSubscriptionDto } from 'src/dto/order_management/createsubscription.dto';
import { Payment } from 'src/schema/order_Management/payment.schema';
import { Order } from 'src/schema/order_Management/order.schema';
import { Lead } from 'src/schema/lead_management/lead.schema';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { PERMISSIONS } from 'src/common/constants/permissions.constant';
import { RequirePermission } from 'src/common/decorators/permission.decorator';
import { PermissionGuard } from 'src/common/guards/permission.guard';
import { UserActivityLogic } from 'src/api/user-activity/user-activity.logic';
import { LeadStage } from 'src/schema/lead_management/lead-stage.schema';
import { LeadLogic } from 'src/api/lead_management/lead/lead.logic';
import { OrderFinancialService } from '../financial/order-financial.service';
import {
  isWebhookSignatureRequired,
  verifyCashfreeWebhook,
} from 'src/common/utils/cashfree-webhook.util';


export class CreatePlanDto {
  amount: number;
  interval: number; // number of cycles (months)
  name?: string;
}
@ApiTags('Payment')
@Controller('payment')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly orderService: OrderService,
    @InjectModel(Subscription.name) private subscriptionModel: Model<Subscription>,
    @InjectModel(Payment.name)
    private paymentModel: Model<Payment>,
    @InjectModel(Order.name)
    private orderModel: Model<Order>,
    @InjectModel(Lead.name)
    private leadModel: Model<Lead>,
    private readonly userActivityLogic: UserActivityLogic,
    @InjectModel(LeadStage.name)
    private readonly leadStageModel: Model<LeadStage>,
    private readonly Leadlogic: LeadLogic,
    private readonly subscriptionFinancials: OrderFinancialService,
  ) { }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @Post('create-link')
  @RequirePermission(
    PERMISSIONS.Orders.MODULE,
    PERMISSIONS.Orders.ACTIONS.PAYMENTLINKGENERATOR,
  )
  async createPaymentLink(@Body() body: any, @Req() req: any) {
    return this.paymentService.createPaymentLink(body, req.user.userId);
  }

  // @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @Post('leadPayment-link')
  // @RequirePermission(
  //   PERMISSIONS.Orders.MODULE,
  //   PERMISSIONS.Orders.ACTIONS.PAYMENTLINKGENERATOR,
  // )
  async createleadPaymentLink(@Body() body: any, @Req() req: any) {
    return this.paymentService.createleadPaymentLink(body, req.user.userId);
  }

  /**
   * Cashfree payment-link webhook (and the legacy subscription event).
   *
   * Money is applied to an order only through OrderFinancialService, which
   * is idempotent on the gateway payment key – a retried webhook never adds
   * the same payment twice. Unless CASHFREE_WEBHOOK_SIGNATURE_REQUIRED=false,
   * payments are applied only when the Cashfree signature is valid; the raw
   * event is always stored.
   */
  @Post('webhook')
  async webhook(@Body() body: any, @Req() req: any) {
    try {
      const verification = verifyCashfreeWebhook(req);
      const canApplyMoney = verification.verified || !isWebhookSignatureRequired();
      if (!verification.verified) {
        this.logger.warn(`Payment webhook signature not verified: ${verification.reason}`);
      }

      // ================= PAYMENT LINK EVENT =================
      if (body?.type === 'PAYMENT_LINK_EVENT') {
        const data = body?.data;

        const orderId =
          data?.link_notes?.orderId

        let order: any = null;
        let counsellorId: Types.ObjectId | undefined;
        let leadId: Types.ObjectId | undefined;
        if (data?.link_notes?.userId && Types.ObjectId.isValid(data.link_notes.userId)) {
          counsellorId = new Types.ObjectId(data.link_notes.userId);
        }
        if (orderId && Types.ObjectId.isValid(orderId)) {
          order = await this.orderService.findById(orderId);
          if (order) {
            counsellorId = order.counsellorId?._id || order.counsellorId;
            // 🔥 LEAD MATCH BY EMAIL
            if (order.email) {
              const lead = await this.leadModel.findOne({
                email: order.email,
              });
              if (lead) leadId = lead._id;
            }
          }
        }
        const lId =
          data?.link_notes?.leadId
          const userId = data?.link_notes?.userId
          if(lId){
            const lead = await this.leadModel.findOne({leadId:lId})
            if (!!lead){
              leadId = lead._id;
              if (userId && Types.ObjectId.isValid(userId)) {
                counsellorId = new Types.ObjectId(userId);
              }
              if(data.link_purpose=="Registration Payment" && data?.order?.transaction_status === 'SUCCESS' && canApplyMoney){
                const stage = await this.leadStageModel.findOne({name:"Registration Done"})
                if(!!stage){
                  await this.Leadlogic.changeStagebyLeadId(lead.leadId,(stage._id).toString(),userId)
                }
              }
            }
          }

        // ================= STORE PAYMENT (idempotent per event) =================
        const paymentKey = this.paymentService.buildLinkPaymentKey(data);
        const paymentFields = {
          cf_link_id: data?.cf_link_id,
          link_id: data?.link_id,
          link_status: data?.link_status,
          link_amount: data?.link_amount ? Number(data?.link_amount) : undefined,
          link_amount_paid: data?.link_amount_paid ? Number(data?.link_amount_paid) : undefined,
          link_currency: data?.link_currency,
          link_purpose: data?.link_purpose,
          link_url: data?.link_url,
          link_created_at: data?.link_created_at,
          link_expiry_time: data?.link_expiry_time,

          customer_details: data?.customer_details,
          link_meta: data?.link_meta,
          link_notes: data?.link_notes,
          link_notify: data?.link_notify,

          order_id: data?.order?.order_id,
          transaction_id: data?.order?.transaction_id,
          transaction_status: data?.order?.transaction_status,
          order_amount: data?.order?.order_amount ? Number(data?.order?.order_amount) : undefined,

          orderRef: order?._id,
          counsellorId,
          leadId,

          event_type: body?.type,
          event_time: body?.event_time,
          idempotencyKey: paymentKey,
          signatureVerified: verification.verified,
        };
        const existingPayment = await this.paymentModel.findOne({
          link_id: data?.link_id,
          order_id: data?.order?.order_id,
          transaction_status: data?.order?.transaction_status,
          ...(data?.order?.transaction_id !== undefined
            ? { transaction_id: data?.order?.transaction_id }
            : {}),
        });
        const res = existingPayment
          ? await this.paymentModel.findByIdAndUpdate(existingPayment._id, paymentFields, { new: true })
          : await this.paymentModel.create(paymentFields);

        // ================= APPLY PAYMENT =================
        if (data?.order?.transaction_status === 'SUCCESS' && orderId && order) {
          let application: any;
          if (!canApplyMoney) {
            application = {
              status: 'SKIPPED_UNVERIFIED',
              message: `Webhook signature not verified (${verification.reason})`,
            };
          } else {
            try {
              const result = await this.orderService.applyPayment(
                orderId,
                Number(data?.order?.order_amount ?? data?.link_amount_paid),
                paymentKey,
                {
                  referenceId: data?.order?.transaction_id
                    ? String(data.order.transaction_id)
                    : data?.order?.order_id,
                  creditId: data?.link_notes?.creditId,
                  lumpsumEntryId: data?.link_notes?.lumpsumEntryId,
                  paidAt: body?.event_time ? new Date(body.event_time) : undefined,
                  paymentMode: 'Payment Link',
                },
              );
              application = { status: result.status, allocations: result.allocations, key: result.key };
            } catch (error: any) {
              application = {
                status: 'FAILED',
                message: error?.response?.errors?.join?.('; ') || error?.message,
              };
              this.logger.error(
                `Failed to apply payment ${paymentKey} to order ${orderId}: ${application.message}`,
              );
            }
          }
          // A retried delivery of an already applied payment keeps the
          // APPLIED record and only counts the duplicate delivery.
          if (
            application.status === 'DUPLICATE' &&
            existingPayment?.financialApplication?.status === 'APPLIED'
          ) {
            await this.paymentModel.updateOne(
              { _id: res!._id },
              {
                $inc: { 'financialApplication.duplicateDeliveries': 1 },
                $set: { 'financialApplication.lastDuplicateAt': new Date() },
              },
            );
          } else {
            await this.paymentModel.updateOne(
              { _id: res!._id },
              { $set: { financialApplication: { ...application, at: new Date() } } },
            );
          }

          if (application.status === 'APPLIED' && leadId) {
            const paymentCount = await this.paymentModel.countDocuments({
              orderRef: order._id,
              transaction_status: 'SUCCESS',
              'financialApplication.status': 'APPLIED',
            });

            if (paymentCount === 1) {
              const registrationStage =
                await this.leadStageModel.findOne({
                  name: 'Registration Done',
                });

              if (registrationStage) {
                await this.leadModel.updateOne(
                  { _id: leadId },
                  {
                    $set: {
                      stageId: registrationStage._id,
                    },
                  },
                );
              }
            }
          }
        }
        await this.userActivityLogic.log({
          userId: counsellorId,
          action: 'Payment updated',
          referenceType: 'Payment',
          meta: {
            message: "Payment updated from webhook",
            transaction_status: data?.order?.transaction_status,
            order_amount: data?.order?.order_amount ? Number(data?.order?.order_amount) : undefined,
          },
        });

        return { message: 'Payment link event stored' };
      }

      // ================= SUBSCRIPTION (legacy event shape) =================
      // The signed /subscription/webhook/cashfree endpoint is the primary
      // handler. Both paths use the same idempotency key (gateway payment id)
      // so a payment delivered to both endpoints is counted once.
      if (body?.type === 'SUBSCRIPTION_PAYMENT_SUCCESS') {
        if (!canApplyMoney) {
          return { message: 'Subscription event ignored: signature not verified' };
        }
        const subId =
          body?.data?.subscription?.subscription_id ||
          body?.data?.subscription_details?.subscription_id;
        const amount = Number(
          body?.data?.payment?.payment_amount ?? body?.data?.payment_amount,
        );
        const gatewayPaymentId =
          body?.data?.payment?.cf_payment_id ||
          body?.data?.payment?.payment_id ||
          body?.data?.cf_payment_id ||
          body?.data?.payment_id ||
          (subId && body?.event_time ? `${subId}:${body.event_time}` : undefined);

        const sub = await this.subscriptionModel.findOne({
          subscriptionId: subId,
        });

        if (sub && gatewayPaymentId) {
          const result = await this.subscriptionFinancials.recordSubscriptionPayment({
            orderId: sub.orderId?.toString(),
            gatewaySubscriptionId: subId,
            cashfreeSubscriptionId: sub.cashfreeSubscriptionId,
            subscriptionEntryId: (sub as any).orderSubscriptionEntryId?.toString(),
            gatewayPaymentId: String(gatewayPaymentId),
            amount,
            paidAt: body?.event_time ? new Date(body.event_time) : undefined,
          });

          if (result.status === 'APPLIED') {
            for (const inst of sub.installments) {
              if (!inst.isPaid) {
                inst.isPaid = true;
                inst.paidAt = new Date();
                break;
              }
            }

            const allPaid = sub.installments.every(i => i.isPaid);
            if (allPaid) sub.status = 'COMPLETED';

            await sub.save();
          }
          return { message: 'Subscription handled', status: result.status };
        }

        return { message: 'Subscription not found or payment id missing, event ignored' };
      }

      return { message: 'Ignored event' };
    } catch (err) {
      console.error('Webhook Error:', err);
      return { message: 'Webhook error' };
    }
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @Get()
  @RequirePermission(
    PERMISSIONS.Orders.MODULE,
    PERMISSIONS.Orders.ACTIONS.READPAYMENTHISTORY,
  )
  getAllPayments(@Query() query: any, @Req() req: any) {
    return this.paymentService.getAllPayments(query, req.user);
  }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @Get('by-order-id/:id')
  @RequirePermission(
    PERMISSIONS.Orders.MODULE,
    PERMISSIONS.Orders.ACTIONS.READPAYMENTHISTORY,
  )
  getAllPaymentsbyOrderId(@Param('id') orderId: string) {
    return this.paymentService.getPaymentById(orderId);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @Post('plan')
  createPlan(@Body() body: any) {
    return this.paymentService.createPlan(body);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @Get('plans/:planId')
  getPlans(@Param('planId') planId: string) {
    return this.paymentService.getPlans(planId);
  }

  @UseGuards(JwtAuthGuard, RoleGuard)
  @Roles('Admin', 'bd')
  @Patch('plans/:planId/toggle-status')
  togglePlanStatus(@Param('planId') planId: string) {
    return this.paymentService.togglePlanStatus(planId);
  }

  // @UseGuards(JwtAuthGuard, RoleGuard)
  // @Roles('Admin', 'bd')
  // @Post('subscription')
  // createSubscription(@Body() body: CreateSubscriptionDto) {
  //   return this.paymentService.createSubscription(body);
  // }
  async getSubscriptionLink(subscriptionSessionId: string) {
    return `https://sandbox.cashfree.com/pg/subscriptions/authorize/${subscriptionSessionId}`;
  }
}
