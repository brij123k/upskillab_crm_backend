import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export enum CreditNotificationCategory {
  PAST_DUE = 'PAST_DUE',
  DUE_TODAY = 'DUE_TODAY',
}

export enum CreditNotificationRunStatus {
  RUNNING = 'RUNNING',
  COMPLETED = 'COMPLETED',
  SKIPPED = 'SKIPPED',
  FAILED = 'FAILED',
}

/**
 * One row per (credit, notification date). The unique index guarantees that
 * the same credit is never notified twice on the same date, even when the
 * cron runs twice or on several application instances.
 */
@Schema({ timestamps: true, collection: 'credit_notification_logs' })
export class CreditNotificationLog {
  @Prop({ type: Types.ObjectId, ref: 'Order', required: true })
  orderId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  creditId: Types.ObjectId;

  /** YYYY-MM-DD in the configured business timezone. */
  @Prop({ required: true })
  notificationDate: string;

  @Prop({ enum: CreditNotificationCategory, required: true })
  category: CreditNotificationCategory;

  @Prop({ type: Types.ObjectId, ref: 'CreditNotificationRun' })
  runId: Types.ObjectId;

  @Prop()
  amount: number;

  @Prop()
  dueDate: Date;

  @Prop()
  daysOverdue: number;
}

export type CreditNotificationLogDocument = CreditNotificationLog & Document;
export const CreditNotificationLogSchema = SchemaFactory.createForClass(
  CreditNotificationLog,
);
CreditNotificationLogSchema.index(
  { creditId: 1, notificationDate: 1 },
  { unique: true },
);
CreditNotificationLogSchema.index({ notificationDate: 1, category: 1 });

/** Execution history for every run of the pending-credit notifier. */
@Schema({ timestamps: true, collection: 'credit_notification_runs' })
export class CreditNotificationRun {
  @Prop({ required: true, index: true })
  runDate: string;

  @Prop({ default: 'CRON' })
  trigger: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  triggeredBy: Types.ObjectId;

  @Prop({
    enum: CreditNotificationRunStatus,
    default: CreditNotificationRunStatus.RUNNING,
  })
  status: CreditNotificationRunStatus;

  @Prop()
  startedAt: Date;

  @Prop()
  finishedAt: Date;

  @Prop({ default: 0 })
  pastDueFound: number;

  @Prop({ default: 0 })
  dueTodayFound: number;

  @Prop({ default: 0 })
  pastDueNotified: number;

  @Prop({ default: 0 })
  dueTodayNotified: number;

  @Prop({ default: 0 })
  alreadyNotified: number;

  @Prop({ default: 0 })
  creditsMarkedOverdue: number;

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  recipients: Types.ObjectId[];

  @Prop()
  error: string;
}

export type CreditNotificationRunDocument = CreditNotificationRun & Document;
export const CreditNotificationRunSchema = SchemaFactory.createForClass(
  CreditNotificationRun,
);
