import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  Matches,
  Min,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ChangeUserDto } from '../user/userupdate.dto';
import { PersonalDetailsDto } from '../user/personal-details.dto';

/**
 * Payload an employee submits from the public onboarding link.
 * Deliberately has NO department / reporting senior / pools / salary /
 * permission fields – those stay admin/bd controlled.
 */
export class SubmitOnboardingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  profileImage?: string;

  @ApiPropertyOptional({ type: PersonalDetailsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PersonalDetailsDto)
  personalDetails?: PersonalDetailsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  address?: {
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    country?: string;
    pincode?: string;
  };

  @ApiPropertyOptional({ description: 'Current address (permanent address goes in `address`)' })
  @IsOptional()
  @IsObject()
  currentAddress?: {
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    country?: string;
    pincode?: string;
  };

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  bankDetails?: {
    accountHolderName?: string;
    bankName?: string;
    accountNumber?: string;
    ifscCode?: string;
    branchName?: string;
    accountType?: string;
  };

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  educationalDetails?: {
    qualification?: string;
    instituteName?: string;
    boardOrUniversity?: string;
    passingYear?: number;
    percentageOrCGPA?: string;
    certificate?: string;
  }[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  documents?: {
    aadhaarFront?: string;
    aadhaarBack?: string;
    panCard?: string;
    passbook?: string;
    educationalCertificates?: string[];
  };
}

export class GenerateOnboardingLinkDto {
  @ApiPropertyOptional({ description: 'Issue a brand-new token (old link stops working)' })
  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;

  @ApiPropertyOptional({ description: 'Also email the link to the employee' })
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;

  @ApiPropertyOptional({ description: 'Frontend origin used to build the link' })
  @IsOptional()
  @IsString()
  baseUrl?: string;
}

export class ApproveOnboardingDto extends ChangeUserDto {
  @ApiPropertyOptional({ description: 'Also set user status to active' })
  @IsOptional()
  @IsBoolean()
  activateUser?: boolean;

  /* ---- CTC (saved as the employee's first salary structure) ---- */

  @ApiPropertyOptional({ example: 600000, description: 'Annual CTC in ₹' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  annualCtc?: number;

  @ApiPropertyOptional({ example: '2026-12-01', description: 'Salary effective from (default today)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'salaryEffectiveFrom must be YYYY-MM-DD' })
  salaryEffectiveFrom?: string;

  @ApiPropertyOptional({ description: 'State for Professional Tax' })
  @IsOptional()
  @IsString()
  ptState?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  pfApplicable?: boolean;

  @ApiPropertyOptional({ description: "'auto', true or false" })
  @IsOptional()
  esiApplicable?: boolean | 'auto';

  @ApiPropertyOptional({ description: 'Monthly TDS' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tdsMonthly?: number;

  @ApiPropertyOptional({ description: 'Insurance premium per year (optional)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  insuranceAnnual?: number;

  @ApiPropertyOptional({ description: 'Salary structure template chosen at approval' })
  @IsOptional()
  @IsString()
  salaryTemplateId?: string;

  @ApiPropertyOptional({ description: 'Per-employee % split (overrides the template for this employee)' })
  @IsOptional()
  @IsArray()
  customComponents?: any[];
}
