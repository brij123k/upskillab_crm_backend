import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

/**
 * Payroll module (Phase 1: CTC structures). Only new collections – nothing in
 * the existing CRM collections changes except Profile.salary, which is kept
 * equal to the current monthly gross so the Salary Sheet report keeps working.
 */

export const PAYROLL_COMPANY_ID = process.env.PAYROLL_COMPANY_ID || 'upskillab';

export enum SalaryStructureStatus {
  DRAFT = 'draft',
  APPROVED = 'approved',
  /** Replaced by another approved structure with the same effective date. */
  SUPERSEDED = 'superseded',
  CANCELLED = 'cancelled',
}

/* ------------------------------------------------------------------ */
/* Settings: salary components (% of CTC) + statutory rules            */
/* ------------------------------------------------------------------ */

@Schema({ timestamps: true, collection: 'payrollsettings' })
export class PayrollSettings extends Document {
  @Prop({ required: true, unique: true, default: PAYROLL_COMPANY_ID })
  companyId: string;

  /** Increases on every change; structures store the version they used. */
  @Prop({ default: 1 })
  version: number;

  @Prop({ type: [Object], default: [] })
  components: any[];

  @Prop({ type: Object, default: {} })
  statutory: any;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;
}
export const PayrollSettingsSchema = SchemaFactory.createForClass(PayrollSettings);

/* ------------------------------------------------------------------ */
/* Salary structure (one per employee per effective date)              */
/* ------------------------------------------------------------------ */

@Schema({ timestamps: true, collection: 'salarystructures' })
export class SalaryStructure extends Document {
  @Prop({ required: true, default: PAYROLL_COMPANY_ID })
  companyId: string;

  /** CRM user id of the employee. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  employeeId: Types.ObjectId;

  @Prop({ required: true })
  annualCtc: number;

  @Prop({ required: true })
  effectiveFrom: Date;

  @Prop({ enum: SalaryStructureStatus, default: SalaryStructureStatus.DRAFT, index: true })
  status: SalaryStructureStatus;

  /** Inputs that are not % rules. */
  @Prop()
  ptState?: string;

  @Prop({ default: true })
  pfApplicable: boolean;

  /** 'auto' | true | false (stored as string). */
  @Prop({ default: 'auto' })
  esiApplicable: string;

  @Prop({ default: 0 })
  tdsMonthly: number;

  @Prop({ type: [Object], default: [] })
  otherDeductions: { name: string; amount: number }[];

  /** Optional insurance premium per year (recovered monthly). */
  @Prop({ default: 0 })
  insuranceAnnual: number;

  /** Salary structure template this was created from (if any). */
  @Prop({ type: Types.ObjectId, ref: 'SalaryTemplate' })
  templateId?: Types.ObjectId;

  @Prop()
  templateName?: string;

  /** True when this employee's % split was changed from the template / company split. */
  @Prop({ default: false })
  componentsCustomized: boolean;

  /** Rules snapshot used for the calculation (frozen once approved). */
  @Prop({ type: Object, required: true })
  rules: any;

  /** Calculated breakup (earnings, deductions, net, employer contributions). */
  @Prop({ type: Object, required: true })
  breakup: any;

  @Prop({ enum: ['onboarding', 'manual', 'revision'], default: 'manual' })
  source: string;

  @Prop()
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;

  @Prop()
  approvedAt?: Date;
}
export const SalaryStructureSchema = SchemaFactory.createForClass(SalaryStructure);
// Spec: companyId + employeeId + effectiveFrom – unique among approved structures.
SalaryStructureSchema.index(
  { companyId: 1, employeeId: 1, effectiveFrom: 1 },
  { unique: true, partialFilterExpression: { status: 'approved' }, name: 'uniq_approved_structure_per_date' },
);
SalaryStructureSchema.index({ companyId: 1, employeeId: 1, status: 1, effectiveFrom: -1 });

/* ------------------------------------------------------------------ */
/* Salary revision (old CTC → new CTC)                                 */
/* ------------------------------------------------------------------ */

