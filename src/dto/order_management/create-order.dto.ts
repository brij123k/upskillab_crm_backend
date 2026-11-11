import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsDateString,
  IsObject,
  IsBoolean,
} from 'class-validator';
import { PaymentMode } from 'src/schema/order_Management/order.schema';
import { OrderPaymentSourcesDto } from './order-payment.dto';

/**
 * Payment information can be sent in two ways:
 *  - v2 (recommended): lumpsumPayments[] / loans[] / subscriptions[] / credits[]
 *    (inherited from OrderPaymentSourcesDto)
 *  - legacy: a single lumpsumDetails / loanDetails / subscriptionDetails
 *    object selected by paymentMode (old clients – mapped to v2 server side).
 * In both cases planned payment coverage + credits must equal finalFee.
 */
export class CreateOrderDto extends OrderPaymentSourcesDto {
  @ApiProperty()
  @IsString()
  mobile: string;

  @ApiPropertyOptional()
  @IsString()
  email: string;

  @ApiProperty()
  @IsString()
  studentName: string;

  @ApiPropertyOptional()
  @IsString()
  fatherName: string;

  @ApiPropertyOptional()
  @IsDateString()
  dob: Date;

  @ApiPropertyOptional()
  @IsString()
  education: string;

  @ApiPropertyOptional()
  @IsString()
  address: string;

  @ApiPropertyOptional()
  @IsString()
  city: string;

  @ApiPropertyOptional()
  @IsString()
  state: string;

  @ApiProperty()
  @IsString()
  courseVertical: string;

  @ApiPropertyOptional()
  @IsString()
  courseName: string;

  @ApiPropertyOptional()
  @IsString()
  courseDuration: string;

  @ApiProperty()
  @IsNumber()
  totalFee: number;

  @ApiProperty()
  @IsNumber()
  finalFee: number;

  @ApiPropertyOptional()
  @IsNumber()
  discount: number;

  @ApiPropertyOptional()
  @IsBoolean()
  GSTEnabled: boolean;

  @ApiPropertyOptional()
  @IsNumber()
  GSTAmount: number;

  @ApiPropertyOptional({
    enum: PaymentMode,
    description:
      'Optional for v2 payloads (derived from the payment sources). Required to select the legacy *Details object.',
  })
  @IsOptional()
  @IsEnum(PaymentMode)
  paymentMode?: PaymentMode;

  @ApiPropertyOptional()
  @IsDateString()
  orderDate: Date;

  @ApiPropertyOptional()
  @IsDateString()
  feeDepositDate: Date;

  @ApiPropertyOptional()
  @IsString()
  remarks: string;

  // Legacy single-object payment details (still accepted, mapped to v2)
  @ApiPropertyOptional({ deprecated: true })
  @IsObject()
  @IsOptional()
  loanDetails?: any;

  @ApiPropertyOptional({ deprecated: true })
  @IsObject()
  @IsOptional()
  subscriptionDetails?: any;

  @ApiPropertyOptional({ deprecated: true })
  @IsObject()
  @IsOptional()
  lumpsumDetails?: any;
}

import { PartialType } from '@nestjs/swagger';

export class UpdateOrderDto extends PartialType(CreateOrderDto) {}
