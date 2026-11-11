import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CreditStatus,
  LoanDisbursementStatus,
  LumpsumPaymentStatus,
} from 'src/schema/order_Management/order.schema';

const MAX_ENTRIES = 50;

/**
 * Fields marked with this are required when a NEW entry is sent (no _id).
 * An existing entry can be referenced by _id with only the fields to change;
 * provided values are always validated.
 */
const RequiredForNewEntry = () =>
  ValidateIf((entry: any, value: any) => !entry?._id || value !== undefined);

export class LumpsumPaymentInputDto {
  @ApiPropertyOptional({ description: 'Existing entry id (updates only)' })
  @IsOptional()
  @IsMongoId()
  _id?: string;

  @ApiProperty({
    description:
      'Amount paid at registration (a record). For a new entry amountReceived defaults to it. Required for a new entry unless the deprecated amount is sent.',
  })
  @ValidateIf(
    (entry: any, value: any) =>
      value !== undefined || (!entry?._id && entry?.amount === undefined),
  )
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  registrationAmount?: number;

  @ApiPropertyOptional({
    description: 'Deprecated: planned amount. Use registrationAmount.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({
    description:
      'Money received on this entry (registration + later payments); counts as received. Cannot be less than registrationAmount. Raising it needs record_payment; lowering it needs revert_payment and a reason.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amountReceived?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @ApiPropertyOptional({ description: 'Transaction / reference id' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  transactionId?: string;

  @ApiPropertyOptional({ enum: LumpsumPaymentStatus })
  @IsOptional()
  @IsEnum(LumpsumPaymentStatus)
  status?: LumpsumPaymentStatus;

  @ApiPropertyOptional({
    description: 'UPI / Cash / Card / Bank Transfer / Payment Link ...',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  paymentMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class LoanInputDto {
  @ApiPropertyOptional({ description: 'Existing entry id (updates only)' })
  @IsOptional()
  @IsMongoId()
  _id?: string;

  @ApiProperty()
  @RequiredForNewEntry()
  @IsMongoId()
  loanPartner: string;

  @ApiPropertyOptional({
    description: 'Loan / application number issued by the partner',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  partnerLoanReference?: string;

  @ApiProperty({
    description: 'Amount approved/financed by the partner (fee coverage)',
  })
  @RequiredForNewEntry()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  loanAmount: number;

  @ApiPropertyOptional({ description: 'Amount actually disbursed (revenue)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  disbursementAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  loanDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  firstEmiDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  disbursementDate?: string;

  @ApiPropertyOptional({
    enum: LoanDisbursementStatus,
    description:
      'Derived from disbursementAmount. Only Cancelled can be set; other values are ignored.',
  })
  @IsOptional()
  @IsEnum(LoanDisbursementStatus)
  disbursementStatus?: LoanDisbursementStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class SubscriptionInputDto {
  @ApiPropertyOptional({ description: 'Existing entry id (updates only)' })
  @IsOptional()
  @IsMongoId()
  _id?: string;

  @ApiPropertyOptional({ default: 'Cashfree' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  gateway?: string;

  @ApiProperty()
  @RequiredForNewEntry()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  installmentAmount: number;

  @ApiProperty()
  @RequiredForNewEntry()
  @IsInt()
  @Min(1)
  @Max(120)
  numberOfInstallments: number;

  @ApiProperty()
  @RequiredForNewEntry()
  @IsDateString()
  firstInstallmentDate: string;

  @ApiPropertyOptional({ description: 'Defaults to first date + (n-1) months' })
  @IsOptional()
  @IsDateString()
  lastInstallmentDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class CreditInputDto {
  @ApiPropertyOptional({ description: 'Existing credit id (updates only)' })
  @IsOptional()
  @IsMongoId()
  _id?: string;

  @ApiProperty()
  @RequiredForNewEntry()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiProperty()
  @RequiredForNewEntry()
  @IsDateString()
  dueDate: string;

  @ApiPropertyOptional({
    enum: CreditStatus,
    description:
      'Read-only: Pending/Overdue are derived, Paid is set through the payment API',
  })
  @IsOptional()
  @IsEnum(CreditStatus)
  status?: CreditStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

/** Fields shared by the create/update order DTOs. */
export class OrderPaymentSourcesDto {
  @ApiPropertyOptional({ type: [LumpsumPaymentInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => LumpsumPaymentInputDto)
  lumpsumPayments?: LumpsumPaymentInputDto[];

  @ApiPropertyOptional({ type: [LoanInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => LoanInputDto)
  loans?: LoanInputDto[];

  @ApiPropertyOptional({ type: [SubscriptionInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => SubscriptionInputDto)
  subscriptions?: SubscriptionInputDto[];

  @ApiPropertyOptional({ type: [CreditInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ENTRIES)
  @ValidateNested({ each: true })
  @Type(() => CreditInputDto)
  credits?: CreditInputDto[];
}

/**
 * PATCH /order/:id/financials
 * Each array present replaces that payment source: items with _id update,
 * items without _id are added, missing items are removed (only when nothing
 * was received on them). Arrays that are omitted are left unchanged.
 */
export class UpdateOrderFinancialsDto extends OrderPaymentSourcesDto {
  @ApiPropertyOptional({
    description: 'New finalFee (the whole order is re-validated)',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  finalFee?: number;

  @ApiPropertyOptional({
    description:
      'Reason – required for reversals/refunds, recorded in the audit log',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class MarkCreditPaidDto {
  @ApiProperty({
    description: 'Bank / UPI / gateway reference of the verified payment',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  paymentReferenceId: string;

  @ApiProperty({ description: 'Must equal the credit amount' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  paymentMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class RevertCreditPaymentDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

export const PENDING_CREDIT_CATEGORIES = [
  'pastDue',
  'dueToday',
  'upcoming',
  'pending',
  'paid',
  'all',
] as const;
export type PendingCreditCategory = (typeof PENDING_CREDIT_CATEGORIES)[number];

export class PendingCreditReportQueryDto {
  @ApiPropertyOptional({
    enum: PENDING_CREDIT_CATEGORIES,
    default: 'pending',
    description:
      'pastDue = unpaid & due before today, dueToday, upcoming = unpaid & due after today, pending = all unpaid, paid, all',
  })
  @IsOptional()
  @IsIn(PENDING_CREDIT_CATEGORIES as unknown as string[])
  category?: PendingCreditCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  counsellorId?: string;

  @ApiPropertyOptional({ description: 'Course vertical (pool) id' })
  @IsOptional()
  @IsMongoId()
  courseVertical?: string;

  @ApiPropertyOptional({
    description: 'Course name (case-insensitive contains)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  courseName?: string;

  @ApiPropertyOptional({ description: 'Due date from (inclusive, YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'Due date to (inclusive, YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiPropertyOptional({ description: 'Student name, email or mobile' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