@Schema({ timestamps: true, collection: 'salaryrevisions' })
export class SalaryRevision extends Document {
  @Prop({ required: true, default: PAYROLL_COMPANY_ID })
  companyId: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  employeeId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SalaryStructure' })
  fromStructureId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'SalaryStructure', required: true })
  toStructureId: Types.ObjectId;

  @Prop({ default: 0 })
  oldAnnualCtc: number;

  @Prop({ required: true })
  newAnnualCtc: number;

  /** % change vs the old CTC (null for the first structure). */
  @Prop({ type: Number, default: null })
  changePercent: number | null;

  @Prop({ required: true })
  effectiveFrom: Date;

  @Prop()
  reason?: string;

  @Prop({ enum: ['pending', 'approved', 'cancelled'], default: 'pending' })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;

  @Prop()
  approvedAt?: Date;
}
export const SalaryRevisionSchema = SchemaFactory.createForClass(SalaryRevision);
SalaryRevisionSchema.index({ companyId: 1, employeeId: 1, effectiveFrom: -1 });

/* ------------------------------------------------------------------ */
/* Audit log                                                           */
/* ------------------------------------------------------------------ */

@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'payrollauditlogs' })
export class PayrollAuditLog extends Document {
  @Prop({ required: true, default: PAYROLL_COMPANY_ID })
  companyId: string;

  /** 'settings' | 'structure' | 'revision' */
  @Prop({ required: true })
  entityType: string;

  @Prop({ required: true })
  entityId: string;

  @Prop({ required: true })
  action: string;

  @Prop({ type: Object })
  before?: any;

  @Prop({ type: Object })
  after?: any;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  performedBy?: Types.ObjectId;

  createdAt: Date;
}
export const PayrollAuditLogSchema = SchemaFactory.createForClass(PayrollAuditLog);
// Spec: companyId + entityId + createdAt
PayrollAuditLogSchema.index({ companyId: 1, entityId: 1, createdAt: -1 });

/* ------------------------------------------------------------------ */
/* Salary structure templates (chosen at onboarding / for a structure) */
/* ------------------------------------------------------------------ */

@Schema({ timestamps: true, collection: 'salarytemplates' })
export class SalaryTemplate extends Document {
  @Prop({ required: true, default: PAYROLL_COMPANY_ID })
  companyId: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop()
  description?: string;

  /** Own % split of CTC. Empty = use the company salary rules. */
  @Prop({ type: [Object], default: [] })
  components: any[];

  /** Suggested annual CTC (can be changed when the template is applied). */
  @Prop({ default: 0 })
  defaultAnnualCtc: number;

  @Prop({ default: true })
  pfApplicable: boolean;

  /** 'auto' | 'true' | 'false' */
  @Prop({ default: 'auto' })
  esiApplicable: string;

  @Prop({ default: 0 })
  insuranceAnnual: number;

  @Prop({ default: 0 })
  tdsMonthly: number;

  @Prop()
  ptState?: string;

  @Prop({ type: [Object], default: [] })
  otherDeductions: { name: string; amount: number }[];

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;
}
export const SalaryTemplateSchema = SchemaFactory.createForClass(SalaryTemplate);
SalaryTemplateSchema.index({ companyId: 1, name: 1 }, { unique: true });

/* ------------------------------------------------------------------ */
/* Monthly payroll run (one per month)                                 */
/* ------------------------------------------------------------------ */

export enum PayrollRunStatus {
  /** Calculated; HR reviews entries, edits LOP, adds adjustments. */
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  /** Every approved salary has been paid. */
  CLOSED = 'closed',
}

@Schema({ timestamps: true, collection: 'payrollruns' })
export class PayrollRun extends Document {
  @Prop({ required: true, default: PAYROLL_COMPANY_ID })
  companyId: string;

  /** 'YYYY-MM' */
  @Prop({ required: true })
  month: string;

  @Prop({ enum: PayrollRunStatus, default: PayrollRunStatus.DRAFT, index: true })
  status: PayrollRunStatus;

  @Prop({ type: Object, default: {} })
  totals: {
    employees?: number;
    gross?: number;
    deductions?: number;
    net?: number;
    employerCost?: number;
    lopDays?: number;
    onHold?: number;
  };

  @Prop()
  calculatedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  calculatedBy?: Types.ObjectId;

  @Prop()
  submittedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  submittedBy?: Types.ObjectId;

  @Prop()
  approvedAt?: Date;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  approvedBy?: Types.ObjectId;

  @Prop()
  rejectionReason?: string;

