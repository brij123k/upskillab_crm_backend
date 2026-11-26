import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * HR self-service + approvals: exit requests, employee documents and expense
 * claims. New collections only.
 */

/* ------------------------------------------------------------------ */
/* Exit management                                                     */
/* ------------------------------------------------------------------ */

export enum ExitStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  WITHDRAWN = 'withdrawn',
}

export const EXIT_REASONS = [
  'Better opportunity',
  'Higher studies',
  'Personal / family reasons',
  'Health reasons',
  'Relocation',
  'Compensation',
  'Work environment',
  'Career change',
  'Other',
] as const;

@Schema({ timestamps: true, collection: 'exitrequests' })
export class ExitRequest extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  employeeId: Types.ObjectId;

  @Prop({ required: true })
  reasonCategory: string;

  @Prop({ required: true })
  reason: string;

  /** Last working day the employee asked for. */
  @Prop({ required: true })
  requestedLastWorkingDay: Date;

  /** Last working day agreed by HR (set on approval). */
  @Prop()
  lastWorkingDay?: Date;

  @Prop({ enum: ExitStatus, default: ExitStatus.PENDING, index: true })
  status: ExitStatus;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  decisionBy?: Types.ObjectId;

  @Prop()
  decisionAt?: Date;

  @Prop()
  decisionRemarks?: string;

  /** 'now' = account deactivated on approval; 'last_day' = on the last working day. */
  @Prop({ enum: ['now', 'last_day'], default: 'now' })
  deactivateMode: string;

  @Prop({ default: false })
  deactivated: boolean;

  @Prop()
  deactivatedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}
export const ExitRequestSchema = SchemaFactory.createForClass(ExitRequest);
ExitRequestSchema.index({ status: 1, createdAt: -1 });

/* ------------------------------------------------------------------ */
/* Employee documents (increment / promotion letters …)                */
/* ------------------------------------------------------------------ */

export const DOCUMENT_TYPES: Record<string, string> = {
  offer_letter: 'Offer Letter',
  appointment_letter: 'Appointment Letter',
  increment_letter: 'Increment Letter',
  promotion_letter: 'Promotion Letter',
  confirmation_letter: 'Confirmation Letter',
  appreciation_letter: 'Appreciation Letter',
  warning_letter: 'Warning Letter',
  experience_letter: 'Experience Letter',
  relieving_letter: 'Relieving Letter',
  other: 'Other',
};

@Schema({ timestamps: true, collection: 'employeedocuments' })
export class EmployeeDocument extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  employeeId: Types.ObjectId;

  @Prop({ required: true })
  type: string;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  fileUrl: string;

  @Prop()
  fileName?: string;

  /** Date on the letter (e.g. increment effective date). */
  @Prop()
  documentDate?: Date;

  @Prop()
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  uploadedBy?: Types.ObjectId;

  @Prop({ default: false, index: true })
  deleted: boolean;

  createdAt: Date;
  updatedAt: Date;
}
export const EmployeeDocumentSchema = SchemaFactory.createForClass(EmployeeDocument);
EmployeeDocumentSchema.index({ employeeId: 1, deleted: 1, createdAt: -1 });

/* ------------------------------------------------------------------ */
/* Expense claims                                                      */
/* ------------------------------------------------------------------ */

export enum ExpenseStatus {
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID = 'paid',
}

export const EXPENSE_CATEGORIES: Record<string, string> = {
  travel: 'Travel',
  food: 'Food & Meals',
  accommodation: 'Accommodation',
  client_meeting: 'Client Meeting',
  internet_phone: 'Internet / Phone',
  office_supplies: 'Office Supplies',
  training: 'Training / Certification',
  other: 'Other',
};

@Schema({ timestamps: true, collection: 'expenseclaims' })
export class ExpenseClaim extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  employeeId: Types.ObjectId;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  category: string;

  /** Free-text category name when category is 'other'. */
  @Prop()
  otherCategory?: string;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true })
  expenseDate: Date;

  @Prop()
  description?: string;

  @Prop({ type: [String], default: [] })
  receipts: string[];

  @Prop({ enum: ExpenseStatus, default: ExpenseStatus.SUBMITTED, index: true })
  status: ExpenseStatus;

  /** Can be lower than the claimed amount. */
  @Prop()
  approvedAmount?: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  decisionBy?: Types.ObjectId;

  @Prop()
  decisionAt?: Date;

  @Prop()
  decisionRemarks?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  paidBy?: Types.ObjectId;

  @Prop()
  paidAt?: Date;

  @Prop()
  paymentMode?: string;

  @Prop()
  paymentReference?: string;

  createdAt: Date;
  updatedAt: Date;
}
export const ExpenseClaimSchema = SchemaFactory.createForClass(ExpenseClaim);
ExpenseClaimSchema.index({ status: 1, createdAt: -1 });
