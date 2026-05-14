import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrderDocument = Order & Document;

export enum PaymentMode {
  LOAN = 'Loan',
  SUBSCRIPTION = 'Subscription',
  LUMPSUM = 'Lumpsum',
}

export enum OrderStatus {
  PENDING_PAYMENT = 'Pending Payment',
  LOAN_PROCESSING = 'Loan Processing',
  PARTIALLY_PAID = 'Partially Paid',
  FULLY_PAID = 'Fully Paid',
  CANCELLED = 'Cancelled',
}

@Schema({ timestamps: true })
export class Order {
  @Prop({ required: true })
  mobile: string;

  @Prop({unique: true, required: true})
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

  @Prop({ enum: PaymentMode })
  paymentMode: PaymentMode;

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

  // Calculated
  // @Prop({ default: 0 })
  // totalReceived: number;

  // @Prop({ default: 0 })
  // pendingAmount: number;

  @Prop({ enum: OrderStatus, default: OrderStatus.PARTIALLY_PAID })
  status: OrderStatus;

  @Prop({ default: false })
  Approved:boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  approvedBy: Types.ObjectId;

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
      totalReceived: Number,
      pendingAmount: Number,
      paymentType: String,
    },
  })
  lumpsumDetails: any;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
