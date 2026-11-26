import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  Max,
  IsMongoId,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Salary rules: components (% of CTC) + PF / ESI / PT rules. Validated in the service. */
export class UpdatePayrollSettingsDto {
  @ApiProperty({ example: [{ key: 'basic', name: 'Basic Salary', percent: 40, pfEligible: true }] })
  @IsArray()
  components: any[];

  @ApiProperty({ description: 'pf / esi / pt rules' })
  @IsObject()
  statutory: any;
}

export class SalaryInputDto {
  @ApiProperty({ example: 600000, description: 'Annual CTC in ₹' })
  @IsNumber()
  @Min(0)
  annualCtc: number;

  @ApiPropertyOptional({ example: 'Maharashtra', description: 'State for Professional Tax' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  ptState?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  pfApplicable?: boolean;

  @ApiPropertyOptional({ description: "'auto' (by gross limit), true or false", example: 'auto' })
  @IsOptional()
  esiApplicable?: boolean | 'auto';

  @ApiPropertyOptional({ example: 0, description: 'Monthly TDS' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tdsMonthly?: number;

  @ApiPropertyOptional({ example: [{ name: 'Canteen', amount: 500 }] })
  @IsOptional()
  @IsArray()
  otherDeductions?: { name: string; amount: number }[];

  @ApiPropertyOptional({ example: 12000, description: 'Insurance premium per year (optional)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  insuranceAnnual?: number;

  @ApiPropertyOptional({ description: 'Salary structure template id' })
  @IsOptional()
  @IsMongoId()
  templateId?: string;

  @ApiPropertyOptional({ description: 'Per-employee % split. Overrides the template / company split for this employee only.' })
  @IsOptional()
  @IsArray()
  customComponents?: any[];
}

export class CreateSalaryStructureDto extends SalaryInputDto {
  @ApiProperty()
  @IsMongoId()
  employeeId: string;

  @ApiProperty({ example: '2026-12-01' })
  @Matches(DATE_KEY, { message: 'effectiveFrom must be YYYY-MM-DD' })
  effectiveFrom: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateSalaryStructureDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  annualCtc?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(DATE_KEY, { message: 'effectiveFrom must be YYYY-MM-DD' })
  effectiveFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  ptState?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pfApplicable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  esiApplicable?: boolean | 'auto';

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  tdsMonthly?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  otherDeductions?: { name: string; amount: number }[];

  @ApiPropertyOptional({ example: 12000, description: 'Insurance premium per year (optional)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  insuranceAnnual?: number;

  @ApiPropertyOptional({ description: 'Salary structure template id' })
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiPropertyOptional({ description: 'Per-employee % split. Overrides the template / company split for this employee only.' })
  @IsOptional()
  @IsArray()
  customComponents?: any[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateSalaryRevisionDto extends SalaryInputDto {
  @ApiProperty()
  @IsMongoId()
  employeeId: string;

  @ApiProperty({ example: '2027-04-01' })
  @Matches(DATE_KEY, { message: 'effectiveFrom must be YYYY-MM-DD' })
  effectiveFrom: string;

  @ApiPropertyOptional({ example: 'Annual appraisal 2027' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export class SalaryTemplateDto {
  @ApiProperty({ example: 'Sales Executive' })
  @IsString()
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Own % split of CTC (empty = company rules)' })
  @IsOptional()
  @IsArray()
  components?: any[];

  @ApiPropertyOptional({ example: 360000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultAnnualCtc?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  pfApplicable?: boolean;

  @ApiPropertyOptional({ example: 'auto' })
  @IsOptional()
  esiApplicable?: boolean | 'auto' | 'true' | 'false';

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  insuranceAnnual?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tdsMonthly?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  ptState?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  otherDeductions?: { name: string; amount: number }[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSalaryTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  components?: any[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  defaultAnnualCtc?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pfApplicable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  esiApplicable?: boolean | 'auto' | 'true' | 'false';

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  insuranceAnnual?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  tdsMonthly?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  ptState?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  otherDeductions?: { name: string; amount: number }[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class IncrementSalaryDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsMongoId({ each: true })
  employeeIds: string[];

  @ApiPropertyOptional({ example: 10, description: 'Increment % (negative for a cut)' })
  @IsOptional()
  @IsNumber()
  percent?: number;

  @ApiPropertyOptional({ description: 'New annual CTC (one employee only)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  newAnnualCtc?: number;

  @ApiProperty({ example: '2027-04-01' })
  @Matches(DATE_KEY, { message: 'effectiveFrom must be YYYY-MM-DD' })
  effectiveFrom: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: 'Approve right away (needs approve_structures)' })
  @IsOptional()
  @IsBoolean()
  approveNow?: boolean;
}

export class StatutoryDetailsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  uan?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  pfNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  esiNumber?: string;

  @ApiPropertyOptional({ example: '2025-06-01' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  dateOfJoining?: string;
}

/* ---------------- monthly payroll ---------------- */

export class CalculatePayrollDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(MONTH_KEY, { message: 'month must be YYYY-MM' })
  month: string;

  @ApiPropertyOptional({ type: [String], description: 'Recalculate only these employees' })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  employeeIds?: string[];
}

export class UpdatePayrollEntryDto {
  @ApiPropertyOptional({ description: 'Loss-of-pay days (overrides attendance)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(31)
  lopDays?: number;

  @ApiPropertyOptional({ description: 'true = go back to the attendance LOP' })
  @IsOptional()
  @IsBoolean()
  resetLop?: boolean;

  @ApiPropertyOptional({ enum: ['pending', 'reviewed', 'on_hold'] })
  @IsOptional()
  @IsIn(['pending', 'reviewed', 'on_hold'])
  reviewStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class PayrollDecisionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class PayrollAdjustmentDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(MONTH_KEY, { message: 'month must be YYYY-MM' })
  month: string;

  @ApiProperty()
  @IsMongoId()
  employeeId: string;

  @ApiProperty({ example: 'incentive' })
  @IsIn(['incentive', 'bonus', 'arrear', 'reimbursement', 'other_earning', 'recovery', 'advance', 'other_deduction'])
  type: string;

  @ApiPropertyOptional({ example: 'Sales incentive – October' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @ApiProperty({ example: 5000 })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

export class EntryIdsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsMongoId({ each: true })
  entryIds: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class MarkPaidDto extends EntryIdsDto {
  @ApiPropertyOptional({ example: 'Bank transfer' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  mode?: string;

  @ApiPropertyOptional({ example: 'UTR123' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional({ example: '2026-12-01' })
  @IsOptional()
  @Matches(DATE_KEY, { message: 'paidOn must be YYYY-MM-DD' })
  paidOn?: string;
}

export class HoldPaymentDto extends EntryIdsDto {
  @ApiPropertyOptional({ description: 'true = hold, false = release back to pending' })
  @IsOptional()
  @IsBoolean()
  hold?: boolean;
}

export class GeneratePayslipsDto {
  @ApiProperty({ example: '2026-11' })
  @Matches(MONTH_KEY, { message: 'month must be YYYY-MM' })
  month: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  employeeIds?: string[];
}
