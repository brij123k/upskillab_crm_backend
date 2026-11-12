import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

// =========================================================
// STAGES
// =========================================================

export const DEFAULT_ENROLLED_STAGE = 'Enrolled';

@Schema({ timestamps: true, collection: 'enrolled_lead_stages' })
export class EnrolledLeadStage {
  @Prop({ required: true, unique: true, trim: true })
  name: string;

  @Prop({ default: 0 })
  order: number;

  @Prop({ default: '#f97316' })
  color: string;

  /** New students get the default stage. */
  @Prop({ default: false })
  isDefault: boolean;

  @Prop({ default: true })
  isActive: boolean;
}

export const EnrolledLeadStageSchema =
  SchemaFactory.createForClass(EnrolledLeadStage);

// =========================================================
// PER-LEAD HISTORY
// =========================================================

export enum EnrolledLeadAction {
  CREATED = 'created',
  STAGE_CHANGED = 'stage_changed',
  CALL = 'call',
  WHATSAPP = 'whatsapp',
  EMAIL = 'email',
  MEETING = 'meeting',
  NOTE = 'note',
  ASSIGNED = 'assigned',
  STATUS_SYNCED = 'status_synced',
}

/** Actions a user can log on an enrolled lead. */
export const ENROLLED_LEAD_ACTIVITY_TYPES = [
  EnrolledLeadAction.CALL,
  EnrolledLeadAction.WHATSAPP,
  EnrolledLeadAction.MEETING,
  EnrolledLeadAction.NOTE,
  EnrolledLeadAction.STAGE_CHANGED,
] as const;

@Schema({ timestamps: true, collection: 'enrolled_lead_histories' })
export class EnrolledLeadHistory {
  @Prop({
    type: Types.ObjectId,
    ref: 'EnrolledLead',
    required: true,
    index: true,
  })
  enrolledLeadId: Types.ObjectId;

  @Prop({ enum: EnrolledLeadAction, required: true, index: true })
  actionType: EnrolledLeadAction;

  @Prop()
  fromStage?: string;

  @Prop()
  toStage?: string;

  @Prop()
  note?: string;

  /** Empty for system actions (sync). */
  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  actionBy?: Types.ObjectId;

  @Prop({ type: Object })
  changes?: Record<string, any>;

  createdAt?: Date;
}

export const EnrolledLeadHistorySchema =
  SchemaFactory.createForClass(EnrolledLeadHistory);
EnrolledLeadHistorySchema.index({ enrolledLeadId: 1, createdAt: -1 });

// =========================================================
// SYNC RUNS
// =========================================================

export enum EnrolledSyncStatus {
  RUNNING = 'RUNNING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true, collection: 'enrolled_lead_sync_runs' })
export class EnrolledLeadSyncRun {
  @Prop({ enum: ['CRON', 'MANUAL'], required: true })
  trigger: 'CRON' | 'MANUAL';

  @Prop({ type: Types.ObjectId, ref: 'User' })
  triggeredBy?: Types.ObjectId;

  @Prop({
    enum: EnrolledSyncStatus,
    default: EnrolledSyncStatus.RUNNING,
    index: true,
  })
  status: EnrolledSyncStatus;

  @Prop({ default: Date.now, index: true })
  startedAt: Date;

  @Prop()
  finishedAt?: Date;

  @Prop({ default: 0 }) studentsFetched: number;
  @Prop({ default: 0 }) newStudents: number;
  @Prop({ default: 0 }) updatedStudents: number;
  @Prop({ default: 0 }) statusChanged: number;
  @Prop({ default: 0 }) coursesFetched: number;
  @Prop({ default: 0 }) newCourses: number;
  @Prop({ default: 0 }) batchesFetched: number;
  @Prop({ default: 0 }) newBatches: number;

  @Prop()
  error?: string;
}

export const EnrolledLeadSyncRunSchema =
  SchemaFactory.createForClass(EnrolledLeadSyncRun);
