import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrderDocument = Order & Document;

export enum PaymentMode {
  LOAN = 'Loan',
  SUBSCRIPTION = 'Subscription',
  LUMPSUM = 'Lumpsum',
  // An order that combines more than one payment source.
  MIXED = 'Mixed',
  // An order that is covered only by scheduled credits (due-dated promises).
  CREDIT = 'Credit',
}

export enum OrderStatus {
  PENDING_PAYMENT = 'Pending Payment',
  LOAN_PROCESSING = 'Loan Processing',
  PARTIALLY_PAID = 'Partially Paid',
  FULLY_PAID = 'Fully Paid',
  CANCELLED = 'Cancelled',
}

/** Version 2 = multi-source payment structure (arrays + credits). */
export const CURRENT_PAYMENT_SCHEMA_VERSION = 2;

export enum LumpsumPaymentStatus {
  PENDING = 'Pending',
  PARTIALLY_RECEIVED = 'Partially Received',
  RECEIVED = 'Received',
  FAILED = 'Failed',
  REFUNDED = 'Refunded',
}

export enum LoanDisbursementStatus {
  PENDING = 'Pending',
  PARTIALLY_DISBURSED = 'Partially Disbursed',
  DISBURSED = 'Disbursed',
  CANCELLED = 'Cancelled',
}

export enum CreditStatus {
  PENDING = 'Pending',
  PAID = 'Paid',
  OVERDUE = 'Overdue',
}

export enum PaymentSource {
  GATEWAY = 'GATEWAY',
  MANUAL = 'MANUAL',
  MIGRATION = 'MIGRATION',
}

export enum CoverageStatus {
  BALANCED = 'BALANCED',
  UNDER_COVERED = 'UNDER_COVERED',
  OVER_COVERED = 'OVER_COVERED',
}

/* =========================================================
   LUMPSUM
   ========================================================= */

@Schema({ _id: false })
export class LumpsumReceipt {
  @Prop({ required: true })
  amount: number;

  @Prop()
  receivedAt: Date;

  /** Gateway payment id / bank reference / transaction id. */
  @Prop()
  referenceId: string;

  @Prop({ enum: PaymentSource, default: PaymentSource.MANUAL })
  source: PaymentSource;

  /** Key from processed_payment_events (gateway payments). */
  @Prop()
  idempotencyKey: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  recordedBy: Types.ObjectId;

  @Prop()
  remarks: string;
}
export const LumpsumReceiptSchema =
  SchemaFactory.createForClass(LumpsumReceipt);

@Schema({ timestamps: true })
export class LumpsumPaymentEntry {
  _id: Types.ObjectId;

  /** Planned amount for this lumpsum payment. */
  @Prop({ required: true, min: 0 })
  amount: number;

  /** Actual amount received. Always equals the sum of receipts. */
  @Prop({ default: 0, min: 0 })
  amountReceived: number;

  /**
   * Amount paid at registration. It is received when it is entered, so it
   * always equals amountReceived (and amount for new entries).
   */
  @Prop({ default: 0, min: 0 })
  registrationAmount: number;

  @Prop()
  paymentDate: Date;

  @Prop()
  transactionId: string;

  @Prop({ enum: LumpsumPaymentStatus, default: LumpsumPaymentStatus.PENDING })
  status: LumpsumPaymentStatus;

  /** UPI / Cash / Bank Transfer / Card / Payment Link ... */
  @Prop()
  paymentMode: string;

  @Prop()
  remarks: string;

  /** Set when the entry was created automatically (e.g. migration, unplanned gateway excess). */
  @Prop()
  origin: string;

  @Prop({ type: [LumpsumReceiptSchema], default: [] })
  receipts: LumpsumReceipt[];

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}
export const LumpsumPaymentEntrySchema =
  SchemaFactory.createForClass(LumpsumPaymentEntry);

/* =========================================================
   LOAN
   ========================================================= */

