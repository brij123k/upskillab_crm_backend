import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsNumber, IsOptional, IsString } from 'class-validator';
import { LeadSource,LeadStatus } from 'src/schema/lead_management/lead.schema';

export class CreateLeadDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  phone: string;

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
  @IsMongoId()
  stageId: string;

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
