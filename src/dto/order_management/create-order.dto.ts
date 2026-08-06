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

export class CreateOrderDto {
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

  @ApiProperty({ enum: PaymentMode })
  @IsEnum(PaymentMode)
  paymentMode: PaymentMode;

  @ApiPropertyOptional() 
  @IsDateString() 
  orderDate: Date;

  @ApiPropertyOptional() 
  @IsDateString() 
  feeDepositDate: Date;

  @ApiPropertyOptional()
  @IsString()  
  remarks: string;

  // @ApiPropertyOptional()
  // @IsNumber()
  // totalReceived?: number;

  // @ApiPropertyOptional()
  // @IsNumber()
  // pendingAmount?: number;

  // @ApiPropertyOptional()
  // @IsString()
  // status?: string;
  // Nested
  @ApiPropertyOptional()
  @IsObject()
  @IsOptional() 
  loanDetails?: any;

  @ApiPropertyOptional()
  @IsObject() 
  @IsOptional() 
  subscriptionDetails?: any;

  @ApiPropertyOptional() 
  @IsObject()
  @IsOptional()  
  lumpsumDetails?: any;
}

import { PartialType } from '@nestjs/swagger';

export class UpdateOrderDto extends PartialType(CreateOrderDto) {}