@Schema({ timestamps: true })
export class LoanEntry {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'LoanPartner' })
  loanPartner: Types.ObjectId;

  /** Reference to the LoanEmi tracker document (kept from the legacy structure). */
  @Prop({ type: Types.ObjectId, ref: 'LoanEmi' })
  loanId: Types.ObjectId;

  /** Loan/application number issued by the loan partner. */
  @Prop()
  partnerLoanReference: string;

  /** Amount approved/financed by the partner – used for fee coverage. */
  @Prop({ required: true, min: 0 })
  loanAmount: number;

  /** Amount actually disbursed – used for received revenue. */
  @Prop({ default: 0, min: 0 })
  disbursementAmount: number;

  @Prop()
  loanDate: Date;

  @Prop()
  firstEmiDate: Date;

  @Prop()
  disbursementDate: Date;

  @Prop({
    enum: LoanDisbursementStatus,
    default: LoanDisbursementStatus.PENDING,
  })
  disbursementStatus: LoanDisbursementStatus;

  @Prop()
  remarks: string;

  @Prop()
  origin: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}
export const LoanEntrySchema = SchemaFactory.createForClass(LoanEntry);

/* =========================================================
   SUBSCRIPTION
   ========================================================= */

@Schema({ _id: false })
export class SubscriptionPaymentHistoryEntry {
  /** cf_payment_id (or the best available unique gateway identifier). */
  @Prop({ required: true })
  gatewayPaymentId: string;

  @Prop({ required: true })
  amount: number;

  /** Only SUCCESS entries are counted as revenue. */
  @Prop({ default: 'SUCCESS' })
  status: string;

  @Prop()
  paidAt: Date;

  @Prop()
  installmentNo: number;

  @Prop({ enum: PaymentSource, default: PaymentSource.GATEWAY })
  source: PaymentSource;

  @Prop()
  idempotencyKey: string;

  @Prop({ type: Types.ObjectId, ref: 'SubscriptionPayment' })
  subscriptionPaymentRecordId: Types.ObjectId;
}
export const SubscriptionPaymentHistoryEntrySchema =
  SchemaFactory.createForClass(SubscriptionPaymentHistoryEntry);

@Schema({ timestamps: true })
export class SubscriptionEntry {
  _id: Types.ObjectId;

  /** Value returned by Cashfree (subscription_session_id in the current integration). */
  @Prop()
  cashfreeSubscriptionId: string;

  /** Our own subscription_id sent to Cashfree (Subscription.subscriptionId). */
  @Prop()
  gatewaySubscriptionId: string;

  @Prop({ type: Types.ObjectId, ref: 'Subscription' })
  subscriptionRef: Types.ObjectId;

  @Prop({ default: 'Cashfree' })
  gateway: string;

  @Prop({ required: true, min: 0 })
  installmentAmount: number;

  @Prop({ required: true, min: 1 })
  numberOfInstallments: number;

  @Prop()
  firstInstallmentDate: Date;

  @Prop()
  lastInstallmentDate: Date;

  @Prop({ default: 'PENDING_AUTH' })
  status: string;

  @Prop({ type: [SubscriptionPaymentHistoryEntrySchema], default: [] })
  paymentHistory: SubscriptionPaymentHistoryEntry[];

  /** Sum of SUCCESS paymentHistory amounts (denormalised, recalculated on every change). */
  @Prop({ default: 0 })
  totalReceived: number;

  @Prop()
  lastPaymentAt: Date;

  @Prop()
  remarks: string;

  @Prop()
  origin: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;
}
export const SubscriptionEntrySchema =
  SchemaFactory.createForClass(SubscriptionEntry);

/* =========================================================
   CREDITS
   ========================================================= */

@Schema({ _id: false })
export class CreditStatusChange {
  @Prop()
  from: string;

  @Prop()
  to: string;

  @Prop()
  reason: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  changedBy: Types.ObjectId;

  @Prop()
  changedAt: Date;
}
export const CreditStatusChangeSchema =
  SchemaFactory.createForClass(CreditStatusChange);

@Schema({ timestamps: true })
export class CreditEntry {
  _id: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  amount: number;

  @Prop({ required: true })
  dueDate: Date;

  @Prop({ enum: CreditStatus, default: CreditStatus.PENDING })
  status: CreditStatus;

  @Prop()
  paymentDate: Date;

