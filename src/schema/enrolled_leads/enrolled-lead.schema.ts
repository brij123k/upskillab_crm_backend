import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * A student enrolled on Upskillab, imported from GET /external/crm/students.
 *
 * Upstream fields (everything the API returns) are refreshed on every sync.
 * CRM fields (stage, assignment, activity) are only changed in the CRM.
 */
@Schema({ timestamps: true, collection: 'enrolled_leads' })
export class EnrolledLead {
  // ---------------- upstream identity ----------------
  @Prop({ required: true, unique: true, index: true })
  studentId: string;

  @Prop({ index: true })
  userId?: string;

  // ---------------- upstream user details ----------------
  @Prop({ index: true }) email?: string;
  @Prop({ index: true }) mobileNumber?: string;
  @Prop() username?: string;
  @Prop() userType?: string;
  @Prop({ index: true }) isActive?: boolean;
  /** Upstream student status, stored exactly as received. */
  @Prop({ index: true }) status?: string;

  // ---------------- upstream student details ----------------
  @Prop({ index: true }) fullName?: string;
  @Prop() college?: string;
  @Prop() studentType?: string;
  @Prop() bio?: string;
  @Prop({ type: [String], default: [] }) skills: string[];
  @Prop() image?: string;
  @Prop({ index: true }) studentCreatedAt?: Date;
  @Prop() studentUpdatedAt?: Date;

  // ---------------- upstream courses / batches ----------------
  @Prop({ type: [String], default: [], index: true }) courses: string[];
  /** Upskillab course ids from the student's orders. */
  @Prop({ type: [String], default: [], index: true }) courseIds: string[];
  @Prop({ type: [String], default: [], index: true }) batches: string[];
  /** Upskillab batch ids from the student's orders. */
  @Prop({ type: [String], default: [], index: true }) batchIds: string[];
  @Prop({ type: [String], default: [] }) completedBatches: string[];
  @Prop({ type: [String], default: [] }) ongoingBatches: string[];
  @Prop({ type: [String], default: [] }) upcomingBatches: string[];
  /** Every batch status this student has (from orders + batch lists). */
  @Prop({ type: [String], default: [], index: true }) batchStatuses: string[];

  @Prop({ type: Object, default: {} })
  paymentSummary: Record<string, any>;

  @Prop({ type: [Object], default: [] })
  orders: Record<string, any>[];

  /** The full student object exactly as received. */
  @Prop({ type: Object, default: {} })
  raw: Record<string, any>;

  // ---------------- CRM fields ----------------
  @Prop({ type: Types.ObjectId, ref: 'EnrolledLeadStage', index: true })
  stageId?: Types.ObjectId;

  @Prop({ index: true })
  stageName?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  assignedTo?: Types.ObjectId;

  @Prop()
  assignedDate?: Date;

  @Prop()
  lastActivityAt?: Date;

  @Prop()
  lastActivityType?: string;

  @Prop()
  firstSyncedAt?: Date;

  @Prop()
  lastSyncedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EnrolledLeadSchema = SchemaFactory.createForClass(EnrolledLead);
EnrolledLeadSchema.index({ stageId: 1, studentCreatedAt: -1 });
