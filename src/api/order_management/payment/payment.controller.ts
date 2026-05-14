import {
  Body,
  Controller,
  Get,
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
export class CreatePlanDto {
  amount: number;
  interval: number; // number of cycles (months)
  name?: string;
}
@ApiTags('Payment')
@Controller('payment')
export class PaymentController {
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
    
  ) { }

  @UseGuards(JwtAuthGuard, RoleGuard, PermissionGuard)
  @Roles('Admin', 'bd')
  @Post('create-link')
  @RequirePermission(
                     PERMISSIONS.Orders.MODULE,
                     PERMISSIONS.Orders.ACTIONS.PAYMENTLINKGENERATOR,
                   )
  async createPaymentLink(@Body() body: any,@Req() req:any) {
    return this.paymentService.createPaymentLink(body,req.user.userId);
  }

  @Post('webhook')
  async webhook(@Body() body: any) {
    try {
      
      console.log('Webhook data:', body);
      // ================= PAYMENT LINK EVENT =================
      if (body?.type === 'PAYMENT_LINK_EVENT') {
        const data = body?.data;

        const orderId =
          data?.link_notes?.orderId || 
          data?.order?.order_id;
        // const orderId = body?.data?.order?.order_tags?.orderId;

        let order: any = null;
        let counsellorId: Types.ObjectId | undefined;
        let leadId: Types.ObjectId | undefined;

        if (orderId) {
          order = await this.orderService.findById(orderId);
          if (order) {
            counsellorId = order.counsellorId;
            // 🔥 LEAD MATCH BY EMAIL
            if (order.email) {
              const lead = await this.leadModel.findOne({
                email: order.email,
              });
              console.log('Matched Lead:', lead);
              if (lead) leadId = lead._id;
            }
          }
        }

        // ================= STORE PAYMENT =================
        await this.paymentModel.create({
          cf_link_id: data?.cf_link_id,
          link_id: data?.link_id,
          link_status: data?.link_status,
          link_amount:data?.link_amount ? Number(data?.link_amount) : undefined,
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
        });
        console.log('Payment record created for link event.', data?.order?.transaction_status);

        // ================= APPLY PAYMENT =================
        if (data?.order?.transaction_status === 'SUCCESS' && orderId) {
          console.log('Applying payment to Order ID:', orderId);
          await this.orderService.applyPayment(
            orderId,
            Number(data?.order?.order_amount),
          );
        }
        await this.userActivityLogic.log({
              userId: counsellorId,
              action: 'Payment updated',
              referenceType: 'Payment',
              referenceId: orderId?.toString(),
              meta: {
                message:"Payment updated from webhook",
                transaction_status: data?.order?.transaction_status,
                order_amount: data?.order?.order_amount ? Number(data?.order?.order_amount) : undefined,
              },
            });

        return { message: 'Payment link event stored' };
      }

      // ================= SUBSCRIPTION =================
      if (body?.type === 'SUBSCRIPTION_PAYMENT_SUCCESS') {
        const subId = body?.data?.subscription?.subscription_id;
        const amount = body?.data?.payment?.payment_amount;

        const sub = await this.subscriptionModel.findOne({
          subscriptionId: subId,
        });

        if (sub) {
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

          await this.orderService.applyPayment(
            sub.orderId.toString(),
            amount,
          );
        }

        return { message: 'Subscription handled' };
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
  getAllPayments(@Query() query: any,@Req() req:any) {
    return this.paymentService.getAllPayments(query,req.user);
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
