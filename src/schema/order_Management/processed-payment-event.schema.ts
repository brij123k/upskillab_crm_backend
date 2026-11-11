import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ProcessedPaymentEventDocument = ProcessedPaymentEvent & Document;

/**
 * Global idempotency registry for money movements applied to orders.
 *
 * Every payment applied to an order (gateway webhook or manual verified
 * entry) first claims a unique `key` here inside the same transaction that
 * updates the order. A retried webhook therefore fails on the unique index
 * and is ignored instead of being counted twice.
 */
@Schema({ timestamps: true, collection: 'processed_payment_events' })
export class ProcessedPaymentEvent {
  @Prop({ required: true, unique: true })
  key: string;

  /** cashfree-link | cashfree-subscription | manual-credit | manual-lumpsum ... */
  @Prop({ required: true })
  source: string;

  @Prop({ type: Types.ObjectId, ref: 'Order', index: true })
  orderId: Types.ObjectId;

  /** lumpsum | loan | subscription | credit */
  @Prop()
  targetType: string;

  @Prop()
  targetEntryId: string;

  @Prop()
  amount: number;

  @Prop()
  gatewayPaymentId: string;

  @Prop({ type: Object })
  allocations: any;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  processedBy: Types.ObjectId;
}

export const ProcessedPaymentEventSchema = SchemaFactory.createForClass(
  ProcessedPaymentEvent,
);
ProcessedPaymentEventSchema.index({ gatewayPaymentId: 1 }, { sparse: true });
