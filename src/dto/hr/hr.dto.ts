import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateExitDto {
  @ApiProperty({ example: 'Better opportunity' })
  @IsString()
  @MaxLength(120)
  reasonCategory: string;

  @ApiProperty({ example: 'Got an offer closer to home' })
  @IsString()
  @MaxLength(2000)
  reason: string;

  @ApiProperty({ example: '2026-12-31' })
  @Matches(DATE_KEY, { message: 'lastWorkingDay must be YYYY-MM-DD' })
  lastWorkingDay: string;
}

export class DecideExitDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(DATE_KEY, { message: 'lastWorkingDay must be YYYY-MM-DD' })
  lastWorkingDay?: string;

  @ApiPropertyOptional({ enum: ['now', 'last_day'], description: 'When to deactivate the account' })
  @IsOptional()
  @IsIn(['now', 'last_day'])
  deactivateMode?: 'now' | 'last_day';
}

export class CreateDocumentDto {
  @ApiProperty()
  @IsMongoId()
  employeeId: string;

  @ApiProperty({ example: 'increment_letter' })
  @IsString()
  type: string;

  @ApiProperty({ example: 'Increment letter – April 2027' })
  @IsString()
  @MaxLength(150)
  title: string;

  @ApiProperty()
  @IsString()
  @MaxLength(1000)
  fileUrl: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;

  @ApiPropertyOptional({ example: '2027-04-01' })
  @IsOptional()
  @Matches(DATE_KEY, { message: 'documentDate must be YYYY-MM-DD' })
  documentDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateExpenseDto {
  @ApiProperty({ example: 'Cab to client office' })
  @IsString()
  @MaxLength(150)
  title: string;

  @ApiProperty({ example: 'travel' })
  @IsString()
  category: string;

  @ApiPropertyOptional({ description: 'Required when category is "other"' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  otherCategory?: string;

  @ApiProperty({ example: 450 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({ example: '2026-11-20' })
  @Matches(DATE_KEY, { message: 'expenseDate must be YYYY-MM-DD' })
  expenseDate: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  receipts?: string[];
}

export class DecideExpenseDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  @ApiPropertyOptional({ description: 'Defaults to the claimed amount' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  approvedAmount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class PayExpenseDto {
  @ApiPropertyOptional({ example: 'Bank transfer' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  paymentMode?: string;

  @ApiPropertyOptional({ example: 'UTR123456' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentReference?: string;

  @ApiPropertyOptional({ example: '2026-11-25' })
  @IsOptional()
  @Matches(DATE_KEY, { message: 'paidOn must be YYYY-MM-DD' })
  paidOn?: string;
}