  @Prop()
  paymentReferenceId: string;

  /** UPI / Cash / Bank Transfer / Payment Link ... */
  @Prop()
  paymentMode: string;

  @Prop({ enum: PaymentSource })
  paidVia: PaymentSource;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  verifiedBy: Types.ObjectId;

  @Prop()
  idempotencyKey: string;

  @Prop()
  remarks: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy: Types.ObjectId;

  @Prop({ type: [CreditStatusChangeSchema], default: [] })
  statusHistory: CreditStatusChange[];

  createdAt?: Date;
  updatedAt?: Date;
}
export const CreditEntrySchema = SchemaFactory.createForClass(CreditEntry);

/* =========================================================
   SUMMARY / AUDIT
   ========================================================= */

@Schema({ _id: false })
export class PaymentSummary {
  @Prop({ default: 0 }) plannedLumpsumAmount: number;
  @Prop({ default: 0 }) plannedLoanAmount: number;
  @Prop({ default: 0 }) plannedSubscriptionAmount: number;
  @Prop({ default: 0 }) plannedPaymentCoverage: number;
  /** finalFee - plannedPaymentCoverage */
  @Prop({ default: 0 }) remainingAmount: number;
  @Prop({ default: 0 }) totalCredits: number;
  /** finalFee - plannedPaymentCoverage - totalCredits (0 when balanced) */
  @Prop({ default: 0 }) unallocatedAmount: number;

  @Prop({ default: 0 }) lumpsumReceived: number;
  /** Σ loanAmount of active loans – counted as received on the order. */
  @Prop({ default: 0 }) loanReceived: number;
  /** Σ disbursementAmount of active loans – counted as revenue in reports. */
  @Prop({ default: 0 }) loanDisbursed: number;
  @Prop({ default: 0 }) subscriptionReceived: number;
  @Prop({ default: 0 }) creditsReceived: number;
  /** Received on the order (loans with their loan amount). */
  @Prop({ default: 0 }) actualReceivedRevenue: number;
  /** Revenue counted by the reports (loans with their disbursed amount). */
  @Prop({ default: 0 }) reportedRevenue: number;
  /** finalFee - actualReceivedRevenue (never negative) */
  @Prop({ default: 0 }) outstandingAmount: number;

  @Prop({ default: 0 }) pendingCreditAmount: number;
  @Prop({ default: 0 }) pendingCreditCount: number;

  @Prop({ enum: CoverageStatus }) coverageStatus: CoverageStatus;
  @Prop() calculatedAt: Date;
}
export const PaymentSummarySchema =
  SchemaFactory.createForClass(PaymentSummary);

@Schema({ _id: false })
export class FinancialAuditEntry {
  @Prop({ required: true })
  action: string;

  @Prop()
  entryType: string;

  @Prop()
  entryId: string;

  @Prop({ type: Object })
  before: any;

  @Prop({ type: Object })
  after: any;

  @Prop()
  reason: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  performedBy: Types.ObjectId;

  @Prop()
  source: string;

  @Prop()
  performedAt: Date;
}
export const FinancialAuditEntrySchema =
  SchemaFactory.createForClass(FinancialAuditEntry);

/* =========================================================
   ORDER
   ========================================================= */

@Schema({ timestamps: true })
export class Order {
  @Prop({ required: true })
  mobile: string;

  @Prop({ unique: true, required: true })
  email: string;

  @Prop({ required: true })
  studentName: string;

  @Prop()
  fatherName: string;

  @Prop()
  dob: Date;

  @Prop()
  education: string;

  @Prop()
  address: string;

  @Prop()
  city: string;

  @Prop()
  state: string;

  @Prop({ type: Types.ObjectId, ref: 'Pool', required: true })
  courseVertical: Types.ObjectId;

  @Prop()
  countedRevenue: number;

  @Prop()
  courseName: string;

  @Prop()
  courseDuration: string;

  @Prop()
  totalFee: number;

  @Prop()
  discount: number;

  @Prop()
  finalFee: number;

  @Prop()
  GSTEnabled: boolean;

  @Prop()
  GSTAmount: number;

