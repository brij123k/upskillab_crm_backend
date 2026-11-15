import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  education?: string;

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
  }[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  documents?: {
    aadhaarFront?: string;
    aadhaarBack?: string;
    panCard?: string;
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
}
