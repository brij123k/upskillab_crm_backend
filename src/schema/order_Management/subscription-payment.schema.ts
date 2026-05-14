import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SubscriptionPaymentDocument = SubscriptionPayment & Document;

@Schema({ timestamps: true })
export class SubscriptionPayment {
  @Prop({ type: Types.ObjectId, ref: 'Subscription', required: true, index: true })
  subscriptionRef: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: false, index: true })
  orderId?: Types.ObjectId;

  @Prop()
  orderName?: string;

  @Prop({ required: true, index: true })
  subscriptionId: string;

  @Prop({ required: false, index: true })
  cashfreeSubscriptionId?: string;

  @Prop({ required: true, index: true })
  eventType: string;

  @Prop()
  paymentId?: string;

  @Prop()
  cfPaymentId?: string;

  @Prop()
  cfTxnId?: string;

  @Prop()
  cfOrderId?: string;

  @Prop()
  paymentType?: string;

  @Prop()
  paymentStatus?: string;

  @Prop()
  authorizationStatus?: string;

  @Prop()
  paymentAmount?: number;

  @Prop()
  paymentCurrency?: string;

  @Prop()
  installmentNo?: number;

  @Prop()
  installmentDueDate?: Date;

  @Prop()
  installmentStatus?: string;

  @Prop()
  installmentAmount?: number;

  @Prop()
  studentName?: string;

  @Prop()
  mobile?: string;

  @Prop()
  email?: string;

  @Prop()
  counselorName?: string;

  @Prop()
  subscriptionStatus?: string;

  @Prop()
  paymentScheduleDate?: Date;

  @Prop()
  paymentInitiatedDate?: Date;

  @Prop()
  paymentRemarks?: string;

  @Prop()
  retryAttempts?: number;

  @Prop({ type: Object })
  failureDetails?: any;

  @Prop({ type: Object })
  authorizationDetails?: any;

  @Prop({ type: Object })
  paymentGatewayDetails?: any;

  @Prop({ type: Object })
  rawPayload?: any;

  @Prop()
  eventTime?: Date;
}

export const SubscriptionPaymentSchema =
  SchemaFactory.createForClass(SubscriptionPayment);