  @Prop()
  registrationAmount: number;

  /**
   * Primary payment mode. Single-source orders keep Loan/Lumpsum/Subscription;
   * multi-source orders use "Mixed". See paymentModes for every source.
   */
  @Prop({ enum: PaymentMode })
  paymentMode: PaymentMode;

  /** Every payment source present on the order (Lumpsum / Loan / Subscription / Credit). */
  @Prop({ type: [String], default: undefined })
  paymentModes: string[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  counsellorId: Types.ObjectId;

  @Prop()
  counsellorName: string;

  @Prop()
  orderDate: Date;

  @Prop()
  feeDepositDate: Date;

  @Prop()
  remarks: string;

  @Prop({ enum: OrderStatus, default: OrderStatus.PARTIALLY_PAID })
  status: OrderStatus;

  @Prop({ default: false })
  Approved: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  approvedBy: Types.ObjectId;

  /* ---------------- MULTI-SOURCE PAYMENT STRUCTURE (v2) ---------------- */

  @Prop({ default: undefined })
  paymentSchemaVersion: number;

  @Prop({ type: [LumpsumPaymentEntrySchema], default: undefined })
  lumpsumPayments: LumpsumPaymentEntry[];

  @Prop({ type: [LoanEntrySchema], default: undefined })
  loans: LoanEntry[];

  @Prop({ type: [SubscriptionEntrySchema], default: undefined })
  subscriptions: SubscriptionEntry[];

  @Prop({ type: [CreditEntrySchema], default: undefined })
  credits: CreditEntry[];

  @Prop({ type: PaymentSummarySchema })
  paymentSummary: PaymentSummary;

  @Prop({ type: [FinancialAuditEntrySchema], default: undefined })
  financialAuditLog: FinancialAuditEntry[];

  @Prop({ type: Object })
  migrationInfo: {
    migratedAt?: Date;
    migrationVersion?: number;
    warnings?: string[];
    needsReview?: boolean;
  };

  /* ---------------- LEGACY (kept until migration is verified) ---------------- */
  // For v2 orders these objects are maintained as a read-only mirror of the
  // arrays above so that existing consumers keep working.

  // Loan Details
  @Prop({
    type: {
      loanPartner: { type: Types.ObjectId, ref: 'LoanPartner' },
      loanId: { type: Types.ObjectId, ref: 'LoanEmi' },
      loanAmount: Number,
      disbursementAmount: Number,
      firstEmiDate: Date,
      loanDate: Date,
    },
  })
  loanDetails: any;

  // Subscription
  @Prop({
    type: {
      cashfreeSubscriptionId: String,
      gateway: String,
      installmentAmount: Number,
      firstInstallmentDate: Date,
      lastInstallmentDate: Date,
      numberOfInstallments: Number,
      status: String,
      lastPaymentAt: Date,
    },
  })
  subscriptionDetails: any;

  // Lumpsum
  @Prop({
    type: {
      registrationDate: Date,
      registrationAmount: Number,
      // Total amount received through lumpsum payments.
      totalReceived: Number,
      pendingAmount: Number,
      paymentType: String,
    },
  })
  lumpsumDetails: any;
}

export const OrderSchema = SchemaFactory.createForClass(Order);

/* 🔥 Indexes for reports, pending credits and payment idempotency */
OrderSchema.index({ Approved: 1, orderDate: -1 });
OrderSchema.index({ counsellorId: 1, orderDate: -1 });
OrderSchema.index({ mobile: 1 });
OrderSchema.index({ Approved: 1, 'credits.status': 1, 'credits.dueDate': 1 });
OrderSchema.index({ 'credits.dueDate': 1 });
OrderSchema.index({ 'lumpsumPayments.transactionId': 1 }, { sparse: true });
OrderSchema.index(
  { 'subscriptions.gatewaySubscriptionId': 1 },
  { sparse: true },
);
OrderSchema.index(
  { 'subscriptions.cashfreeSubscriptionId': 1 },
  { sparse: true },
);
OrderSchema.index(
  { 'subscriptions.paymentHistory.gatewayPaymentId': 1 },
  { sparse: true },
);
