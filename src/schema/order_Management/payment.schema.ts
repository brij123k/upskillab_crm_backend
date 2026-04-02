import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PaymentDocument = Payment & Document;

@Schema({ timestamps: true })
export class Payment {
  @Prop()
  cf_link_id: number;

  @Prop()
  link_id: string;

  @Prop()
  link_status: string;

  @Prop()
  link_amount: number;

  @Prop()
  link_amount_paid: number;

  @Prop()
  link_currency: string;

  @Prop()
  link_purpose: string;

  @Prop()
  link_url: string;

  @Prop()
  link_created_at: Date;

  @Prop()
  link_expiry_time: Date;

  @Prop({ type: Object })
  customer_details: any;

  @Prop({ type: Object })
  link_meta: any;

  @Prop({ type: Object })
  link_notes: any;

  @Prop({ type: Object })
  link_notify: any;

  // 🔥 ORDER DATA
  @Prop()
  order_id: string;

  @Prop()
  transaction_id: number;

  @Prop()
  transaction_status: string;

  @Prop()
  order_amount: number;

  // 🔥 RELATIONS
  @Prop({ type: Types.ObjectId, ref: 'Order' })
  orderRef: Types.ObjectId;

 @Prop({ type: Types.ObjectId, ref: 'User', required: false })
counsellorId?: Types.ObjectId;

@Prop({ type: Types.ObjectId, ref: 'Lead', required: false })
leadId?: Types.ObjectId;

  @Prop()
  event_type: string;

  @Prop()
  event_time: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);