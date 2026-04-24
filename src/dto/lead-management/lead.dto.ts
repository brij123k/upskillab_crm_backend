import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsNotEmpty, IsNumber, IsOptional, IsString, IsDateString } from 'class-validator';
import { LeadSource, LeadStatus } from 'src/schema/lead_management/lead.schema';

export class CreateLeadDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  phone: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  state: string;

  @ApiPropertyOptional()
  @IsOptional()
  email?: string;


  @ApiProperty({ enum: LeadSource })
  @IsEnum(LeadSource)
  source: LeadSource;


  // @ApiPropertyOptional()
  // @IsOptional()
  // @IsMongoId()
  // departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  assignedTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  assignedDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason:string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  stageId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  poolId: string;

  @ApiProperty()
  @IsOptional()
  LeadHistory:string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  healthScore?: string;

  @ApiPropertyOptional()
  @IsOptional()
  source_campaign?: string;

  @ApiPropertyOptional()
  @IsOptional()
  createdAt:Date;
}
export class UpdateLeadDto extends PartialType(CreateLeadDto) {}

export class ChangeLeadStatusDto {
  @ApiProperty({ enum: LeadStatus })
  @IsEnum(LeadStatus)
  status: LeadStatus;
}

export class ChangeLeadStageDto {
  @ApiProperty()
  @IsString()
  stageId: string;
}