  /** Who did what, newest last. */
  @Prop({ type: [Object], default: [] })
  history: { action: string; by?: Types.ObjectId; byName?: string; at: Date; note?: string }[];
}
export const PayrollRunSchema = SchemaFactory.createForClass(PayrollRun);
PayrollRunSchema.index({ companyId: 1, month: 1 }, { unique: true });

/* ------------------------------------------------------------------ */
/* Payroll entry (one employee in one run) – also the payslip source   */
/* ------------------------------------------------------------------ */

@Schema({ timestamps: true, collection: 'payrollentries' })
export class PayrollEntry extends Document {
  @Prop({ required: true, default: PAYROLL_COMPANY_ID })
  companyId: string;

  @Prop({ type: Types.ObjectId, ref: 'PayrollRun', required: true, index: true })
  runId: Types.ObjectId;

  @Prop({ required: true, index: true })
  month: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  employeeId: Types.ObjectId;

  /** Name, code, department … at calculation time. */
  @Prop({ type: Object, default: {} })
  employee: Record<string, any>;

  @Prop({ type: Types.ObjectId, ref: 'SalaryStructure' })
  structureId?: Types.ObjectId;

  @Prop({ default: 0 })
  annualCtc: number;

  /** Attendance counts for the month. */
  @Prop({ type: Object, default: {} })
  attendance: Record<string, number>;

  @Prop({ default: 0 })
  daysInMonth: number;

  @Prop({ default: 0 })
  lopDays: number;

  /** LOP typed by HR (kept on recalculation instead of the attendance value). */
  @Prop({ default: false })
  lopOverridden: boolean;

  @Prop({ default: 0 })
  payableDays: number;

  @Prop({ type: [Object], default: [] })
  earnings: any[];

  @Prop({ type: [Object], default: [] })
  deductions: any[];

  @Prop({ type: [Object], default: [] })
  employerContributions: any[];

  @Prop({ default: 0 })
  grossEarnings: number;

  @Prop({ default: 0 })
  totalDeductions: number;

  @Prop({ default: 0 })
  netPay: number;

  @Prop({ default: 0 })
  monthlyCost: number;

  /** pending | reviewed | on_hold */
  @Prop({ default: 'pending', index: true })
  reviewStatus: string;

  @Prop()
  remarks?: string;

  /** Salary payment: pending → approved → paid (or on_hold). */
  @Prop({ type: Object, default: { status: 'pending' } })
  payment: {
    status: 'pending' | 'approved' | 'paid' | 'on_hold';
    amount?: number;
    approvedBy?: Types.ObjectId;
    approvedAt?: Date;
    paidBy?: Types.ObjectId;
    paidAt?: Date;
    mode?: string;
    reference?: string;
    note?: string;
  };

  @Prop({ type: Object, default: null })
  payslip: {
    number: string;
    generatedAt: Date;
    generatedBy?: Types.ObjectId;
  } | null;
}
export const PayrollEntrySchema = SchemaFactory.createForClass(PayrollEntry);
PayrollEntrySchema.index({ runId: 1, employeeId: 1 }, { unique: true });
PayrollEntrySchema.index({ companyId: 1, employeeId: 1, month: -1 });

/* ------------------------------------------------------------------ */
/* Payroll adjustment (incentive, bonus, arrear, recovery …)           */
/* ------------------------------------------------------------------ */

@Schema({ timestamps: true, collection: 'payrolladjustments' })
export class PayrollAdjustment extends Document {
  @Prop({ required: true, default: PAYROLL_COMPANY_ID })
  companyId: string;

  /** 'YYYY-MM' – the payroll month it is paid / recovered in. */
  @Prop({ required: true, index: true })
  month: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  employeeId: Types.ObjectId;

  @Prop({ required: true })
  type: string;

  @Prop({ enum: ['earning', 'deduction'], required: true })
  kind: 'earning' | 'deduction';

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop()
  remarks?: string;

  /** manual | salary_payments | expense */
  @Prop({ default: 'manual' })
  source: string;

  @Prop({ enum: ['active', 'cancelled'], default: 'active', index: true })
  status: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;
}
export const PayrollAdjustmentSchema = SchemaFactory.createForClass(PayrollAdjustment);
PayrollAdjustmentSchema.index({ companyId: 1, month: 1, employeeId: 1, status: 1 });
